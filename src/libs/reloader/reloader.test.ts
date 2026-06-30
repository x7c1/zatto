/**
 * Orchestration tests for `Reloader.reload()`.
 *
 * These exist to lock in the behaviour the reload-harden PR introduces:
 * the reloader must ABORT (not warn-and-continue) when
 * `disableExtension(currentUuid)` returns `false`, and `cleanupOldInstances`
 * must keep going across the remaining stale UUIDs even when one fails.
 *
 * The pure-Gio side effects (file copying, GLib timers, D-Bus) are stubbed
 * through `ExtensionManagerPort` / `TempCopyPreparer` / `ShellExtensionSettingsPort`
 * fakes so the tests run under vitest without booting GNOME Shell.
 */

import { describe, expect, it } from 'vitest';
import { Reloader } from './reloader.js';
import {
  type ExtensionManagerCall,
  FakeExtensionManager,
  FakeShellExtensionSettings,
  FakeTempCopyPreparer,
} from './test-fakes.js';

const BASE = 'zatto@x7c1.github.io';

function makeReloader(
  extensionManager: FakeExtensionManager,
  tempCopyPreparer: FakeTempCopyPreparer,
  settingsPort: FakeShellExtensionSettings,
  currentUuid: string = BASE,
  now: () => number = () => 1700000000000000
) {
  return new Reloader(BASE, currentUuid, {
    extensionManagerPort: extensionManager,
    tempCopyPreparer,
    settingsPort,
    wait: () => Promise.resolve(),
    now,
  });
}

function callKinds(calls: readonly ExtensionManagerCall[]): string[] {
  return calls.map((c) => c.kind);
}

describe('Reloader.reload()', () => {
  it('aborts when disableExtension returns false (no clone, no enable, no GSettings write)', async () => {
    const extensionManager = new FakeExtensionManager({
      uuids: [BASE],
      disableResults: { [BASE]: false },
    });
    const tempCopyPreparer = new FakeTempCopyPreparer();
    const settingsPort = new FakeShellExtensionSettings({ enabled: [BASE], disabled: [] });

    const reloader = makeReloader(extensionManager, tempCopyPreparer, settingsPort);
    await reloader.reload();

    // The disable was attempted on the current UUID.
    expect(extensionManager.calls).toContainEqual({ kind: 'disable', uuid: BASE });
    // …and then everything stops: nothing was prepared, created, loaded, or enabled.
    expect(tempCopyPreparer.prepared).toEqual([]);
    expect(callKinds(extensionManager.calls)).not.toContain('createExtensionObject');
    expect(callKinds(extensionManager.calls)).not.toContain('enable');
    expect(callKinds(extensionManager.calls)).not.toContain('loadExtension');
    // GSettings stays untouched — no prune fires on the abort path.
    expect(settingsPort.enabledWrites).toBe(0);
    expect(settingsPort.disabledWrites).toBe(0);
  });

  it('runs the full reload sequence in order when every step succeeds', async () => {
    const extensionManager = new FakeExtensionManager({
      uuids: [BASE],
    });
    const tempCopyPreparer = new FakeTempCopyPreparer();
    const settingsPort = new FakeShellExtensionSettings({
      enabled: [BASE, `${BASE}-reload-1000`],
      disabled: [],
    });
    const timestamp = 1700000000000000;
    const newUuid = `${BASE}-reload-${timestamp}`;

    const reloader = makeReloader(
      extensionManager,
      tempCopyPreparer,
      settingsPort,
      BASE,
      () => timestamp
    );
    await reloader.reload();

    // Sequencing: disable → createExtensionObject → loadExtension → enable
    // → unloadExtension(old). The `lookup` calls are interleaved but the
    // load-bearing operations land in this order.
    const filtered = extensionManager.calls.filter(
      (c) => c.kind !== 'lookup' && c.kind !== 'unloadExtension'
    );
    expect(filtered).toEqual([
      { kind: 'disable', uuid: BASE },
      { kind: 'createExtensionObject', uuid: newUuid },
      { kind: 'loadExtension', uuid: newUuid },
      { kind: 'enable', uuid: newUuid },
    ]);

    // TempCopyPreparer was invoked with the new UUID and cleanup ran with
    // the new tmp dir.
    expect(tempCopyPreparer.prepared).toEqual([newUuid]);
    expect(tempCopyPreparer.cleanupTargets).toEqual([`/tmp/${newUuid}`]);

    // Old extension was unloaded after the new one came up.
    expect(extensionManager.calls).toContainEqual({ kind: 'unloadExtension', uuid: BASE });

    // pruneStaleReloadUuids ran: the stale `-reload-1000` was dropped, BASE
    // stayed. The new UUID does NOT show up here because the fake
    // ExtensionManager does not side-effect into GSettings (the real GNOME
    // Shell would); we just verify the prune-write happened.
    expect(settingsPort.getEnabled()).toEqual([BASE]);
    expect(settingsPort.enabledWrites).toBe(1);
  });

  it('cleanupOldInstances logs but continues when disable returns false for a stale UUID', async () => {
    const staleA = `${BASE}-reload-1000`;
    const staleB = `${BASE}-reload-2000`;
    const extensionManager = new FakeExtensionManager({
      uuids: [BASE, staleA, staleB],
      disableResults: { [staleA]: false },
    });
    const tempCopyPreparer = new FakeTempCopyPreparer();
    const settingsPort = new FakeShellExtensionSettings({
      enabled: [BASE, staleA, staleB],
      disabled: [],
    });

    const reloader = makeReloader(extensionManager, tempCopyPreparer, settingsPort);
    await reloader.reload();

    // Both stale UUIDs were visited even though one returned false.
    const disabledUuids = extensionManager.calls
      .filter((c) => c.kind === 'disable')
      .map((c) => c.uuid);
    expect(disabledUuids).toContain(staleA);
    expect(disabledUuids).toContain(staleB);

    // The current UUID was disabled (the main reload path still ran).
    expect(disabledUuids).toContain(BASE);

    // The reload still completed: a new UUID got created + enabled.
    expect(callKinds(extensionManager.calls)).toContain('createExtensionObject');
    expect(callKinds(extensionManager.calls)).toContain('enable');
  });
});

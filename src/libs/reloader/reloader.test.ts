/**
 * Orchestration tests for `Reloader.reload()`.
 *
 * These lock in three properties of the reload sequence:
 *
 * - The old instance is stopped with `unloadExtension`, never
 *   `disableExtension` (which is not even on the port), so the canonical
 *   UUID stays in `enabled-extensions` and the extension starts again on
 *   the next login.
 * - The reloader ABORTS when the current instance is not ACTIVE, since
 *   `unloadExtension` would skip its `disable()` and leave it holding the
 *   D-Bus name.
 * - Stale reload UUIDs are pruned from GSettings BEFORE the new UUID is
 *   enabled, so the prune write cannot race GNOME Shell's async enable.
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
  it('aborts when the current instance is not ACTIVE (no unload, clone, enable, or GSettings write)', async () => {
    const extensionManager = new FakeExtensionManager({
      uuids: [BASE],
      states: { [BASE]: 3 },
      errors: { [BASE]: 'enable() threw' },
    });
    const tempCopyPreparer = new FakeTempCopyPreparer();
    const settingsPort = new FakeShellExtensionSettings({ enabled: [BASE], disabled: [] });

    const reloader = makeReloader(extensionManager, tempCopyPreparer, settingsPort);
    await reloader.reload();

    expect(extensionManager.calls).toContainEqual({ kind: 'lookup', uuid: BASE });
    expect(callKinds(extensionManager.calls)).not.toContain('unloadExtension');
    expect(tempCopyPreparer.prepared).toEqual([]);
    expect(callKinds(extensionManager.calls)).not.toContain('createExtensionObject');
    expect(callKinds(extensionManager.calls)).not.toContain('enable');
    expect(settingsPort.enabledWrites).toBe(0);
    expect(settingsPort.disabledWrites).toBe(0);
  });

  it('aborts when the extension manager does not know the current instance', async () => {
    const extensionManager = new FakeExtensionManager({ uuids: [] });
    const tempCopyPreparer = new FakeTempCopyPreparer();
    const settingsPort = new FakeShellExtensionSettings({ enabled: [BASE], disabled: [] });

    const reloader = makeReloader(extensionManager, tempCopyPreparer, settingsPort);
    await reloader.reload();

    expect(tempCopyPreparer.prepared).toEqual([]);
    expect(callKinds(extensionManager.calls)).not.toContain('enable');
  });

  it('unloads the old instance, then creates, loads, prunes, and enables the new one', async () => {
    const timestamp = 1700000000000000;
    const newUuid = `${BASE}-reload-${timestamp}`;
    const settingsPort = new FakeShellExtensionSettings({
      enabled: [BASE, `${BASE}-reload-1000`],
      disabled: [`${BASE}-reload-500`],
    });
    // Snapshot GSettings at the moment the new UUID is enabled.
    let enabledAtEnable: string[] | undefined;
    const extensionManager = new FakeExtensionManager({
      uuids: [BASE],
      onEnable: () => {
        enabledAtEnable = settingsPort.getEnabled();
      },
    });
    const tempCopyPreparer = new FakeTempCopyPreparer();

    const reloader = makeReloader(
      extensionManager,
      tempCopyPreparer,
      settingsPort,
      BASE,
      () => timestamp
    );
    await reloader.reload();

    const filtered = extensionManager.calls.filter((c) => c.kind !== 'lookup');
    expect(filtered).toEqual([
      { kind: 'unloadExtension', uuid: BASE },
      { kind: 'createExtensionObject', uuid: newUuid },
      { kind: 'loadExtension', uuid: newUuid },
      { kind: 'enable', uuid: newUuid },
    ]);

    expect(tempCopyPreparer.prepared).toEqual([newUuid]);
    expect(tempCopyPreparer.cleanupTargets).toEqual([`/tmp/${newUuid}`]);

    // The prune had already landed when the new UUID was enabled, and the
    // canonical UUID survived it: that entry is what starts the extension
    // on the next login.
    expect(enabledAtEnable).toEqual([BASE]);
    expect(settingsPort.getEnabled()).toEqual([BASE]);
    expect(settingsPort.getDisabled()).toEqual([]);
  });

  it('cleanupOldInstances keeps going when unloading one stale UUID fails', async () => {
    const staleA = `${BASE}-reload-1000`;
    const staleB = `${BASE}-reload-2000`;
    const extensionManager = new FakeExtensionManager({
      uuids: [BASE, staleA, staleB],
      unloadThrows: [staleA],
    });
    const tempCopyPreparer = new FakeTempCopyPreparer();
    const settingsPort = new FakeShellExtensionSettings({
      enabled: [BASE, staleA, staleB],
      disabled: [],
    });

    const reloader = makeReloader(extensionManager, tempCopyPreparer, settingsPort);
    await reloader.reload();

    const unloaded = extensionManager.calls
      .filter((c) => c.kind === 'unloadExtension')
      .map((c) => c.uuid);
    expect(unloaded).toEqual([staleA, staleB, BASE]);

    // The reload still completed: a new UUID got created + enabled.
    expect(callKinds(extensionManager.calls)).toContain('createExtensionObject');
    expect(callKinds(extensionManager.calls)).toContain('enable');
  });

  it("cleanupOldInstances leaves other extensions' reload copies alone", async () => {
    const ownStale = `${BASE}-reload-1000`;
    const otherReload = 'sutto@x7c1.github.io-reload-2000';
    const lookalike = `${BASE}-reload-extra`;
    const extensionManager = new FakeExtensionManager({
      uuids: [BASE, ownStale, otherReload, lookalike],
    });
    const tempCopyPreparer = new FakeTempCopyPreparer();
    const settingsPort = new FakeShellExtensionSettings({
      enabled: [BASE, ownStale, otherReload],
      disabled: [],
    });

    const reloader = makeReloader(extensionManager, tempCopyPreparer, settingsPort);
    await reloader.reload();

    const touched = extensionManager.calls
      .filter((c) => c.kind === 'unloadExtension')
      .map((c) => c.uuid);
    expect(touched).toContain(ownStale);
    expect(touched).not.toContain(otherReload);
    expect(touched).not.toContain(lookalike);
    expect(settingsPort.getEnabled()).toContain(otherReload);
  });
});

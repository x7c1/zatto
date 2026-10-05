/**
 * Extension Reloader
 *
 * A reusable utility for hot-reloading GNOME Shell extensions during
 * development. Inspired by ExtensionReloader
 * (https://codeberg.org/som/ExtensionReloader).
 *
 * This file is intentionally free of `gi://*` and `resource://*` imports
 * so the orchestration logic can be exercised under vitest with fake
 * ports. Production wiring (Gio-backed defaults) lives in
 * `make-reloader.ts`, which is what `DBusReloader` constructs.
 *
 * Usage (production):
 *   const reloader = makeReloader('your-extension@example.com');
 *   reloader.reload();
 *
 * Usage (tests):
 *   const reloader = new Reloader('uuid', 'uuid', {
 *     extensionManagerPort, tempCopyPreparer, settingsPort,
 *     wait: () => Promise.resolve(), now: () => 42,
 *   });
 */

import type {
  ExtensionManagerPort,
  ShellExtensionSettingsPort,
  TempCopyPreparer,
} from './ports.js';
import { isReloadUuidOf, pruneStaleReloadUuids } from './prune-stale-reloads.js';

/**
 * Type guard to safely extract error message from unknown error
 */
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

const RECOVERY_HINT =
  'The previous extension instance likely still owns the D-Bus name. ' +
  'On Wayland, log out and back in to recover.';

/**
 * GNOME Shell's `ExtensionState.ACTIVE`.
 *
 * Spelled as a numeric literal because the enum's member names drifted:
 * `@girs/gnome-shell` 50.0.0 still declares `ENABLED`/`DISABLED`, while the
 * object that `resource:///org/gnome/shell/misc/extensionUtils.js` exports in
 * Shell 50 has `ACTIVE`/`INACTIVE`. The numeric value did not change
 * (`ENABLED` and `ACTIVE` are both 1). Keeping it a literal also keeps this
 * file free of `resource://*` imports.
 */
const EXTENSION_STATE_ACTIVE = 1;

export interface ReloaderOptions {
  /** GSettings port (must be provided — wire it up via `makeReloader`). */
  settingsPort: ShellExtensionSettingsPort;
  /** Extension-manager port (must be provided — wire it up via `makeReloader`). */
  extensionManagerPort: ExtensionManagerPort;
  /** Temp-copy preparer (must be provided — wire it up via `makeReloader`). */
  tempCopyPreparer: TempCopyPreparer;
  /**
   * Async wait function. Production wires a GLib timeout; tests pass
   * `() => Promise.resolve()` to skip the real 100 ms delay between
   * D-Bus unregistration and the next step.
   */
  wait: (ms: number) => Promise<void>;
  /**
   * Clock for generating the new reload UUID's timestamp. Production
   * wires `GLib.get_real_time()`; tests pass a deterministic value.
   */
  now: () => number;
}

export class Reloader {
  private readonly originalUuid: string;
  private readonly currentUuid: string;
  private readonly settingsPort: ShellExtensionSettingsPort;
  private readonly extensionManager: ExtensionManagerPort;
  private readonly tempCopyPreparer: TempCopyPreparer;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly now: () => number;

  /**
   * Create a new Reloader instance. Production callers go through
   * `makeReloader()` so the Gio-backed defaults are wired in; tests
   * construct directly with fakes.
   *
   * @param uuid The extension's base UUID (e.g. `'my-extension@example.com'`).
   * @param currentUuid Current UUID (a `<base>-reload-<ts>` for reloaded instances).
   * @param options All collaborators, explicitly. No hidden defaults — this
   *   keeps the unit under test free of `gi://*` imports.
   */
  constructor(uuid: string, currentUuid: string | undefined, options: ReloaderOptions) {
    this.originalUuid = uuid;
    this.currentUuid = currentUuid || uuid;
    this.settingsPort = options.settingsPort;
    this.extensionManager = options.extensionManagerPort;
    this.tempCopyPreparer = options.tempCopyPreparer;
    this.wait = options.wait;
    this.now = options.now;
  }

  /**
   * Reload the extension by creating a temporary copy with a new UUID.
   *
   * Sequencing note: we unload the current extension BEFORE preparing the
   * `/tmp` clone so an aborted reload leaves no orphan tmp dir behind. The
   * cost (an extra few ms with no instance running) is well worth the
   * clean failure mode.
   */
  async reload(): Promise<void> {
    try {
      console.log('[Reloader] Starting reload...');

      // Best-effort housekeeping of prior reload UUIDs that GNOME Shell has
      // not garbage-collected. Runs before we touch the current extension
      // so a failure here cannot strand us with no enabled instance.
      this.cleanupOldInstances();

      // Unload the current extension FIRST so its D-Bus interface is
      // unregistered before the new instance tries to claim the same name.
      // `unloadExtension()` runs the same disable path as
      // `disableExtension()` (it calls `disable()`, rebases the extensions
      // enabled after this one, and marks the extension inactive) and then
      // drops the object from the manager, but it never writes GSettings.
      // `disableExtension()` would move the canonical UUID from
      // `enabled-extensions` into `disabled-extensions`, leaving the
      // extension dead after the next login: startup only scans the XDG data
      // dirs, so the `-reload-` UUID that stays behind in
      // `enabled-extensions` resolves to nothing.
      console.log('[Reloader] Unloading old extension...');
      const oldExtension = this.extensionManager.lookup(this.currentUuid);
      if (!oldExtension || oldExtension.state !== EXTENSION_STATE_ACTIVE) {
        // `unloadExtension()` skips `disable()` for a non-active extension,
        // so we abort rather than enable a second instance over it. The
        // realistic trigger is a previous instance whose own `enable()`
        // threw: GNOME Shell parks it in `ExtensionState.ERROR` (3) without
        // ever calling `disable()`, so it still holds the D-Bus name and its
        // `error` carries the message that exception raised.
        const reason = oldExtension
          ? `it is in state ${oldExtension.state} instead of ACTIVE` +
            (oldExtension.error ? ` (${oldExtension.error})` : '')
          : 'the extension manager does not know it';
        throw new Error(`cannot unload '${this.currentUuid}' because ${reason}`);
      }
      await this.extensionManager.unloadExtension(oldExtension);

      // Wait for D-Bus interface to fully unregister.
      await this.wait(100);

      // Prepare new UUID and directory only after the unload succeeded —
      // this way an aborted reload leaves no orphan `/tmp/<uuid>-reload-*`.
      const timestamp = this.now();
      const newUuid = `${this.originalUuid}-reload-${timestamp}`;
      const tmpDir = `/tmp/${newUuid}`;
      const tmpDirFile = this.tempCopyPreparer.prepare(newUuid);

      this.extensionManager.createExtensionObject(newUuid, tmpDirFile);

      const newExtension = this.extensionManager.lookup(newUuid);
      if (!newExtension) {
        throw new Error(`Failed to create extension object for ${newUuid}`);
      }

      await this.extensionManager.loadExtension(newExtension);

      // Prune stale `<base>-reload-<digits>` entries that prior `npm run dev`
      // iterations left behind in `org.gnome.shell` enabled-extensions /
      // disabled-extensions. Must run BEFORE the new UUID is enabled:
      // GNOME Shell's `_onEnabledExtensionsChanged()` handler is async, and a
      // write that lands while the enable of the new UUID is still in flight
      // starts a second enable of the same UUID (it is not yet recorded as
      // enabled), which constructs the extension twice and leaves an orphaned
      // instance holding the D-Bus name. Running it here is safe: the new
      // UUID is in neither array yet (`createExtensionObject` and
      // `loadExtension` never write GSettings), and every UUID this write
      // removes was either unloaded above or is a leftover from an earlier
      // session that was never loaded here, so the handler this write
      // triggers has nothing to enable or disable. The new UUID is passed as
      // the one to preserve, so the prune cannot drop it.
      pruneStaleReloadUuids(this.settingsPort, this.originalUuid, newUuid);

      const enableSuccess = this.extensionManager.enableExtension(newUuid);
      if (!enableSuccess) {
        throw new Error(`Failed to enable extension ${newUuid}`);
      }

      // Clean up temp dirs left behind by earlier reload cycles.
      this.tempCopyPreparer.cleanupOtherTempDirs(tmpDir);

      console.log('[Reloader] Reload complete!');
    } catch (e: unknown) {
      console.error(`[Reloader] Reload aborted: ${getErrorMessage(e)}`);
      console.error(`[Reloader] ${RECOVERY_HINT}`);
    }
  }

  /**
   * Clean up old reload instances. Best-effort: a failure on one UUID is
   * logged and the remaining UUIDs are still visited.
   *
   * `unloadExtension()` never writes GSettings, so the stale UUIDs it leaves
   * in the `org.gnome.shell` arrays are removed later by
   * `pruneStaleReloadUuids`.
   */
  private cleanupOldInstances(): void {
    const uuids = this.extensionManager.getUuids();
    for (const uuid of uuids) {
      // Only this extension's own copies: other extensions may run their
      // own reload copies, and unloading those would take them down.
      if (isReloadUuidOf(this.originalUuid, uuid) && uuid !== this.currentUuid) {
        try {
          const extension = this.extensionManager.lookup(uuid);
          if (extension) {
            this.extensionManager.unloadExtension(extension);
          }
        } catch (e: unknown) {
          console.log(`[Reloader] Error removing ${uuid}: ${getErrorMessage(e)}`);
        }
      }
    }
  }
}

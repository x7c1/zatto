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
 * GNOME Shell's `ExtensionState.ACTIVE`, spelled as a literal so this file
 * stays free of `resource://*` imports. Do not switch to the `@girs` enum:
 * `@girs/gnome-shell` 50.0.0 still names the member `ENABLED`, which is
 * `undefined` on the Shell 50 runtime object (where it is `ACTIVE`). Both
 * are 1.
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
   */
  async reload(): Promise<void> {
    try {
      console.log('[Reloader] Starting reload...');

      // Best-effort housekeeping of prior reload UUIDs that GNOME Shell has
      // not garbage-collected. Runs before we touch the current extension
      // so a failure here cannot strand us with no enabled instance.
      await this.cleanupOldInstances();

      // Unload the current extension first so it releases the D-Bus name
      // the new instance is about to claim. (Why unload rather than disable:
      // see `ExtensionManagerPort`.)
      console.log('[Reloader] Unloading old extension...');
      const oldExtension = this.extensionManager.lookup(this.currentUuid);
      if (!oldExtension || oldExtension.state !== EXTENSION_STATE_ACTIVE) {
        // `unloadExtension()` calls `disable()` only on an ACTIVE extension,
        // so anything else may keep holding the D-Bus name; abort instead of
        // starting a second instance next to it. The usual case is a
        // previous instance whose `enable()` threw: GNOME Shell leaves it in
        // `ERROR` (3) with that exception's message in `error`.
        const reason = oldExtension
          ? `it is in state ${oldExtension.state} instead of ACTIVE` +
            (oldExtension.error ? ` (${oldExtension.error})` : '')
          : 'the extension manager does not know it';
        throw new Error(`cannot unload '${this.currentUuid}' because ${reason}`);
      }
      await this.extensionManager.unloadExtension(oldExtension);

      // Wait for D-Bus interface to fully unregister.
      await this.wait(100);

      // Create the `/tmp` copy only now, so a reload aborted above leaves no
      // orphan `/tmp/<uuid>-reload-*` behind.
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

      // Drop stale reload UUIDs from GSettings BEFORE enabling the new one.
      //
      // Why before: every GSettings write fires GNOME Shell's async
      // `_onEnabledExtensionsChanged()`. A write landing while the new
      // UUID's enable is still in flight sees it as not yet enabled and
      // enables it a second time, leaving an orphaned instance that holds
      // the D-Bus name.
      //
      // Why here is safe: the new UUID is not in GSettings yet
      // (`createExtensionObject` and `loadExtension` do not write it), and
      // every UUID removed is already unloaded or was never loaded in this
      // session, so the handler finds nothing to enable or disable.
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
   * Unload this extension's earlier reload copies that are still loaded.
   * Best-effort: a failure on one UUID is logged and the rest are still
   * visited. Their GSettings entries are removed later by
   * `pruneStaleReloadUuids`.
   */
  private async cleanupOldInstances(): Promise<void> {
    const uuids = this.extensionManager.getUuids();
    for (const uuid of uuids) {
      // Only this extension's own copies: other extensions may run their
      // own reload copies, and unloading those would take them down.
      if (isReloadUuidOf(this.originalUuid, uuid) && uuid !== this.currentUuid) {
        try {
          const extension = this.extensionManager.lookup(uuid);
          if (extension) {
            await this.extensionManager.unloadExtension(extension);
          }
        } catch (e: unknown) {
          console.log(`[Reloader] Error removing ${uuid}: ${getErrorMessage(e)}`);
        }
      }
    }
  }
}

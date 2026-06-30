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
import { pruneStaleReloadUuids } from './prune-stale-reloads.js';

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
   * Sequencing note: we disable the current extension BEFORE preparing the
   * `/tmp` clone so an aborted reload leaves no orphan tmp dir behind. The
   * cost (an extra few ms with the extension disabled) is well worth the
   * clean failure mode.
   */
  async reload(): Promise<void> {
    try {
      console.log('[Reloader] Starting reload...');

      // Best-effort housekeeping of prior reload UUIDs that GNOME Shell has
      // not garbage-collected. Runs before we touch the current extension
      // so a failure here cannot strand us with no enabled instance.
      this.cleanupOldInstances();

      // Disable the current extension FIRST so its D-Bus interface is
      // unregistered before the new instance tries to claim the same name.
      // If this fails we abort: enabling a second instance over a wedged
      // one is exactly the cascade this reload-harden PR exists to prevent.
      console.log('[Reloader] Disabling old extension...');
      const disableSuccess = this.extensionManager.disableExtension(this.currentUuid);
      if (!disableSuccess) {
        throw new Error(`extensionManager.disableExtension('${this.currentUuid}') returned false`);
      }

      // Wait for D-Bus interface to fully unregister.
      await this.wait(100);

      // Prepare new UUID and directory only after the disable succeeded —
      // this way an aborted reload leaves no orphan `/tmp/<uuid>-reload-*`.
      const timestamp = this.now();
      const newUuid = `${this.originalUuid}-reload-${timestamp}`;
      const tmpDir = `/tmp/${newUuid}`;
      const tmpDirFile = this.tempCopyPreparer.prepare(newUuid);

      // Create extension object (returns void in Shell 46+).
      this.extensionManager.createExtensionObject(
        newUuid,
        tmpDirFile,
        1 // ExtensionType.PER_USER
      );

      const newExtension = this.extensionManager.lookup(newUuid);
      if (!newExtension) {
        throw new Error(`Failed to create extension object for ${newUuid}`);
      }

      await this.extensionManager.loadExtension(newExtension);

      const enableSuccess = this.extensionManager.enableExtension(newUuid);
      if (!enableSuccess) {
        throw new Error(`Failed to enable extension ${newUuid}`);
      }

      // Clean up old files and the now-stale extension instance.
      this.tempCopyPreparer.cleanupOtherTempDirs(tmpDir);
      await this.unloadOldExtension(this.currentUuid);

      // Prune stale `<base>-reload-<digits>` entries that prior `npm run dev`
      // iterations left behind in `org.gnome.shell` enabled-extensions /
      // disabled-extensions. Runs only after the new UUID is enabled so we
      // never accidentally evict the currently-running instance.
      pruneStaleReloadUuids(this.settingsPort, this.originalUuid, newUuid);

      console.log('[Reloader] Reload complete!');
    } catch (e: unknown) {
      console.error(`[Reloader] Reload aborted: ${getErrorMessage(e)}`);
      console.error(`[Reloader] ${RECOVERY_HINT}`);
    }
  }

  /**
   * Clean up old reload instances. Best-effort: if `disableExtension`
   * returns `false` (e.g. the entry is already stale or errored) we log
   * and continue across the remaining UUIDs.
   */
  private cleanupOldInstances(): void {
    const uuids = this.extensionManager.getUuids();
    for (const uuid of uuids) {
      if (uuid.includes('-reload-') && uuid !== this.currentUuid) {
        try {
          const disableSuccess = this.extensionManager.disableExtension(uuid);
          if (!disableSuccess) {
            console.log(
              `[Reloader] cleanupOldInstances: disable returned false for ${uuid} (likely stale/errored — continuing)`
            );
          }
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

  /**
   * Unload old extension instance (already disabled).
   */
  private async unloadOldExtension(uuid: string): Promise<void> {
    await this.wait(100);

    const oldExtension = this.extensionManager.lookup(uuid);
    if (!oldExtension) {
      return;
    }

    try {
      const success = await this.extensionManager.unloadExtension(oldExtension);
      if (success) {
        console.log(`[Reloader] Successfully unloaded: ${uuid}`);
      } else {
        console.warn(`[Reloader] Failed to unload extension ${uuid}`);
      }
    } catch (e: unknown) {
      console.log(`[Reloader] Error unloading: ${getErrorMessage(e)}`);
    }
  }
}

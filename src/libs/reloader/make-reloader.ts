/**
 * Production factory for {@link Reloader}.
 *
 * Lives in its own module so `reloader.ts` itself can stay free of
 * `gi://*` and `resource://*` imports — that keeps the orchestration logic
 * unit-testable under vitest without booting GNOME Shell.
 */

import GLib from 'gi://GLib';
import { GnomeShellExtensionManager } from './gnome-shell-extension-manager.js';
import { GnomeShellExtensionSettings } from './gnome-shell-extension-settings.js';
import { GnomeTempCopyPreparer } from './gnome-temp-copy-preparer.js';
import { Reloader } from './reloader.js';

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    });
  });
}

/**
 * Wire up a `Reloader` with the Gio-backed production defaults. The
 * `currentUuid` is the live reload UUID (e.g. `<base>-reload-<ts>`) when
 * we are already running inside a reloaded instance, falling back to the
 * base UUID on first boot.
 */
export function makeReloader(uuid: string, currentUuid?: string): Reloader {
  return new Reloader(uuid, currentUuid, {
    settingsPort: new GnomeShellExtensionSettings(),
    extensionManagerPort: new GnomeShellExtensionManager(),
    tempCopyPreparer: new GnomeTempCopyPreparer(uuid),
    wait: defaultWait,
    now: () => GLib.get_real_time(),
  });
}

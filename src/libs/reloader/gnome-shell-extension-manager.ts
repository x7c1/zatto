/**
 * Production implementation of {@link ExtensionManagerPort} that delegates
 * to `Main.extensionManager`. Lives next to the port definition so the
 * production wiring is colocated with the reloader.
 */

import { ExtensionType } from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type { ExtensionObject } from '@girs/gnome-shell/dist/types/extension-object.js';
import type { ExtensionHandle, ExtensionManagerPort } from './ports.js';

export class GnomeShellExtensionManager implements ExtensionManagerPort {
  getUuids(): readonly string[] {
    return Main.extensionManager.getUuids();
  }

  enableExtension(uuid: string): boolean {
    return Main.extensionManager.enableExtension(uuid);
  }

  lookup(uuid: string): ExtensionHandle | undefined {
    // The upstream type signature claims a non-nullable return, but the
    // runtime actually hands back `undefined` when the UUID is unknown.
    return Main.extensionManager.lookup(uuid) as ExtensionObject | undefined;
  }

  loadExtension(extension: ExtensionHandle): Promise<unknown> {
    return Main.extensionManager.loadExtension(extension as ExtensionObject);
  }

  unloadExtension(extension: ExtensionHandle): Promise<boolean> {
    return Main.extensionManager.unloadExtension(extension as ExtensionObject);
  }

  createExtensionObject(uuid: string, dir: unknown): void {
    // The reload copy lives under /tmp and is owned by the user, so it is
    // registered as a PER_USER extension.
    Main.extensionManager.createExtensionObject(uuid, dir as never, ExtensionType.PER_USER);
  }
}

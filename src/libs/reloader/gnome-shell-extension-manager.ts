/**
 * Production implementation of {@link ExtensionManagerPort} that delegates
 * to `Main.extensionManager`. Lives next to the port definition so the
 * production wiring is colocated with the reloader.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type { ExtensionObject } from '@girs/gnome-shell/dist/types/extension-object.js';
import type { ExtensionManagerPort } from './ports.js';

export class GnomeShellExtensionManager implements ExtensionManagerPort {
  getUuids(): readonly string[] {
    return Main.extensionManager.getUuids();
  }

  disableExtension(uuid: string): boolean {
    return Main.extensionManager.disableExtension(uuid);
  }

  enableExtension(uuid: string): boolean {
    return Main.extensionManager.enableExtension(uuid);
  }

  lookup(uuid: string): unknown | undefined {
    // The upstream type signature claims a non-nullable return, but the
    // runtime actually hands back `undefined` when the UUID is unknown.
    return Main.extensionManager.lookup(uuid) as ExtensionObject | undefined;
  }

  loadExtension(extension: unknown): Promise<unknown> {
    return Main.extensionManager.loadExtension(extension as ExtensionObject);
  }

  unloadExtension(extension: unknown): Promise<boolean> {
    return Main.extensionManager.unloadExtension(extension as ExtensionObject);
  }

  createExtensionObject(uuid: string, dir: unknown, type: number): void {
    // `ExtensionType.PER_USER === 1` upstream; we accept the raw number so
    // the port stays free of the enum import.
    Main.extensionManager.createExtensionObject(uuid, dir as never, type as never);
  }
}

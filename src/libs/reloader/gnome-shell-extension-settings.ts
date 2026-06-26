/**
 * Production implementation of {@link ShellExtensionSettingsPort}, backed by
 * `Gio.Settings.new('org.gnome.shell')`. Lives next to the port definition
 * so the production wiring is colocated with the reloader.
 */

import Gio from 'gi://Gio';
import type { ShellExtensionSettingsPort } from './ports.js';

const SCHEMA_ID = 'org.gnome.shell';
const ENABLED_KEY = 'enabled-extensions';
const DISABLED_KEY = 'disabled-extensions';

export class GnomeShellExtensionSettings implements ShellExtensionSettingsPort {
  private readonly settings: Gio.Settings;

  constructor() {
    this.settings = Gio.Settings.new(SCHEMA_ID);
  }

  getEnabled(): string[] {
    return this.settings.get_strv(ENABLED_KEY);
  }

  setEnabled(uuids: string[]): void {
    this.settings.set_strv(ENABLED_KEY, uuids);
  }

  getDisabled(): string[] {
    return this.settings.get_strv(DISABLED_KEY);
  }

  setDisabled(uuids: string[]): void {
    this.settings.set_strv(DISABLED_KEY, uuids);
  }
}

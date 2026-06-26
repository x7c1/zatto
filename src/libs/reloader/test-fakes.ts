/**
 * Test doubles for the reloader's ports.
 *
 * The fake holds in-memory copies of GNOME Shell's enabled-extensions /
 * disabled-extensions arrays so the pure prune logic can be exercised under
 * vitest without booting Gio. Each setter increments a write counter so
 * tests can assert "no write happened" without inspecting list contents
 * (e.g. for the no-op case where DConf should stay quiet).
 */

import type { ShellExtensionSettingsPort } from './ports.js';

export interface FakeSettingsState {
  enabled?: string[];
  disabled?: string[];
}

export class FakeShellExtensionSettings implements ShellExtensionSettingsPort {
  private enabled: string[];
  private disabled: string[];
  enabledWrites = 0;
  disabledWrites = 0;

  constructor(initial: FakeSettingsState = {}) {
    this.enabled = [...(initial.enabled ?? [])];
    this.disabled = [...(initial.disabled ?? [])];
  }

  getEnabled(): string[] {
    return [...this.enabled];
  }

  setEnabled(uuids: string[]): void {
    this.enabled = [...uuids];
    this.enabledWrites++;
  }

  getDisabled(): string[] {
    return [...this.disabled];
  }

  setDisabled(uuids: string[]): void {
    this.disabled = [...uuids];
    this.disabledWrites++;
  }
}

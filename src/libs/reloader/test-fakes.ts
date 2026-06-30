/**
 * Test doubles for the reloader's ports.
 *
 * The fakes hold in-memory copies of the GNOME-Shell state the reloader
 * touches so the pure orchestration / prune logic can be exercised under
 * vitest without booting Gio. Each setter increments a write counter so
 * tests can assert "no write happened" without inspecting list contents
 * (e.g. for the no-op case where DConf should stay quiet).
 */

import type {
  ExtensionManagerPort,
  ShellExtensionSettingsPort,
  TempCopyPreparer,
} from './ports.js';

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

/**
 * Call record for {@link FakeExtensionManager}. Tests assert on this to
 * verify the sequence of operations the reloader performs (e.g. "disable
 * was called before createExtensionObject").
 */
export type ExtensionManagerCall =
  | { kind: 'disable'; uuid: string }
  | { kind: 'enable'; uuid: string }
  | { kind: 'lookup'; uuid: string }
  | { kind: 'loadExtension'; uuid: string }
  | { kind: 'unloadExtension'; uuid: string }
  | { kind: 'createExtensionObject'; uuid: string };

export interface FakeExtensionManagerOptions {
  /** UUIDs returned by `getUuids()`. */
  uuids?: string[];
  /** Per-UUID return value for `disableExtension`. Defaults to `true`. */
  disableResults?: Record<string, boolean>;
  /** Per-UUID return value for `enableExtension`. Defaults to `true`. */
  enableResults?: Record<string, boolean>;
}

/**
 * Minimal stand-in for `Main.extensionManager`. Records every call into
 * `calls` so tests can assert both the contents and the relative ordering
 * of operations.
 */
export class FakeExtensionManager implements ExtensionManagerPort {
  readonly calls: ExtensionManagerCall[] = [];
  private readonly uuids: string[];
  private readonly disableResults: Record<string, boolean>;
  private readonly enableResults: Record<string, boolean>;
  /**
   * Every UUID passed to `createExtensionObject` or seen at construction
   * time becomes "known" so `lookup` returns a stand-in object — this
   * matches the real `Main.extensionManager`, where `createExtensionObject`
   * registers the new extension and `lookup` can then resolve it.
   */
  private readonly known = new Set<string>();

  constructor(options: FakeExtensionManagerOptions = {}) {
    this.uuids = [...(options.uuids ?? [])];
    this.disableResults = { ...(options.disableResults ?? {}) };
    this.enableResults = { ...(options.enableResults ?? {}) };
    for (const uuid of this.uuids) {
      this.known.add(uuid);
    }
  }

  getUuids(): readonly string[] {
    return [...this.uuids];
  }

  disableExtension(uuid: string): boolean {
    this.calls.push({ kind: 'disable', uuid });
    return this.disableResults[uuid] ?? true;
  }

  enableExtension(uuid: string): boolean {
    this.calls.push({ kind: 'enable', uuid });
    return this.enableResults[uuid] ?? true;
  }

  lookup(uuid: string): unknown | undefined {
    this.calls.push({ kind: 'lookup', uuid });
    if (!this.known.has(uuid)) {
      return undefined;
    }
    return { uuid };
  }

  loadExtension(extension: unknown): Promise<unknown> {
    const uuid = (extension as { uuid: string }).uuid;
    this.calls.push({ kind: 'loadExtension', uuid });
    return Promise.resolve(extension);
  }

  unloadExtension(extension: unknown): Promise<boolean> {
    const uuid = (extension as { uuid: string }).uuid;
    this.calls.push({ kind: 'unloadExtension', uuid });
    this.known.delete(uuid);
    return Promise.resolve(true);
  }

  createExtensionObject(uuid: string, _dir: unknown, _type: number): void {
    this.calls.push({ kind: 'createExtensionObject', uuid });
    this.known.add(uuid);
  }
}

/**
 * In-memory stand-in for {@link TempCopyPreparer}. Returns a synthetic
 * handle so the reloader can forward it to `createExtensionObject` without
 * touching the filesystem.
 */
export class FakeTempCopyPreparer implements TempCopyPreparer {
  readonly prepared: string[] = [];
  readonly cleanupTargets: string[] = [];

  prepare(newUuid: string): unknown {
    this.prepared.push(newUuid);
    return { __fakeTempDir: `/tmp/${newUuid}` };
  }

  cleanupOtherTempDirs(currentTmpDir: string): void {
    this.cleanupTargets.push(currentTmpDir);
  }
}

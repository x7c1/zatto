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
  ExtensionHandle,
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
 * verify the sequence of operations the reloader performs (e.g. "the old
 * instance was unloaded before createExtensionObject").
 */
export type ExtensionManagerCall =
  | { kind: 'enable'; uuid: string }
  | { kind: 'lookup'; uuid: string }
  | { kind: 'loadExtension'; uuid: string }
  | { kind: 'unloadExtension'; uuid: string }
  | { kind: 'createExtensionObject'; uuid: string };

export interface FakeExtensionManagerOptions {
  /** UUIDs returned by `getUuids()`. */
  uuids?: string[];
  /** Per-UUID `ExtensionState` returned by `lookup`. Defaults to ACTIVE (1). */
  states?: Record<string, number>;
  /** Per-UUID `error` returned by `lookup`. */
  errors?: Record<string, string>;
  /** Per-UUID return value for `enableExtension`. Defaults to `true`. */
  enableResults?: Record<string, boolean>;
  /** UUIDs for which `unloadExtension` throws synchronously. */
  unloadThrows?: string[];
  /** Called on every `enableExtension`, before it returns. */
  onEnable?: (uuid: string) => void;
}

/** What {@link FakeExtensionManager.lookup} hands back. */
export interface FakeExtension extends ExtensionHandle {
  readonly uuid: string;
}

/**
 * Minimal stand-in for `Main.extensionManager`. Records every call into
 * `calls` so tests can assert both the contents and the relative ordering
 * of operations.
 */
export class FakeExtensionManager implements ExtensionManagerPort {
  readonly calls: ExtensionManagerCall[] = [];
  private readonly uuids: string[];
  private readonly states: Record<string, number>;
  private readonly errors: Record<string, string>;
  private readonly enableResults: Record<string, boolean>;
  private readonly unloadThrows: Set<string>;
  private readonly onEnable: (uuid: string) => void;
  /**
   * Every UUID passed to `createExtensionObject` or seen at construction
   * time becomes "known" so `lookup` returns a stand-in object — this
   * matches the real `Main.extensionManager`, where `createExtensionObject`
   * registers the new extension and `lookup` can then resolve it.
   */
  private readonly known = new Set<string>();

  constructor(options: FakeExtensionManagerOptions = {}) {
    this.uuids = [...(options.uuids ?? [])];
    this.states = { ...(options.states ?? {}) };
    this.errors = { ...(options.errors ?? {}) };
    this.enableResults = { ...(options.enableResults ?? {}) };
    this.unloadThrows = new Set(options.unloadThrows ?? []);
    this.onEnable = options.onEnable ?? (() => {});
    for (const uuid of this.uuids) {
      this.known.add(uuid);
    }
  }

  getUuids(): readonly string[] {
    return [...this.uuids];
  }

  enableExtension(uuid: string): boolean {
    this.calls.push({ kind: 'enable', uuid });
    this.onEnable(uuid);
    return this.enableResults[uuid] ?? true;
  }

  lookup(uuid: string): FakeExtension | undefined {
    this.calls.push({ kind: 'lookup', uuid });
    if (!this.known.has(uuid)) {
      return undefined;
    }
    return { uuid, state: this.states[uuid] ?? 1, error: this.errors[uuid] };
  }

  loadExtension(extension: ExtensionHandle): Promise<unknown> {
    const uuid = (extension as FakeExtension).uuid;
    this.calls.push({ kind: 'loadExtension', uuid });
    return Promise.resolve(extension);
  }

  unloadExtension(extension: ExtensionHandle): Promise<boolean> {
    const uuid = (extension as FakeExtension).uuid;
    this.calls.push({ kind: 'unloadExtension', uuid });
    if (this.unloadThrows.has(uuid)) {
      throw new Error(`unload failed for ${uuid}`);
    }
    this.known.delete(uuid);
    return Promise.resolve(true);
  }

  createExtensionObject(uuid: string, _dir: unknown): void {
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

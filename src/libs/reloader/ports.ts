/**
 * Small interfaces that the reloader uses to talk to its GNOME-Shell
 * collaborators.
 *
 * Mirrors the pattern in `src/ui/overlay/ports.ts`: the seam exists so the
 * pure logic (here, pruning stale reload UUIDs and orchestrating the reload
 * sequence) can be unit-tested with fakes without booting Gio. Keep the
 * surface palm-sized — only model what the reloader actually touches.
 *
 * Production implementations live in
 * `gnome-shell-extension-settings.ts`, `gnome-shell-extension-manager.ts`,
 * and `gnome-temp-copy-preparer.ts`. Test doubles live in `test-fakes.ts`.
 */

/**
 * Read/write access to GNOME Shell's enabled-extensions and
 * disabled-extensions GSettings arrays. The reloader uses this to prune
 * accumulated `<base>-reload-<digits>` UUIDs left behind by previous
 * `npm run dev` iterations.
 */
export interface ShellExtensionSettingsPort {
  /** Current contents of `org.gnome.shell enabled-extensions`. */
  getEnabled(): string[];
  /** Overwrite `org.gnome.shell enabled-extensions`. */
  setEnabled(uuids: string[]): void;
  /** Current contents of `org.gnome.shell disabled-extensions`. */
  getDisabled(): string[];
  /** Overwrite `org.gnome.shell disabled-extensions`. */
  setDisabled(uuids: string[]): void;
}

/**
 * Thin wrapper around `Main.extensionManager` so the reload orchestration
 * logic in `Reloader.reload()` can be exercised without a live GNOME Shell.
 *
 * The shape mirrors the surface of `ExtensionManager` that the reloader
 * actually touches — anything new the reloader needs goes here first.
 */
export interface ExtensionManagerPort {
  getUuids(): readonly string[];
  disableExtension(uuid: string): boolean;
  enableExtension(uuid: string): boolean;
  lookup(uuid: string): unknown | undefined;
  loadExtension(extension: unknown): Promise<unknown>;
  unloadExtension(extension: unknown): Promise<boolean>;
  createExtensionObject(uuid: string, dir: unknown, type: number): void;
}

/**
 * Owns the dev-only side effect of copying the installed extension to a
 * fresh `/tmp/<newUuid>/` and rewriting its `metadata.json` so GNOME Shell
 * treats it as a distinct extension. Pulled out of `Reloader` so the
 * orchestration logic stays testable with an in-memory fake.
 */
export interface TempCopyPreparer {
  /**
   * Copy installed extension files to a fresh `/tmp/<newUuid>/` and rewrite
   * `metadata.json` so its `uuid` field matches `newUuid`. Returns a
   * `Gio.File`-like handle that the caller passes to
   * `ExtensionManagerPort.createExtensionObject`.
   *
   * Returns `unknown` so the port stays free of `gi://` imports — the
   * production caller passes the handle straight through.
   */
  prepare(newUuid: string): unknown;
  /**
   * Best-effort cleanup of `/tmp` dirs whose names start with the base UUID
   * but differ from `currentTmpDir`. Errors are swallowed; this is
   * housekeeping, not a load-bearing operation.
   */
  cleanupOtherTempDirs(currentTmpDir: string): void;
}

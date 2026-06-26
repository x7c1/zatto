/**
 * Small interfaces that the reloader uses to talk to its GNOME-Shell
 * collaborators.
 *
 * Mirrors the pattern in `src/ui/overlay/ports.ts`: the seam exists so the
 * pure logic (here, pruning stale reload UUIDs) can be unit-tested with a
 * fake without booting Gio. Keep the surface palm-sized — only model what
 * the reloader actually touches.
 *
 * Production implementation lives in
 * `gnome-shell-extension-settings.ts` and wraps
 * `Gio.Settings.new('org.gnome.shell')`. Test doubles live in
 * `test-fakes.ts`.
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

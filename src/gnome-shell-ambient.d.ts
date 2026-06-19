/**
 * Minimal ambient declarations for the GNOME Shell extension runtime.
 *
 * GNOME Shell loads extensions via `resource://` module paths and exposes a
 * global `console` for logging. The upstream `@girs/gnome-shell` package
 * provides the underlying types; this file just re-exports them under the
 * `resource://` path so `import` statements in `extension.ts` resolve.
 */

declare module 'resource:///org/gnome/shell/extensions/extension.js' {
  export * from '@girs/gnome-shell/dist/extensions/extension';
}

// Global console for logging (GNOME Shell provides this at runtime).
declare const console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
  debug(...args: any[]): void;
};

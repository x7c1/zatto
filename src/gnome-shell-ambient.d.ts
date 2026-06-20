/**
 * Minimal ambient declarations for the GNOME Shell extension runtime.
 *
 * GNOME Shell loads extensions via `resource://` module paths and exposes a
 * global `console` for logging. The upstream `@girs/gnome-shell` package
 * provides the underlying types; this file just re-exports them under the
 * `resource://` and `gi://` paths so `import` statements in extension code
 * resolve.
 */

/// <reference types="@girs/gio-2.0/gio-2.0-ambient" />
/// <reference types="@girs/glib-2.0/glib-2.0-ambient" />

declare module 'resource:///org/gnome/shell/extensions/extension.js' {
  export * from '@girs/gnome-shell/dist/extensions/extension';
}

declare module 'resource:///org/gnome/shell/ui/main.js' {
  export * from '@girs/gnome-shell/dist/ui/main';
}

declare module 'gi://Gio' {
  export * from '@girs/gio-2.0/gio-2.0';
  export { default } from '@girs/gio-2.0/gio-2.0';
}

declare module 'gi://GLib' {
  export * from '@girs/glib-2.0/glib-2.0';
  export { default } from '@girs/glib-2.0/glib-2.0';
}

// Global console for logging (GNOME Shell provides this at runtime).
declare const console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
  debug(...args: any[]): void;
};

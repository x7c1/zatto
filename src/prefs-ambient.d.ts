/**
 * Ambient declarations for the preferences process (`prefs.js`), which runs
 * GTK 4 and libadwaita rather than the Shell's Clutter / St. Mirrors
 * `gnome-shell-ambient.d.ts`: the `@girs` packages provide the types, this
 * file maps the import paths used by `src/prefs.ts` onto them.
 */

/// <reference types="@girs/adw-1/adw-1-ambient" />
/// <reference types="@girs/gdk-4.0/gdk-4.0-ambient" />
/// <reference types="@girs/gtk-4.0/gtk-4.0-ambient" />

declare module 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js' {
  export * from '@girs/gnome-shell/dist/extensions/prefs';
}

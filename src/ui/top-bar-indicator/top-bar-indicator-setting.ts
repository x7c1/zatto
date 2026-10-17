/**
 * The `show-top-bar-indicator` GSettings key. Kept free of GNOME imports so
 * both the extension and the preferences window can use it and a test can
 * hold the default to the schema.
 */

/** GSettings key telling whether the top bar indicator is shown. */
export const SHOW_TOP_BAR_INDICATOR_KEY = 'show-top-bar-indicator';

/**
 * The schema's default for {@link SHOW_TOP_BAR_INDICATOR_KEY}. The extension
 * falls back to it only when the settings schema cannot be loaded; a test
 * keeps it equal to the default in the schema XML.
 */
export const DEFAULT_SHOW_TOP_BAR_INDICATOR = true;

/**
 * Pure handling of the `hot-corners` GSettings key: turning the stored
 * string list into the corners the trigger installs, and back. Kept free of
 * GNOME imports so both the extension and the preferences window can use it
 * and it can be unit-tested.
 */

import type { HotCorner } from './hot-corner-geometry.js';

/** GSettings key holding the corners that open the depth view. */
export const HOT_CORNERS_KEY = 'hot-corners';

/** Every known corner, in the fixed order a parsed setting keeps. */
const ALL_HOT_CORNERS: readonly HotCorner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

/**
 * The schema's default for {@link HOT_CORNERS_KEY}. The extension falls back
 * to it only when the settings schema cannot be loaded; a test keeps it equal
 * to the default in the schema XML.
 */
export const DEFAULT_HOT_CORNERS: readonly HotCorner[] = ['bottom-left', 'bottom-right'];

function isHotCorner(value: string): value is HotCorner {
  return (ALL_HOT_CORNERS as readonly string[]).includes(value);
}

/**
 * Parse the stored `hot-corners` value: known corner names are kept in the
 * order of {@link ALL_HOT_CORNERS} with duplicates dropped, and each distinct
 * unknown string is ignored with one warning. An empty result is valid and
 * means no corner opens the depth view.
 */
export function parseHotCorners(
  values: readonly string[],
  warn: (message: string) => void = (message) => console.warn(message)
): HotCorner[] {
  const unknown = new Set<string>();
  for (const value of values) {
    if (!isHotCorner(value) && !unknown.has(value)) {
      unknown.add(value);
      warn(`[Zatto] Ignoring unknown corner in '${HOT_CORNERS_KEY}': ${JSON.stringify(value)}`);
    }
  }
  return ALL_HOT_CORNERS.filter((corner) => values.includes(corner));
}

/**
 * The value to store after switching `corner` on or off, given the stored
 * `values`: every other known corner keeps its state (including one the
 * preferences window does not offer), unknown strings are dropped.
 */
export function withHotCorner(
  values: readonly string[],
  corner: HotCorner,
  enabled: boolean
): HotCorner[] {
  const current = parseHotCorners(values, () => {});
  return ALL_HOT_CORNERS.filter((c) => (c === corner ? enabled : current.includes(c)));
}

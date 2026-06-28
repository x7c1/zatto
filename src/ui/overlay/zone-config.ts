/**
 * Internal JSON-shaped configuration boundary for the zone picker.
 *
 * Step 4 hardcoded the zone rectangles, the `wm_class` → zone routing
 * table, the fallback zone, and the per-cell padding across two pure
 * modules and one GJS choreographer. This module collects all four into
 * a single {@link ZoneConfig} record so the rest of the overlay stack
 * receives them as one injected dependency. The shape is intentionally
 * a plain JSON-serializable object: future PoC steps (file loader,
 * GSettings backend, prefs UI) will plug in here without rippling
 * through consumers.
 *
 * {@link DEFAULT_ZONE_CONFIG} is the source of truth for production
 * wiring today. `extension.ts` hands it to `GnomeWindowMirror` directly;
 * once a real config source lands the only change there will be to
 * swap the literal for a loader-returned value.
 *
 * The module is pure on purpose — it does not import from `gi://*` or
 * `resource:///*` — so vitest can exercise the defaults without a GJS
 * shim and so the future loader is free to live in either world.
 */

import type { FractionalRect, ZoneKey } from './zone-layout.js';

/**
 * Everything the zone picker needs to lay out windows. All fields are
 * plain JSON values (numbers, strings, nested records, `null`) so a
 * loader can produce one from a file or GSettings without runtime
 * adapters.
 */
export interface ZoneConfig {
  /**
   * Zone identifier → fractional rect inside the monitor (`x`, `y`,
   * `w`, `h` ∈ `[0, 1]`). Zones must tile the unit square without
   * overlap or gap — see {@link DEFAULT_ZONE_CONFIG} for the four-
   * quadrant default. The {@link ZoneKey} alias keeps the production
   * default strongly typed; loader-provided configs may produce extra
   * keys at runtime, which is why the snapshot port surface uses
   * `Record<string, number>` rather than the fixed-four shape.
   */
  readonly zones: Readonly<Record<ZoneKey, FractionalRect>>;
  /**
   * `wm_class` → zone identifier routing table. Matching is
   * case-insensitive at lookup time (see `resolveZone` in
   * `app-zone-map.ts`); keys are written in their vendor-canonical
   * form so the table doubles as documentation. Listing the same app
   * under multiple spellings (e.g. `Code` and `code`, snap suffixes)
   * is harmless as long as they agree on the target zone.
   */
  readonly appZone: Readonly<Record<string, ZoneKey>>;
  /**
   * Zone that catches any window whose `wm_class` is not in
   * {@link appZone}. Set to `null` to drop unrouted windows entirely
   * (they are skipped — not mirrored, not counted) instead of bucketing
   * them into a catch-all zone.
   */
  readonly fallbackZone: ZoneKey | null;
  /**
   * Padding (in monitor pixels) applied to every grid cell so adjacent
   * clones do not visually touch. `0` disables the gutter. Negative
   * values are rejected by the test guard since they would expand the
   * cell rather than shrink it.
   */
  readonly cellPaddingPx: number;
}

/**
 * Production default. Byte-equivalent to the step 4 wiring: the four
 * quadrants, the same `wm_class` table (canonical + lowercase + snap
 * doublets), `bottomRight` as the fallback, and an 8 px cell gutter.
 *
 * Pinned by tests so reviewers see any silent default drift in a diff.
 */
export const DEFAULT_ZONE_CONFIG: ZoneConfig = {
  zones: {
    topLeft: { x: 0, y: 0, w: 0.5, h: 0.5 },
    topRight: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    bottomLeft: { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    bottomRight: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  },
  appZone: {
    // top-left: dev surfaces
    Code: 'topLeft',
    code: 'topLeft',
    'code-oss': 'topLeft',
    'jetbrains-idea': 'topLeft',
    'com.mitchellh.ghostty': 'topLeft',
    'org.gnome.Terminal': 'topLeft',
    Alacritty: 'topLeft',

    // top-right: browsers / reading
    'Google-chrome': 'topRight',
    'google-chrome': 'topRight',
    firefox: 'topRight',
    firefox_firefox: 'topRight',
    'Mozilla Firefox': 'topRight',
    Chromium: 'topRight',
    'Vivaldi-snap': 'topRight',

    // bottom-left: chat / comms
    Slack: 'bottomLeft',
    discord: 'bottomLeft',
    'zoom ': 'bottomLeft',
    // Parked here for now — the chat zone is otherwise empty on the
    // author's machine and Settings is a frequent enough surface that
    // bottom-right (fallback) buries it under everything else. Easy to
    // move once user-defined routing lands.
    'org.gnome.Settings': 'bottomLeft',
  },
  fallbackZone: 'bottomRight',
  cellPaddingPx: 8,
};

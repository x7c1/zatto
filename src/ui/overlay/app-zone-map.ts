/**
 * Hardcoded `wm_class` → zone routing for PoC step 4.
 *
 * Kept as a pure constant + a single `resolveZone()` helper so:
 *
 *   1. The production `GnomeWindowMirror` stays focused on Clutter / Meta
 *      glue and doesn't grow a routing branch of its own.
 *   2. Tests can verify routing without touching GJS.
 *   3. PoC step 5 (JSON-driven config) replaces this file by swapping the
 *      const for a loader, without disturbing call sites.
 *
 * Picking which apps land where is intentionally opinionated for the PoC:
 * a handful of common dev / browser / chat clients, anchored against the
 * author's machine. Anything not listed falls into {@link FALLBACK_ZONE}.
 */

import type { ZoneKey } from './zone-layout.js';

/**
 * Zone that catches any window whose `wm_class` is not in {@link APP_ZONE}.
 * Picked as `bottomRight` for PoC step 4 — step 5 will let the user
 * configure it (or disable the fallback entirely).
 */
export const FALLBACK_ZONE: ZoneKey = 'bottomRight';

/**
 * `wm_class` → zone routing table. Keys match what
 * `MetaWindow.get_wm_class()` returns; values pick one of the four
 * quadrants exposed by {@link ZONE_RECTS}.
 *
 * The map is intentionally small and opinionated for the PoC:
 *   - top-left   = primary work surfaces (editor, terminal)
 *   - top-right  = browsers / docs
 *   - bottom-left = chat / comms
 *   - bottom-right = everything else (see {@link FALLBACK_ZONE})
 */
export const APP_ZONE: Readonly<Record<string, ZoneKey>> = {
  // top-left: dev surfaces
  Code: 'topLeft',
  'code-oss': 'topLeft',
  'jetbrains-idea': 'topLeft',
  'com.mitchellh.ghostty': 'topLeft',
  'org.gnome.Terminal': 'topLeft',
  Alacritty: 'topLeft',

  // top-right: browsers / reading
  'Google-chrome': 'topRight',
  firefox: 'topRight',
  'Mozilla Firefox': 'topRight',
  Chromium: 'topRight',

  // bottom-left: chat / comms
  Slack: 'bottomLeft',
  discord: 'bottomLeft',
  'zoom ': 'bottomLeft',
};

/**
 * Resolve a window's `wm_class` to its target zone. Anything missing or
 * unknown falls back to {@link FALLBACK_ZONE}.
 *
 * Why accept `null`/`undefined`/empty: `MetaWindow.get_wm_class()` can
 * legitimately return any of these for windows that haven't finished
 * setting their class hints yet, and we don't want a transient empty
 * `wm_class` to drop the window on the floor.
 */
export function resolveZone(wmClass: string | null | undefined): ZoneKey {
  if (wmClass === null || wmClass === undefined || wmClass === '') {
    return FALLBACK_ZONE;
  }
  return APP_ZONE[wmClass] ?? FALLBACK_ZONE;
}

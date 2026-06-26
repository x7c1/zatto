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
 * `wm_class` → zone routing table. Keys are written in the form most
 * useful as documentation (the vendor's canonical class), but matching
 * is case-insensitive at lookup time — see {@link resolveZone} — so
 * adding both `Code` and `code` is harmless and only one of the two is
 * strictly required.
 *
 * The map is intentionally small and opinionated for the PoC:
 *   - top-left   = primary work surfaces (editor, terminal)
 *   - top-right  = browsers / docs
 *   - bottom-left = chat / comms
 *   - bottom-right = everything else (see {@link FALLBACK_ZONE})
 *
 * Where two spellings of the same app appear in the wild (e.g. mutter
 * reports `Code` on some distros, `code` on others; snap packages add a
 * `-snap` / `_snap` suffix), both forms are listed explicitly so the
 * table doubles as documentation of what has actually been observed.
 */
export const APP_ZONE: Readonly<Record<string, ZoneKey>> = {
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
  // move once user-defined routing lands in step 5.
  'org.gnome.Settings': 'bottomLeft',
};

/**
 * Case-insensitive view of {@link APP_ZONE}, built once at module load.
 *
 * Why a separate lookup: mutter is inconsistent about case in
 * `wm_class` (e.g. `Code` vs `code`, `Google-chrome` vs `google-chrome`)
 * across distros and even across packaging variants, so we normalize to
 * lowercase for matching. We keep {@link APP_ZONE} itself in its
 * original form so the table still reads as documentation of the
 * vendor's canonical class names.
 *
 * If two entries in {@link APP_ZONE} differ only in case and map to the
 * same zone (the common case), they collapse harmlessly here. If they
 * ever disagree, the later entry wins; we accept that because the next
 * step replaces this whole module with a JSON loader that can validate
 * properly.
 */
const APP_ZONE_LOOKUP: ReadonlyMap<string, ZoneKey> = new Map(
  Object.entries(APP_ZONE).map(([key, zone]) => [key.toLowerCase(), zone])
);

/**
 * Resolve a window's `wm_class` to its target zone. Matching is
 * case-insensitive (see {@link APP_ZONE_LOOKUP}). Anything missing or
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
  return APP_ZONE_LOOKUP.get(wmClass.toLowerCase()) ?? FALLBACK_ZONE;
}

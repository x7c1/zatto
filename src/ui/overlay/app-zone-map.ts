/**
 * `wm_class` → zone resolution against an injected {@link ZoneConfig}.
 *
 * Kept as a single pure helper so:
 *
 *   1. The production `GnomeWindowMirror` stays focused on Clutter / Meta
 *      glue and doesn't grow a routing branch of its own.
 *   2. Tests can verify routing without touching GJS.
 *   3. The seam stays narrow: future loaders only need to produce a
 *      `ZoneConfig`; nothing here needs to change.
 *
 * The routing table itself lives in {@link ZoneConfig.appZone}. This
 * module just normalizes lookup case and falls back to
 * {@link ZoneConfig.fallbackZone} (which may be `null` to drop the
 * window entirely).
 */

import type { ZoneConfig } from './zone-config.js';
import type { ZoneKey } from './zone-layout.js';

/**
 * Resolve a window's `wm_class` to its target zone given a config.
 *
 * Matching is case-insensitive: mutter is inconsistent about case in
 * `wm_class` (e.g. `Code` vs `code`, `Google-chrome` vs
 * `google-chrome`) across distros and packaging variants, so we
 * lowercase both sides at lookup time. {@link ZoneConfig.appZone} keys
 * are kept in their vendor-canonical form so the table reads as
 * documentation.
 *
 * When `wmClass` is missing or unknown the function returns
 * `config.fallbackZone`. A `null` fallback signals "drop this window
 * entirely" — the caller is expected to skip mounting it rather than
 * bucketing it into some default zone.
 *
 * The lowercase lookup map is rebuilt per call from `config.appZone`.
 * That is a known throwaway micro-cost we accept while configs are
 * static; a future loader can memoize by config identity if it ever
 * matters. Premature optimization here would entangle the helper with
 * config-source assumptions it currently has no business knowing.
 */
export function resolveZone(
  config: ZoneConfig,
  wmClass: string | null | undefined
): ZoneKey | null {
  if (wmClass === null || wmClass === undefined || wmClass === '') {
    return config.fallbackZone;
  }
  const lookup = new Map<string, ZoneKey>(
    Object.entries(config.appZone).map(([key, zone]) => [key.toLowerCase(), zone])
  );
  return lookup.get(wmClass.toLowerCase()) ?? config.fallbackZone;
}

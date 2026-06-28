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
 * module just normalizes lookup case, walks the configured matcher rules
 * on a miss, optionally retries against `wm_class_instance`, and falls
 * back to {@link ZoneConfig.fallbackZone} (which may be `null` to drop
 * the window entirely).
 */

import type { MatchRule, ZoneConfig } from './zone-config.js';
import type { ZoneKey } from './zone-layout.js';

/**
 * Resolve a window's class to its target zone.
 *
 * The pipeline runs the resolution attempt against `wmClass` first. If
 * that returns `null` and {@link ZoneConfig.wmClassInstanceFallback} is
 * enabled, the same pipeline is re-run against `wmClassInstance` — but
 * only when the instance string differs from the class (case-insensitive)
 * and is non-empty. The instance pass exists to recover apps where the
 * primary class is opaque but the instance is recognizable, without
 * doubling the lookup cost for the common case where they agree.
 *
 * If neither pass produces a hit the function returns
 * {@link ZoneConfig.fallbackZone}, which may itself be `null` to signal
 * "drop this window entirely" — the caller is expected to skip mounting
 * unrouted windows rather than bucketing them anywhere.
 */
export function resolveZone(
  config: ZoneConfig,
  wmClass: string | null | undefined,
  wmClassInstance?: string | null | undefined
): ZoneKey | null {
  const fromClass = tryResolve(config, wmClass);
  if (fromClass !== null) {
    return fromClass;
  }

  if (
    config.wmClassInstanceFallback &&
    wmClassInstance !== null &&
    wmClassInstance !== undefined &&
    wmClassInstance !== '' &&
    wmClassInstance.toLowerCase() !== (wmClass ?? '').toLowerCase()
  ) {
    const fromInstance = tryResolve(config, wmClassInstance);
    if (fromInstance !== null) {
      return fromInstance;
    }
  }

  return config.fallbackZone;
}

/**
 * Apply the full single-candidate resolution pipeline:
 *
 *   1. Exact, case-insensitive lookup in {@link ZoneConfig.appZone}.
 *   2. Walk {@link ZoneConfig.appZoneRules} in array order; first match
 *      wins. `suffixStrip` re-enters the exact map only (not the rule
 *      list — see {@link MatchRule}); `prefix` returns its `zone`
 *      directly.
 *
 * Returns `null` when nothing matches. The caller decides what to do
 * with that (try the instance pass, fall back to the configured zone,
 * or drop the window).
 */
function tryResolve(config: ZoneConfig, candidate: string | null | undefined): ZoneKey | null {
  if (candidate === null || candidate === undefined || candidate === '') {
    return null;
  }
  const lookup = exactMap(config);
  const lower = candidate.toLowerCase();

  const exact = lookup.get(lower);
  if (exact !== undefined) {
    return exact;
  }

  for (const rule of config.appZoneRules) {
    const hit = applyRule(rule, candidate, lower, lookup);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

/** Run one matcher rule and return its zone hit, or `null` on miss. */
function applyRule(
  rule: MatchRule,
  candidate: string,
  lowerCandidate: string,
  lookup: ReadonlyMap<string, ZoneKey>
): ZoneKey | null {
  if (rule.kind === 'suffixStrip') {
    const stripped = stripSuffixCI(candidate, rule.suffix);
    if (stripped === null) {
      return null;
    }
    return lookup.get(stripped.toLowerCase()) ?? null;
  }
  // 'prefix' — case-insensitive startsWith; on hit the rule's zone wins
  // outright (no re-lookup, no chaining).
  if (lowerCandidate.startsWith(rule.pattern.toLowerCase())) {
    return rule.zone;
  }
  return null;
}

/**
 * Build the lowercase-keyed exact lookup map from
 * {@link ZoneConfig.appZone}.
 *
 * Rebuilt per call by design: PoC configs are small (~20 entries) and
 * static within a session, so the throwaway cost is negligible compared
 * to the complexity of invalidating a memoized map when a future loader
 * starts swapping configs at runtime. Premature memoization here would
 * entangle the helper with config-source assumptions it currently has
 * no business knowing.
 */
function exactMap(config: ZoneConfig): ReadonlyMap<string, ZoneKey> {
  return new Map(Object.entries(config.appZone).map(([key, zone]) => [key.toLowerCase(), zone]));
}

/**
 * Case-insensitive single-strip: if `candidate` ends with `suffix`
 * (case-insensitive), return `candidate` with one copy of the suffix
 * removed (preserving the original casing of the prefix). Otherwise —
 * including when `suffix` is empty — return `null`.
 *
 * Stripping is single-pass: a `Vivaldi-snap-snap` candidate produces
 * `Vivaldi-snap`, not `Vivaldi`. That keeps the rule's behavior
 * predictable and prevents accidental over-stripping for users who
 * legitimately have a class name ending in the suffix as part of its
 * canonical form.
 */
function stripSuffixCI(candidate: string, suffix: string): string | null {
  if (suffix.length === 0 || candidate.length < suffix.length) {
    return null;
  }
  const tail = candidate.slice(candidate.length - suffix.length);
  if (tail.toLowerCase() !== suffix.toLowerCase()) {
    return null;
  }
  return candidate.slice(0, candidate.length - suffix.length);
}

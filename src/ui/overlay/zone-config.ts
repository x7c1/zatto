/**
 * Internal JSON-shaped configuration boundary for the zone picker.
 *
 * Step 4 hardcoded the zone rectangles, the `wm_class` → zone routing
 * table, the fallback zone, and the inter-window gap across two pure
 * modules and one GJS choreographer. This module collects all of those
 * — together with the step 5b matcher pipeline and the step 5c
 * animation settings — into a single {@link ZoneConfig} record so the
 * rest of the overlay stack receives them as one injected dependency.
 * The shape is intentionally a plain JSON-serializable object: future
 * PoC steps (file loader, GSettings backend, prefs UI) will plug in
 * here without rippling through consumers.
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
 * Non-exact match rule applied after the exact {@link ZoneConfig.appZone}
 * lookup misses.
 *
 * - `'prefix'`: case-insensitive `startsWith` against the candidate; on
 *   match, the rule's `zone` wins outright (no further re-lookup). Use
 *   this for families of `wm_class` values that share a prefix and route
 *   to the same zone — e.g. `chrome-<appid>-Default` Chrome PWAs which
 *   we cannot enumerate ahead of time.
 * - `'suffixStrip'`: if the candidate ends with `suffix`
 *   (case-insensitive), strip it once and retry the EXACT
 *   {@link ZoneConfig.appZone} map only — the stripped form does NOT
 *   re-enter the rule list (so suffix rules are not recursive and a
 *   `suffixStrip` cannot chain into a `prefix`). This lets a single
 *   `Vivaldi: topRight` entry in the exact map cover the snap-packaged
 *   `Vivaldi-snap` without an explicit duplicate.
 *
 * Rules in {@link ZoneConfig.appZoneRules} are evaluated in array order;
 * first match wins. Order therefore encodes priority.
 */
export type MatchRule =
  | { readonly kind: 'prefix'; readonly pattern: string; readonly zone: ZoneKey }
  | { readonly kind: 'suffixStrip'; readonly suffix: string };

/**
 * Identifier for the easing curve applied to clone mount/unmount eases.
 *
 * Kept as a small string-typed enum (rather than a raw
 * `Clutter.AnimationMode` value) so {@link ZoneConfig} stays plain JSON
 * — loadable from a file or GSettings without runtime adapters — and so
 * the production `GnomeWindowMirror` is the single place that maps
 * these strings to `Clutter.AnimationMode` constants.
 */
export type EasingKey = 'easeOutQuad' | 'easeOutCubic' | 'linear';

/**
 * Animation settings for the overlay's clone mount / unmount eases.
 *
 * - `enabled` is the master switch. When `false`, the overlay falls
 *   back to instant `set_position` / `set_size` (the step 5b behavior),
 *   regardless of system or per-curve settings. The production
 *   `GnomeWindowMirror` AND additionally bows to the user's
 *   `org.gnome.desktop.interface.enable-animations` GSettings, so
 *   reduced-motion sessions stay still even with `enabled: true`.
 * - `durationMs` is the ease duration in wall-clock ms. The default
 *   value targets the same perceived speed as the Activities Overview.
 * - `easing` selects the curve. {@link EasingKey} keeps the wire format
 *   independent of `Clutter.AnimationMode` integers.
 */
export interface AnimationConfig {
  readonly enabled: boolean;
  readonly durationMs: number;
  readonly easing: EasingKey;
}

/**
 * Backdrop behavior while the overlay is open.
 *
 * Step 5d ships a single behavior — hiding the user's real windows so
 * the live `Clutter.Clone` thumbnails are not visually mixed with their
 * sources. The schema is intentionally a flat boolean kill switch plus a
 * fade duration rather than a `mode: 'hide' | 'blur'` discriminator: we
 * have exactly one behavior today, and inventing the discriminator now
 * would commit reviewers to a shape we can't validate until a second
 * behavior (e.g. `Shell.BlurEffect`) actually lands. Step 6+ can rename
 * / restructure deliberately when that constraint is real.
 *
 * - `hideRealWindows` is the master kill switch. When `false`, the
 *   overlay leaves `global.window_group` alone and falls back to the
 *   step 5c behavior (dimmer + clones over the live desktop).
 * - `fadeMs` is the cross-dissolve duration when easing is otherwise
 *   enabled. Defaults to `0` (hard-cut). The original step 5d design
 *   matched this to {@link AnimationConfig.durationMs} so the real
 *   windows would cross-dissolve as the clones flew into their zones,
 *   but on-hardware verification revealed that during the 220 ms fade
 *   the source window stays semi-transparent and `Clutter.Clone`
 *   replays its paint operations — producing a visible "ghost source"
 *   under the flying clone. The hard-cut sidesteps the artifact at the
 *   cost of a less polished transition. Set to a positive value (e.g.
 *   `220`) to opt back into the cross-dissolve once / if a different
 *   clone strategy (e.g. `Shell.WindowPreview`) removes the source
 *   multi-paint. The system-wide `enable-animations` GSettings still
 *   wins inside the production port — `fadeMs > 0` is necessary but
 *   not sufficient.
 */
export interface BackdropConfig {
  readonly hideRealWindows: boolean;
  readonly fadeMs: number;
}

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
   * Ordered match rules consulted after the exact {@link appZone} lookup
   * misses. Each rule is evaluated in array order, first match wins.
   * See {@link MatchRule} for the per-kind semantics. The rules cover
   * real-world `wm_class` variability the exact map can't enumerate —
   * snap suffixes, Chrome PWA prefixes, etc.
   */
  readonly appZoneRules: ReadonlyArray<MatchRule>;
  /**
   * Zone that catches any window whose `wm_class` is not in
   * {@link appZone}. Set to `null` to drop unrouted windows entirely
   * (they are skipped — not mirrored, not counted) instead of bucketing
   * them into a catch-all zone.
   */
  readonly fallbackZone: ZoneKey | null;
  /**
   * Pixel gap between adjacent packed windows within a zone — both
   * inter-item (within a row) and inter-row. `0` disables the gutter.
   * Negative values are rejected by the test guard since they would
   * make neighbors overlap.
   *
   * Semantically this is "gap between windows", not "padding around
   * each cell": step 5c replaced the uniform-grid + centered-fit
   * pipeline with a justified-row packer where items already sit flush
   * against each other along the row, so there is no longer a per-cell
   * padding region to shrink — only the gutter between neighbors. The
   * rename from `cellPaddingPx` is a deliberate signal of that shift.
   */
  readonly windowGapPx: number;
  /**
   * When `true` (default), if neither {@link appZone} nor
   * {@link appZoneRules} resolves the primary `wm_class`, the whole
   * resolution pipeline is retried against `wm_class_instance` (a
   * sibling property on `MetaWindow`). The instance pass is skipped
   * when the instance string equals the class string
   * (case-insensitive) — which is the common case — or when this flag
   * is `false`. Useful for apps where the primary class is unhelpful
   * but the instance is recognizable.
   */
  readonly wmClassInstanceFallback: boolean;
  /**
   * Mount / unmount animation settings. See {@link AnimationConfig}.
   * The production `GnomeWindowMirror` honors this on top of the user's
   * system-wide reduced-motion preference — neither side overrides the
   * other in the "on" direction, but either can turn easing off.
   */
  readonly animation: AnimationConfig;
  /**
   * Backdrop behavior while the overlay is open. See {@link BackdropConfig}.
   * Step 5d added the hide-real-windows behavior; the schema is
   * intentionally minimal until a second backdrop mode (e.g. blur)
   * actually ships.
   */
  readonly backdrop: BackdropConfig;
}

/**
 * Production default. Mostly byte-equivalent to the step 4/5 wiring —
 * the four quadrants, the same canonical `wm_class` table, `bottomRight`
 * as the fallback, an 8 px inter-window gap — plus the step 5b matcher
 * pipeline (snap-suffix stripping, a Chrome PWA prefix collapse, and
 * `wm_class_instance` fallback) and the step 5c mount/unmount ease
 * (220 ms `easeOutQuad`).
 *
 * Note the deliberate Vivaldi cleanup: the legacy `Vivaldi-snap` entry
 * is removed in favor of `Vivaldi: 'topRight'`. The suffix-strip rule
 * recovers the snap variant via re-lookup, which demonstrates the rule
 * is doing real work and avoids the duplicate. `firefox_firefox` stays
 * as-is because that's a Mutter instance-name quirk, not a snap suffix.
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
    Vivaldi: 'topRight',

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
  appZoneRules: [
    // Strip snap suffixes and re-lookup the exact map. Covers Vivaldi
    // (`Vivaldi-snap` -> `Vivaldi`) and any other distro that tags snap
    // builds with one of these suffixes. Two separate rules instead of
    // one regex to keep the data shape declarative.
    { kind: 'suffixStrip', suffix: '-snap' },
    { kind: 'suffixStrip', suffix: '_snap' },
    // Chrome PWAs report a per-app id like `chrome-<appid>-Default`. We
    // can't enumerate them ahead of time, so collapse the entire family
    // into the browsers zone with a prefix rule.
    { kind: 'prefix', pattern: 'chrome-', zone: 'topRight' },
  ],
  fallbackZone: 'bottomRight',
  windowGapPx: 8,
  wmClassInstanceFallback: true,
  animation: {
    enabled: true,
    durationMs: 220,
    easing: 'easeOutQuad',
  },
  backdrop: { hideRealWindows: true, fadeMs: 0 },
};

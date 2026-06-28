import { describe, expect, it } from 'vitest';
import { resolveZone } from './app-zone-map.js';
import { DEFAULT_ZONE_CONFIG, type ZoneConfig } from './zone-config.js';
import type { ZoneKey } from './zone-layout.js';

describe('resolveZone', () => {
  it('returns the mapped zone for a known wm_class', () => {
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'Code')).toBe('topLeft');
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'Google-chrome')).toBe('topRight');
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'Slack')).toBe('bottomLeft');
  });

  it('falls back for an unknown wm_class', () => {
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'NotAnApp')).toBe(DEFAULT_ZONE_CONFIG.fallbackZone);
  });

  it('falls back for null', () => {
    expect(resolveZone(DEFAULT_ZONE_CONFIG, null)).toBe(DEFAULT_ZONE_CONFIG.fallbackZone);
  });

  it('falls back for undefined', () => {
    expect(resolveZone(DEFAULT_ZONE_CONFIG, undefined)).toBe(DEFAULT_ZONE_CONFIG.fallbackZone);
  });

  it('falls back for empty string', () => {
    // get_wm_class() can return '' for windows that have not yet set their
    // class hints; treat that the same as unknown rather than indexing the
    // map with an empty key.
    expect(resolveZone(DEFAULT_ZONE_CONFIG, '')).toBe(DEFAULT_ZONE_CONFIG.fallbackZone);
  });

  it('matches case-insensitively so distro-specific casing still routes', () => {
    // Mutter is inconsistent about case across distros and packaging
    // variants — e.g. `Code` vs `code`, `Google-chrome` vs `google-chrome`.
    // resolveZone() lowercases both sides at lookup time so any spelling
    // of a registered class lands in the same zone.
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'Code')).toBe('topLeft');
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'code')).toBe('topLeft');
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'CODE')).toBe('topLeft');
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'Google-chrome')).toBe('topRight');
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'google-chrome')).toBe('topRight');
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'GOOGLE-CHROME')).toBe('topRight');
  });

  it('routes snap-packaged classes observed on dogfood machines', () => {
    // Snap packages of the same app report a different wm_class than the
    // distro builds. Two mechanisms cover them:
    //   - `firefox_firefox` is registered explicitly in the exact map
    //     because it's an instance-name quirk, not a snap suffix.
    //   - `Vivaldi-snap` falls through to the `-snap` suffix-strip rule,
    //     which re-looks up `Vivaldi` in the exact map.
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'firefox_firefox')).toBe('topRight');
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'Vivaldi-snap')).toBe('topRight');
  });

  it('parks org.gnome.Settings into the chat zone as a placeholder', () => {
    // Settings has no natural home in the dev/browser/chat trichotomy;
    // putting it in the otherwise-empty bottom-left keeps it reachable
    // without hiding it under the fallback pile.
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'org.gnome.Settings')).toBe('bottomLeft');
  });

  it('routes Chrome PWAs to the browsers zone via the prefix rule', () => {
    // Chrome PWAs report a per-app id like `chrome-<appid>-Default` which
    // we cannot enumerate ahead of time. Step 5b ships a `prefix:
    // 'chrome-' -> topRight` rule so the entire PWA family collapses
    // into the browsers zone instead of piling up in the fallback.
    expect(
      resolveZone(DEFAULT_ZONE_CONFIG, 'chrome-fmpnliohjhemenmnlpbfagaolkdacoja-Default')
    ).toBe('topRight');
  });

  it('returns null for an unknown wm_class when fallbackZone is null', () => {
    // `fallbackZone: null` is the "drop unrouted windows entirely"
    // mode: unregistered classes must produce null so the caller knows
    // to skip mounting them rather than bucketing them anywhere.
    const config = { ...DEFAULT_ZONE_CONFIG, fallbackZone: null };
    expect(resolveZone(config, 'TotallyUnknown')).toBeNull();
  });

  it('still routes mapped wm_class to its zone even when fallbackZone is null', () => {
    // The null fallback only affects unrouted windows; explicit
    // mappings must continue to win.
    const config = { ...DEFAULT_ZONE_CONFIG, fallbackZone: null };
    expect(resolveZone(config, 'Code')).toBe('topLeft');
  });

  it('returns null for null wm_class when fallbackZone is null', () => {
    const config = { ...DEFAULT_ZONE_CONFIG, fallbackZone: null };
    expect(resolveZone(config, null)).toBeNull();
  });
});

describe('resolveZone with appZoneRules', () => {
  // A minimal config that only contains what each test needs. Keeping
  // these synthetic (rather than reusing DEFAULT_ZONE_CONFIG) makes each
  // assertion explicit about exactly which rule is doing the work, so a
  // future default-config tweak does not silently widen test coverage.
  const baseZones = DEFAULT_ZONE_CONFIG.zones;

  it('prefers an exact match over a prefix rule that would also match', () => {
    // If a `wm_class` is in the exact map, the rule list must never run
    // — otherwise users who pin an app would see a broader prefix rule
    // override their intent.
    const config: ZoneConfig = {
      zones: baseZones,
      appZone: { 'chrome-gmail-Default': 'bottomLeft' },
      appZoneRules: [{ kind: 'prefix', pattern: 'chrome-', zone: 'topRight' }],
      fallbackZone: 'bottomRight',
      windowGapPx: 0,
      wmClassInstanceFallback: false,
    };
    expect(resolveZone(config, 'chrome-gmail-Default')).toBe('bottomLeft');
  });

  it('composes suffixStrip with the exact map (Vivaldi case)', () => {
    // The whole point of `suffixStrip` is to avoid duplicating an exact
    // map entry for every snap variant. Verify the re-lookup actually
    // resolves the stripped form.
    const config: ZoneConfig = {
      zones: baseZones,
      appZone: { Vivaldi: 'topRight' },
      appZoneRules: [{ kind: 'suffixStrip', suffix: '-snap' }],
      fallbackZone: null,
      windowGapPx: 0,
      wmClassInstanceFallback: false,
    };
    expect(resolveZone(config, 'Vivaldi-snap')).toBe('topRight');
  });

  it('does not recursively re-strip suffixes', () => {
    // A `Vivaldi-snap-snap` candidate strips once to `Vivaldi-snap`, and
    // because the stripped form is looked up only in the exact map (not
    // the rule list), the second `-snap` is not removed. This keeps
    // suffix rules predictable and prevents accidental over-stripping.
    const config: ZoneConfig = {
      zones: baseZones,
      appZone: { Vivaldi: 'topRight' },
      appZoneRules: [{ kind: 'suffixStrip', suffix: '-snap' }],
      fallbackZone: null,
      windowGapPx: 0,
      wmClassInstanceFallback: false,
    };
    expect(resolveZone(config, 'Vivaldi-snap-snap')).toBeNull();
  });

  it('honors prefix rule order (first match wins)', () => {
    // Two rules whose prefixes both match the candidate: the earlier
    // rule's zone must win. Verifies array order is interpreted as
    // priority.
    const config: ZoneConfig = {
      zones: baseZones,
      appZone: {},
      appZoneRules: [
        { kind: 'prefix', pattern: 'chrome-', zone: 'topRight' },
        { kind: 'prefix', pattern: 'chrome-mail', zone: 'bottomLeft' },
      ],
      fallbackZone: null,
      windowGapPx: 0,
      wmClassInstanceFallback: false,
    };
    expect(resolveZone(config, 'chrome-mail-Default')).toBe('topRight');
  });

  it('matches prefix rules case-insensitively', () => {
    // Just like the exact map, prefix matching lowercases both sides so
    // `Chrome-FOO` and `chrome-foo` route identically.
    const config: ZoneConfig = {
      zones: baseZones,
      appZone: {},
      appZoneRules: [{ kind: 'prefix', pattern: 'chrome-', zone: 'topRight' }],
      fallbackZone: null,
      windowGapPx: 0,
      wmClassInstanceFallback: false,
    };
    expect(resolveZone(config, 'Chrome-FOO')).toBe('topRight');
  });

  it('matches suffixStrip rules case-insensitively', () => {
    // `Vivaldi-SNAP` should strip to `Vivaldi` even though the actual
    // suffix configured is `-snap`. The stripped form is re-looked-up
    // with the exact map's case-insensitive matching.
    const config: ZoneConfig = {
      zones: baseZones,
      appZone: { Vivaldi: 'topRight' },
      appZoneRules: [{ kind: 'suffixStrip', suffix: '-snap' }],
      fallbackZone: null,
      windowGapPx: 0,
      wmClassInstanceFallback: false,
    };
    expect(resolveZone(config, 'Vivaldi-SNAP')).toBe('topRight');
  });

  it('retries against wm_class_instance when the class misses', () => {
    // The instance pass exists to recover apps whose primary class is
    // opaque but whose instance is recognizable. Verify the pipeline
    // re-runs the full resolution (exact + rules) against the instance.
    const config: ZoneConfig = {
      zones: baseZones,
      appZone: { 'some-instance': 'bottomLeft' },
      appZoneRules: [],
      fallbackZone: null,
      windowGapPx: 0,
      wmClassInstanceFallback: true,
    };
    expect(resolveZone(config, 'OpaqueClass', 'some-instance')).toBe('bottomLeft');
  });

  it('skips the instance pass when instance equals class (case-insensitive)', () => {
    // The instance pass is meant to recover *additional* signal, not to
    // double-look-up the same string. When the two agree ignoring case
    // we skip the second pass and fall straight through to the
    // configured fallback. Distinguished from the disabled-flag case by
    // keeping the flag on but supplying a duplicate instance.
    const config: ZoneConfig = {
      zones: baseZones,
      appZone: {},
      appZoneRules: [],
      fallbackZone: 'bottomRight',
      windowGapPx: 0,
      wmClassInstanceFallback: true,
    };
    expect(resolveZone(config, 'OpaqueClass', 'OPAQUECLASS')).toBe('bottomRight');
  });

  it('disables the instance pass when wmClassInstanceFallback is false', () => {
    // With the flag off, even a perfectly-routable instance string is
    // ignored and we fall through to the configured fallback.
    const config: ZoneConfig = {
      zones: baseZones,
      appZone: { 'some-instance': 'bottomLeft' },
      appZoneRules: [],
      fallbackZone: 'bottomRight',
      windowGapPx: 0,
      wmClassInstanceFallback: false,
    };
    expect(resolveZone(config, 'OpaqueClass', 'some-instance')).toBe('bottomRight');
  });

  it('returns null when every matcher misses and fallbackZone is null', () => {
    // The `drop unrouted windows` mode must survive the new pipeline:
    // a prefix miss + a suffix miss + an instance miss must all yield
    // `null`, not bucket the window somewhere by accident.
    const config: ZoneConfig = {
      zones: baseZones,
      appZone: { OnlyKnown: 'topLeft' },
      appZoneRules: [
        { kind: 'prefix', pattern: 'chrome-', zone: 'topRight' },
        { kind: 'suffixStrip', suffix: '-snap' },
      ],
      fallbackZone: null,
      windowGapPx: 0,
      wmClassInstanceFallback: true,
    };
    expect(resolveZone(config, 'TotallyUnknown', 'AlsoUnknown')).toBeNull();
  });

  it('routes a real Chrome PWA wm_class to topRight under the default config', () => {
    // End-to-end check against the actual production default — the
    // synthetic-config tests above prove the wiring; this test pins the
    // observable user-visible behavior change of step 5b. Before this
    // PR a `chrome-<appid>-Default` window landed in the fallback zone;
    // after, it lands with the rest of the browsers.
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'chrome-mail_google_com-Default')).toBe('topRight');
  });
});

describe('DEFAULT_ZONE_CONFIG.appZone', () => {
  it('has no case-only duplicates that disagree on zone', () => {
    // The case-insensitive lookup collapses keys that differ only in
    // case. That collapse is harmless only if the colliding entries
    // agree on the target zone — otherwise the later entry would
    // silently win. Guard against that by failing the test if any
    // disagreement sneaks in.
    const byLower = new Map<string, ZoneKey>();
    for (const [key, zone] of Object.entries(DEFAULT_ZONE_CONFIG.appZone)) {
      const lower = key.toLowerCase();
      const prior = byLower.get(lower);
      if (prior !== undefined) {
        expect(prior).toBe(zone);
      } else {
        byLower.set(lower, zone);
      }
    }
  });
});

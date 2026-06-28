import { describe, expect, it } from 'vitest';
import { resolveZone } from './app-zone-map.js';
import { DEFAULT_ZONE_CONFIG } from './zone-config.js';
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
    // distro builds (`firefox_firefox` instead of `firefox`,
    // `Vivaldi-snap` instead of `Vivaldi`); both forms are registered so
    // the snap install lands in the same zone as the non-snap install.
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'firefox_firefox')).toBe('topRight');
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'Vivaldi-snap')).toBe('topRight');
  });

  it('parks org.gnome.Settings into the chat zone as a placeholder', () => {
    // Settings has no natural home in the dev/browser/chat trichotomy;
    // putting it in the otherwise-empty bottom-left keeps it reachable
    // without hiding it under the fallback pile.
    expect(resolveZone(DEFAULT_ZONE_CONFIG, 'org.gnome.Settings')).toBe('bottomLeft');
  });

  it('still falls back for unregistered classes (e.g. Chrome PWAs)', () => {
    // Chrome PWAs report a per-app id like
    // `chrome-<appid>-Default`, which we intentionally do not register —
    // prefix matching for those is deferred to a follow-up. They must
    // continue to land in the fallback zone, not accidentally match a
    // shorter prefix.
    expect(
      resolveZone(DEFAULT_ZONE_CONFIG, 'chrome-fmpnliohjhemenmnlpbfagaolkdacoja-Default')
    ).toBe(DEFAULT_ZONE_CONFIG.fallbackZone);
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

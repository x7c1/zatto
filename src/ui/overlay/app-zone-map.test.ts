import { describe, expect, it } from 'vitest';
import { APP_ZONE, FALLBACK_ZONE, resolveZone } from './app-zone-map.js';
import { ZONE_KEYS } from './zone-layout.js';

describe('resolveZone', () => {
  it('returns the mapped zone for a known wm_class', () => {
    expect(resolveZone('Code')).toBe('topLeft');
    expect(resolveZone('Google-chrome')).toBe('topRight');
    expect(resolveZone('Slack')).toBe('bottomLeft');
  });

  it('falls back for an unknown wm_class', () => {
    expect(resolveZone('NotAnApp')).toBe(FALLBACK_ZONE);
  });

  it('falls back for null', () => {
    expect(resolveZone(null)).toBe(FALLBACK_ZONE);
  });

  it('falls back for undefined', () => {
    expect(resolveZone(undefined)).toBe(FALLBACK_ZONE);
  });

  it('falls back for empty string', () => {
    // get_wm_class() can return '' for windows that have not yet set their
    // class hints; treat that the same as unknown rather than indexing the
    // map with an empty key.
    expect(resolveZone('')).toBe(FALLBACK_ZONE);
  });

  it('matches case-insensitively so distro-specific casing still routes', () => {
    // Mutter is inconsistent about case across distros and packaging
    // variants — e.g. `Code` vs `code`, `Google-chrome` vs `google-chrome`.
    // resolveZone() lowercases both sides at lookup time so any spelling
    // of a registered class lands in the same zone.
    expect(resolveZone('Code')).toBe('topLeft');
    expect(resolveZone('code')).toBe('topLeft');
    expect(resolveZone('CODE')).toBe('topLeft');
    expect(resolveZone('Google-chrome')).toBe('topRight');
    expect(resolveZone('google-chrome')).toBe('topRight');
    expect(resolveZone('GOOGLE-CHROME')).toBe('topRight');
  });

  it('routes snap-packaged classes observed on dogfood machines', () => {
    // Snap packages of the same app report a different wm_class than the
    // distro builds (`firefox_firefox` instead of `firefox`,
    // `Vivaldi-snap` instead of `Vivaldi`); both forms are registered so
    // the snap install lands in the same zone as the non-snap install.
    expect(resolveZone('firefox_firefox')).toBe('topRight');
    expect(resolveZone('Vivaldi-snap')).toBe('topRight');
  });

  it('parks org.gnome.Settings into the chat zone as a placeholder', () => {
    // Settings has no natural home in the dev/browser/chat trichotomy;
    // putting it in the otherwise-empty bottom-left keeps it reachable
    // without hiding it under the fallback pile.
    expect(resolveZone('org.gnome.Settings')).toBe('bottomLeft');
  });

  it('still falls back for unregistered classes (e.g. Chrome PWAs)', () => {
    // Chrome PWAs report a per-app id like
    // `chrome-<appid>-Default`, which we intentionally do not register —
    // prefix matching for those is deferred to a follow-up. They must
    // continue to land in the fallback zone, not accidentally match a
    // shorter prefix.
    expect(resolveZone('chrome-fmpnliohjhemenmnlpbfagaolkdacoja-Default')).toBe(FALLBACK_ZONE);
  });
});

describe('APP_ZONE table', () => {
  it('only maps to known zones', () => {
    for (const zone of Object.values(APP_ZONE)) {
      expect(ZONE_KEYS).toContain(zone);
    }
  });

  it('fallback zone is one of the known zones', () => {
    expect(ZONE_KEYS).toContain(FALLBACK_ZONE);
  });

  it('has no case-only duplicates that disagree on zone', () => {
    // The case-insensitive lookup collapses keys that differ only in
    // case. That collapse is harmless only if the colliding entries
    // agree on the target zone — otherwise the later entry would
    // silently win. Guard against that by failing the test if any
    // disagreement sneaks in.
    const byLower = new Map<string, ZoneKey>();
    for (const [key, zone] of Object.entries(APP_ZONE)) {
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

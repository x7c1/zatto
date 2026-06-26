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

  it('matches case-sensitively (no implicit normalization)', () => {
    // wm_class is reported verbatim by Mutter; we deliberately do not
    // lowercase it because the same vendor sometimes ships both
    // "Google-chrome" and "google-chrome" on different distros and we want
    // the routing to be precise rather than guessing.
    expect(resolveZone('code')).toBe(FALLBACK_ZONE);
    expect(resolveZone('Code')).toBe('topLeft');
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
});

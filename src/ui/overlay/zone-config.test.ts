import { describe, expect, it } from 'vitest';
import { DEFAULT_ZONE_CONFIG } from './zone-config.js';
import type { FractionalRect } from './zone-layout.js';

describe('DEFAULT_ZONE_CONFIG.zones', () => {
  it('tiles the unit square exactly (area sums to 1.0)', () => {
    // The zones must cover [0,1]^2 with no overlap or gap; otherwise
    // some pixels of the monitor would either be unreachable or
    // claimed twice when we paint zones.
    let area = 0;
    for (const rect of Object.values(DEFAULT_ZONE_CONFIG.zones)) {
      area += rect.w * rect.h;
    }
    expect(area).toBeCloseTo(1, 10);
  });

  it('has no pairwise overlaps between zones', () => {
    // Area equality alone does not catch an overlap that is balanced by
    // a gap of the same total area. Iterate every distinct pair and
    // assert the rects are disjoint.
    const rects = Object.values(DEFAULT_ZONE_CONFIG.zones);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(rectsOverlap(rects[i], rects[j])).toBe(false);
      }
    }
  });
});

describe('DEFAULT_ZONE_CONFIG.appZone', () => {
  it('only maps to known zone keys', () => {
    const knownZones = new Set(Object.keys(DEFAULT_ZONE_CONFIG.zones));
    for (const zone of Object.values(DEFAULT_ZONE_CONFIG.appZone)) {
      expect(knownZones.has(zone)).toBe(true);
    }
  });
});

describe('DEFAULT_ZONE_CONFIG.fallbackZone', () => {
  it('is either null or a known zone key', () => {
    const fallback = DEFAULT_ZONE_CONFIG.fallbackZone;
    if (fallback !== null) {
      expect(Object.keys(DEFAULT_ZONE_CONFIG.zones)).toContain(fallback);
    }
  });

  it('pins step 4 parity at bottomRight', () => {
    // Reviewer protection against silent default drift: the production
    // default has to match the step 4 behavior byte-for-byte. If a
    // future change deliberately moves the fallback, update this pin in
    // the same commit so the intent is visible in review.
    expect(DEFAULT_ZONE_CONFIG.fallbackZone).toBe('bottomRight');
  });
});

describe('DEFAULT_ZONE_CONFIG.cellPaddingPx', () => {
  it('is non-negative', () => {
    expect(DEFAULT_ZONE_CONFIG.cellPaddingPx).toBeGreaterThanOrEqual(0);
  });

  it('pins step 4 parity at 8 px', () => {
    // Same rationale as the fallback pin: the 8 px gutter was hardcoded
    // in step 4's `gnome-window-mirror.ts`. A silent change here would
    // alter the visible layout without showing up in any other diff.
    expect(DEFAULT_ZONE_CONFIG.cellPaddingPx).toBe(8);
  });
});

function rectsOverlap(a: FractionalRect, b: FractionalRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

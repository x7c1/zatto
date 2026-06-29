import { describe, expect, it } from 'vitest';
import { DEFAULT_ZONE_CONFIG, type MatchRule } from './zone-config.js';
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

describe('DEFAULT_ZONE_CONFIG.windowGapPx', () => {
  it('is non-negative', () => {
    expect(DEFAULT_ZONE_CONFIG.windowGapPx).toBeGreaterThanOrEqual(0);
  });

  it('pins the inter-window gap at 8 px', () => {
    // Same rationale as the fallback pin: the 8 px gutter was hardcoded
    // in step 4's `gnome-window-mirror.ts`. A silent change here would
    // alter the visible layout without showing up in any other diff.
    // (Field renamed from `cellPaddingPx` in step 5c, same default.)
    expect(DEFAULT_ZONE_CONFIG.windowGapPx).toBe(8);
  });
});

describe('DEFAULT_ZONE_CONFIG.animation', () => {
  it('is enabled out of the box', () => {
    // Step 5c ships easing on by default; the system-wide reduced-motion
    // preference still wins inside `GnomeWindowMirror`, so this only
    // sets the master switch.
    expect(DEFAULT_ZONE_CONFIG.animation.enabled).toBe(true);
  });

  it('pins the duration at 220 ms', () => {
    // Matches the perceived speed of the Activities Overview. Reviewer
    // protection against silent default drift, same shape as the
    // fallback / windowGap pins above.
    expect(DEFAULT_ZONE_CONFIG.animation.durationMs).toBe(220);
  });

  it('pins the curve at easeOutQuad', () => {
    // Soft deceleration that feels like the overview. Other valid keys
    // (`easeOutCubic`, `linear`) need to be a deliberate config choice
    // rather than an accidental default change.
    expect(DEFAULT_ZONE_CONFIG.animation.easing).toBe('easeOutQuad');
  });
});

describe('DEFAULT_ZONE_CONFIG.appZoneRules', () => {
  it('is non-empty (step 5b ships matcher rules by default)', () => {
    // The whole point of step 5b is that the default config carries a
    // matcher pipeline. An empty rules list would silently regress us
    // to step 5 behavior.
    expect(DEFAULT_ZONE_CONFIG.appZoneRules.length).toBeGreaterThan(0);
  });

  it('only routes prefix rules to known zone keys', () => {
    // A prefix rule whose target zone isn't in `zones` would mount
    // windows into nowhere. Suffix-strip rules don't carry a zone, so
    // they don't need this guard.
    const knownZones = new Set(Object.keys(DEFAULT_ZONE_CONFIG.zones));
    for (const rule of DEFAULT_ZONE_CONFIG.appZoneRules) {
      if (rule.kind === 'prefix') {
        expect(knownZones.has(rule.zone)).toBe(true);
      }
    }
  });

  it('pins the exact step 5b rule set for reviewer protection', () => {
    // Reviewer protection against silent default drift, same shape as
    // the fallback / cellPadding pins above. If a future change adds
    // or removes a default rule, update this literal in the same commit
    // so the intent is visible in review.
    const expected: ReadonlyArray<MatchRule> = [
      { kind: 'suffixStrip', suffix: '-snap' },
      { kind: 'suffixStrip', suffix: '_snap' },
      { kind: 'prefix', pattern: 'chrome-', zone: 'topRight' },
    ];
    expect(DEFAULT_ZONE_CONFIG.appZoneRules).toEqual(expected);
  });
});

describe('DEFAULT_ZONE_CONFIG.wmClassInstanceFallback', () => {
  it('defaults to true so the instance pass is on out of the box', () => {
    // Step 5b ships the instance pass enabled by default. Flipping it
    // off should be a deliberate config choice, never an accidental
    // default change.
    expect(DEFAULT_ZONE_CONFIG.wmClassInstanceFallback).toBe(true);
  });
});

describe('DEFAULT_ZONE_CONFIG.backdrop', () => {
  // `fadeMs` was originally coupled to `animation.durationMs` for a
  // cross-dissolve: real windows fading out over `backdrop.fadeMs`
  // while the clones eased into their zones over
  // `animation.durationMs`. After step 5d verification on real
  // hardware revealed `Clutter.Clone` source-multi-paint artifacts
  // during the dissolve (the source window stays semi-transparent for
  // the duration of the fade and the clone replays its paint, so the
  // user perceives "real fading + clone flying" as a ghosted overlap),
  // `fadeMs` was decoupled to `0` (hard-cut) by default. The pins
  // below stay as a guard against accidental re-coupling without
  // conscious review: changing the default back to a positive value
  // should force the author to touch this comment and the pin
  // together so the trade-off is visible in the diff.
  it('hides real windows out of the box', () => {
    // Step 5d ships the hide-real-windows behavior on by default
    // because the visual mixing it solves is the daily-use blocker
    // that motivated the step. Disabling the kill switch must be a
    // deliberate config choice, not an accidental default drift.
    expect(DEFAULT_ZONE_CONFIG.backdrop.hideRealWindows).toBe(true);
  });

  it('pins the fade duration at 0 (hard-cut)', () => {
    // Reviewer protection against silent default drift, same shape as
    // the fallback / windowGap / animation pins above. `0` means the
    // real-windows hide and show are synchronous opacity/visibility
    // writes with no ease in flight — see BackdropConfig.fadeMs in
    // zone-config.ts for the source multi-paint rationale.
    expect(DEFAULT_ZONE_CONFIG.backdrop.fadeMs).toBe(0);
  });

  it('keeps the fade duration non-negative', () => {
    // A negative fadeMs would either be silently clamped or throw at
    // `actor.ease` time — both are confusing failure modes. Guard
    // against it here so a future loader can't slip one through.
    expect(DEFAULT_ZONE_CONFIG.backdrop.fadeMs).toBeGreaterThanOrEqual(0);
  });
});

function rectsOverlap(a: FractionalRect, b: FractionalRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

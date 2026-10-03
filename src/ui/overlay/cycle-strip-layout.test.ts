import { describe, expect, it } from 'vitest';
import { CYCLE_STRIP_TUNING, computeStripLayout } from './cycle-strip-layout.js';

const tuning = {
  thumbHeightPx: 120,
  thumbGapPx: 12,
  paddingPx: 12,
  bottomMarginPx: 24,
  fadeMs: 150,
};
const area = { width: 1920, height: 1080 };

describe('CYCLE_STRIP_TUNING', () => {
  it('starts from the values the on-hardware check begins with', () => {
    expect(CYCLE_STRIP_TUNING).toEqual(tuning);
  });
});

describe('computeStripLayout', () => {
  it('gives every thumbnail the same height and a width by its aspect', () => {
    const { thumbs } = computeStripLayout(
      [
        { width: 1600, height: 1200 },
        { width: 800, height: 800 },
      ],
      area,
      tuning
    );

    expect(thumbs.map((t) => t.height)).toEqual([120, 120]);
    expect(thumbs.map((t) => t.width)).toEqual([160, 120]);
    // In a row, a gap apart, at the same y.
    expect(thumbs[1].x).toBe(thumbs[0].x + 160 + 12);
    expect(thumbs[1].y).toBe(thumbs[0].y);
  });

  it('centres the strip horizontally and puts its bottom edge the margin above the area bottom', () => {
    const { strip, thumbs } = computeStripLayout(
      [
        { width: 1600, height: 1200 },
        { width: 800, height: 800 },
      ],
      area,
      tuning
    );

    // 160 + 12 + 120 + 2·12 padding.
    expect(strip.width).toBe(316);
    expect(strip.height).toBe(144);
    expect(strip.x).toBe((1920 - 316) / 2);
    expect(strip.y + strip.height).toBe(1080 - 24);
    expect(thumbs[0].x).toBe(strip.x + 12);
    expect(thumbs[0].y).toBe(strip.y + 12);
  });

  it('scales a row too wide for the area down uniformly to fit and keeps it centred', () => {
    const small = { width: 800, height: 600 };
    // Five 16:9 thumbnails at 120 px are 5 · 213.3 px wide.
    const sizes = Array.from({ length: 5 }, () => ({ width: 1600, height: 900 }));
    const { strip, thumbs } = computeStripLayout(sizes, small, tuning);

    expect(strip.x).toBeCloseTo(24);
    expect(strip.x + strip.width).toBeCloseTo(800 - 24);
    expect(strip.y + strip.height).toBeCloseTo(600 - 24);
    const height = thumbs[0].height;
    expect(height).toBeLessThan(120);
    for (const thumb of thumbs) {
      expect(thumb.height).toBeCloseTo(height);
      expect(thumb.width / thumb.height).toBeCloseTo(1600 / 900);
    }
    const last = thumbs[thumbs.length - 1];
    expect(last.x + last.width + 12).toBeCloseTo(strip.x + strip.width);
  });

  it('gives an empty strip for no members', () => {
    expect(computeStripLayout([], area, tuning)).toEqual({
      strip: { x: 960, y: 1056, width: 0, height: 0 },
      thumbs: [],
    });
  });
});

import { describe, expect, it } from 'vitest';
import { CYCLE_STRIP_TUNING, computeStripLayout } from './cycle-strip-layout.js';

const tuning = {
  thumbHeightPx: 120,
  thumbGapPx: 18,
  paddingPx: 12,
  bottomMarginPx: 24,
  iconSizePx: 32,
  titleHeightPx: 36,
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
    expect(thumbs[1].x).toBe(thumbs[0].x + 160 + 18);
    expect(thumbs[1].y).toBe(thumbs[0].y);
  });

  it('centres the strip horizontally and leaves room for the title and the margin below it', () => {
    const { strip, thumbs, title } = computeStripLayout(
      [
        { width: 1600, height: 1200 },
        { width: 800, height: 800 },
      ],
      area,
      tuning
    );

    // 160 + 18 gap + 120 + 2·12 padding.
    expect(strip.width).toBe(322);
    // 12 padding + 16 half icon + 120 thumbnail + 12 padding.
    expect(strip.height).toBe(160);
    expect(strip.x).toBe((1920 - 322) / 2);
    expect(strip.y + strip.height).toBe(1080 - 24 - 36);
    expect(thumbs[0].x).toBe(strip.x + 12);
    expect(thumbs[0].y).toBe(strip.y + 12 + 16);
    expect(title).toEqual({ x: strip.x, y: strip.y + strip.height, width: 322, height: 36 });
  });

  it('centres each icon on the top edge of its thumbnail', () => {
    const { thumbs, icons } = computeStripLayout(
      [
        { width: 1600, height: 1200 },
        { width: 800, height: 800 },
      ],
      area,
      tuning
    );

    expect(icons).toHaveLength(2);
    icons.forEach((icon, i) => {
      expect(icon.width).toBe(32);
      expect(icon.height).toBe(32);
      expect(icon.x + 16).toBe(thumbs[i].x + thumbs[i].width / 2);
      expect(icon.y + 16).toBe(thumbs[i].y);
    });
  });

  it('scales a row too wide for the area down uniformly to fit and keeps it centred', () => {
    const small = { width: 800, height: 600 };
    // Five 16:9 thumbnails at 120 px are 5 · 213.3 px wide.
    const sizes = Array.from({ length: 5 }, () => ({ width: 1600, height: 900 }));
    const { strip, thumbs } = computeStripLayout(sizes, small, tuning);

    expect(strip.x).toBeCloseTo(24);
    expect(strip.x + strip.width).toBeCloseTo(800 - 24);
    expect(strip.y + strip.height).toBeCloseTo(600 - 24 - 36);
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
      strip: { x: 960, y: 1020, width: 0, height: 0 },
      thumbs: [],
      icons: [],
      title: { x: 960, y: 1020, width: 0, height: 36 },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { type PixelRect, packIntoZone, rectToPixels, type Sized } from './zone-layout.js';

describe('rectToPixels', () => {
  it('scales fractional rect by monitor dimensions', () => {
    const px = rectToPixels({ x: 0.5, y: 0, w: 0.5, h: 0.5 }, { width: 1920, height: 1080 });
    expect(px).toEqual({ x: 960, y: 0, w: 960, h: 540 });
  });
});

describe('packIntoZone', () => {
  const ZONE: PixelRect = { x: 0, y: 0, w: 200, h: 100 };
  const TOL = 1e-6;

  it('returns an empty array when no sources are provided', () => {
    expect(packIntoZone(ZONE, [])).toEqual([]);
  });

  it('returns an empty array when the zone has zero area', () => {
    expect(packIntoZone({ x: 0, y: 0, w: 0, h: 100 }, [{ w: 100, h: 100 }])).toEqual([]);
    expect(packIntoZone({ x: 0, y: 0, w: 200, h: 0 }, [{ w: 100, h: 100 }])).toEqual([]);
  });

  it('fills the full zone for a single source whose aspect equals the zone', () => {
    // A 2:1 source in a 2:1 zone: R=1 lays a single row of one, rowH =
    // zoneW / aspect = 200 / 2 = 100, which matches zoneH exactly.
    const rects = packIntoZone(ZONE, [{ w: 200, h: 100 }]);
    expect(rects).toHaveLength(1);
    expect(rects[0].w).toBeCloseTo(200, 6);
    expect(rects[0].h).toBeCloseTo(100, 6);
    expect(rects[0].x).toBeCloseTo(0, 6);
    expect(rects[0].y).toBeCloseTo(0, 6);
  });

  it('lays two equal squares side-by-side in a wide zone (no gap by default)', () => {
    // R=1: rowH = 200 / (1 + 1) = 100, each width = 1 * 100 = 100.
    // R=2: rows of 1; rowH = 200 each, total 400 > 100; scale = 0.25;
    // min height = 50. R=1 wins.
    const rects = packIntoZone(ZONE, [
      { w: 100, h: 100 },
      { w: 100, h: 100 },
    ]);
    expect(rects).toHaveLength(2);
    expect(rects[0].w).toBeCloseTo(100, 6);
    expect(rects[0].h).toBeCloseTo(100, 6);
    expect(rects[0].x).toBeCloseTo(0, 6);
    expect(rects[1].x).toBeCloseTo(100, 6);
    expect(rects[0].y).toBeCloseTo(0, 6);
    expect(rects[1].y).toBeCloseTo(0, 6);
  });

  it('stacks two squares into two rows in a tall zone', () => {
    // 100x200 zone, two 1:1 sources.
    // R=1: rowH = 100/2 = 50.
    // R=2: rowH = 100/1 = 100 per row, total 200, fits exactly. min=100. wins.
    const rects = packIntoZone({ x: 0, y: 0, w: 100, h: 200 }, [
      { w: 100, h: 100 },
      { w: 100, h: 100 },
    ]);
    expect(rects).toHaveLength(2);
    expect(rects[0].w).toBeCloseTo(100, 6);
    expect(rects[0].h).toBeCloseTo(100, 6);
    expect(rects[1].w).toBeCloseTo(100, 6);
    expect(rects[1].h).toBeCloseTo(100, 6);
    // Row 1 above row 2.
    expect(rects[0].y).toBeLessThan(rects[1].y);
  });

  it('justifies a single row of mixed aspects so heights are equal and widths fill the zone', () => {
    // Mixed aspects 16:9, 4:3, 1:1 in a 300x300 zone with gap 0.
    // R=1 sums aspects to ~4.111; rowH ~ 72.97. R>=2 rows always include
    // the 1:1 alone which forces a 300 px row -> heavy scale-down to a
    // min height that does not exceed R=1's ~73 -> R=1 wins on tie or
    // outright.
    const zone: PixelRect = { x: 0, y: 0, w: 300, h: 300 };
    const sources: Sized[] = [
      { w: 16, h: 9 },
      { w: 4, h: 3 },
      { w: 1, h: 1 },
    ];
    const gap = 0;
    const rects = packIntoZone(zone, sources, { gap });

    expect(rects).toHaveLength(3);
    // All heights equal within a row.
    expect(rects[1].h).toBeCloseTo(rects[0].h, 6);
    expect(rects[2].h).toBeCloseTo(rects[0].h, 6);
    // Same y (all in one row).
    expect(rects[1].y).toBeCloseTo(rects[0].y, 6);
    expect(rects[2].y).toBeCloseTo(rects[0].y, 6);
    // Sum of widths + (k-1)*gap == zoneW exactly (justified).
    const widthSum = rects[0].w + rects[1].w + rects[2].w;
    expect(widthSum + (rects.length - 1) * gap).toBeCloseTo(zone.w, 6);
    // Per-item width follows the aspect of its source.
    expect(rects[0].w / rects[0].h).toBeCloseTo(16 / 9, 6);
    expect(rects[1].w / rects[1].h).toBeCloseTo(4 / 3, 6);
    expect(rects[2].w / rects[2].h).toBeCloseTo(1, 6);
  });

  it('subtracts the gap from the row width so neighbors do not overlap', () => {
    // R=1 with gap=10: rowH = (200 - 10) / 2 = 95. Each item is 95x95.
    // R=2 with gap=10: rowH=200 per row, total 410 after gap, scale=100/410.
    // min height = 200 * (100/410) ~ 48.8. R=1 wins.
    const rects = packIntoZone(
      ZONE,
      [
        { w: 100, h: 100 },
        { w: 100, h: 100 },
      ],
      { gap: 10 }
    );
    expect(rects).toHaveLength(2);
    expect(rects[0].w).toBeCloseTo(95, 6);
    expect(rects[0].h).toBeCloseTo(95, 6);
    expect(rects[1].w).toBeCloseTo(95, 6);
    expect(rects[1].h).toBeCloseTo(95, 6);
    // Gap of 10 between them.
    expect(rects[1].x - (rects[0].x + rects[0].w)).toBeCloseTo(10, 6);
  });

  it('scales down uniformly when stacked rows would overflow the zone height', () => {
    // 5 tall sources (1:5) into a wide short zone (500x100). Any R>=1
    // produces a row whose height exceeds the zone; the scale-down has
    // to keep the total layout inside the zone.
    const zone: PixelRect = { x: 0, y: 0, w: 500, h: 100 };
    const sources: Sized[] = [
      { w: 20, h: 100 },
      { w: 20, h: 100 },
      { w: 20, h: 100 },
      { w: 20, h: 100 },
      { w: 20, h: 100 },
    ];
    const rects = packIntoZone(zone, sources);

    expect(rects).toHaveLength(5);
    // Compute bounding box of the result.
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const r of rects) {
      if (r.y < top) top = r.y;
      if (r.y + r.h > bottom) bottom = r.y + r.h;
    }
    // Fits within the zone's vertical bounds (allow small float slop).
    expect(top).toBeGreaterThanOrEqual(zone.y - TOL);
    expect(bottom).toBeLessThanOrEqual(zone.y + zone.h + TOL);
  });

  it('prefers a multi-row layout when one row would shrink min-height significantly', () => {
    // 4 squares in a 1:1 zone (100x100):
    //   R=1: rowH = 100/4 = 25  -> min height 25
    //   R=2: 2 rows of 2; rowH = 100/2 = 50 each; total 100 fits -> min 50
    //   R=3: rows split [1,2,1]; heavy scale-down -> min < 50
    //   R=4: rowH=100 each, total 400, scale 0.25 -> min 25
    // -> R=2 should win.
    const zone: PixelRect = { x: 0, y: 0, w: 100, h: 100 };
    const sources: Sized[] = [
      { w: 100, h: 100 },
      { w: 100, h: 100 },
      { w: 100, h: 100 },
      { w: 100, h: 100 },
    ];
    const rects = packIntoZone(zone, sources);
    expect(rects).toHaveLength(4);
    for (const r of rects) {
      expect(r.h).toBeCloseTo(50, 6);
      expect(r.w).toBeCloseTo(50, 6);
    }
    // Two distinct y values, two of each.
    const ys = rects.map((r) => r.y);
    const uniqueYs = Array.from(new Set(ys.map((y) => y.toFixed(6))));
    expect(uniqueYs).toHaveLength(2);
  });

  it('preserves input order across rows (row-major, left-to-right)', () => {
    // 4 squares in a 100x100 zone produces a 2x2 layout (see prior test).
    // Indices 0,1 go in row 1; 2,3 go in row 2; within each row index 0
    // (or 2) sits to the left of index 1 (or 3).
    const zone: PixelRect = { x: 0, y: 0, w: 100, h: 100 };
    const sources: Sized[] = [
      { w: 100, h: 100 },
      { w: 100, h: 100 },
      { w: 100, h: 100 },
      { w: 100, h: 100 },
    ];
    const rects = packIntoZone(zone, sources);
    expect(rects[0].y).toBeCloseTo(rects[1].y, 6);
    expect(rects[2].y).toBeCloseTo(rects[3].y, 6);
    expect(rects[0].y).toBeLessThan(rects[2].y);
    expect(rects[0].x).toBeLessThan(rects[1].x);
    expect(rects[2].x).toBeLessThan(rects[3].x);
  });

  it('treats a degenerate 0x0 source as aspect 1 without crashing', () => {
    // Mutter sometimes reports 0x0 frame rects mid-resize; the packer
    // has to survive that without producing NaN coordinates.
    const rects = packIntoZone(ZONE, [{ w: 0, h: 0 }]);
    expect(rects).toHaveLength(1);
    expect(Number.isFinite(rects[0].x)).toBe(true);
    expect(Number.isFinite(rects[0].y)).toBe(true);
    expect(Number.isFinite(rects[0].w)).toBe(true);
    expect(Number.isFinite(rects[0].h)).toBe(true);
    expect(rects[0].w).toBeGreaterThan(0);
    expect(rects[0].h).toBeGreaterThan(0);
  });

  it('prefers fewer rows when two layouts share the same min-height', () => {
    // 2 squares in a 1:1 zone (100x100):
    //   R=1: rowH = 100/2 = 50 (single row of 2 squares)
    //   R=2: rowH = 100 per row, total 200, scale 0.5 -> min 50
    // Tied; algorithm should pick the fewer-rows layout (single row).
    const zone: PixelRect = { x: 0, y: 0, w: 100, h: 100 };
    const sources: Sized[] = [
      { w: 100, h: 100 },
      { w: 100, h: 100 },
    ];
    const rects = packIntoZone(zone, sources);
    expect(rects).toHaveLength(2);
    // Same y -> single row.
    expect(rects[0].y).toBeCloseTo(rects[1].y, 6);
  });
});

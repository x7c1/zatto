import { describe, expect, it } from 'vitest';
import {
  computeGrid,
  fitContentToCell,
  rectToPixels,
  ZONE_KEYS,
  ZONE_RECTS,
} from './zone-layout.js';

describe('ZONE_RECTS', () => {
  it('covers exactly the four quadrants of the unit square', () => {
    // Sanity: the four hardcoded rects must tile the [0,1]^2 plane with no
    // overlap or gap, otherwise some pixels of the monitor would either be
    // unreachable or claimed twice when we paint zones.
    let area = 0;
    for (const key of ZONE_KEYS) {
      const r = ZONE_RECTS[key];
      area += r.w * r.h;
    }
    expect(area).toBeCloseTo(1, 10);
  });

  it('exposes the four expected keys in stable order', () => {
    expect(ZONE_KEYS).toEqual(['topLeft', 'topRight', 'bottomLeft', 'bottomRight']);
  });
});

describe('rectToPixels', () => {
  it('scales fractional rect by monitor dimensions', () => {
    const px = rectToPixels({ x: 0.5, y: 0, w: 0.5, h: 0.5 }, { width: 1920, height: 1080 });
    expect(px).toEqual({ x: 960, y: 0, w: 960, h: 540 });
  });
});

describe('computeGrid', () => {
  it('returns an empty array for n <= 0', () => {
    expect(computeGrid({ x: 0, y: 0, w: 100, h: 100 }, 0)).toEqual([]);
    expect(computeGrid({ x: 0, y: 0, w: 100, h: 100 }, -1)).toEqual([]);
  });

  it('returns the full rect as a single cell for n=1', () => {
    expect(computeGrid({ x: 10, y: 20, w: 100, h: 80 }, 1)).toEqual([
      { x: 10, y: 20, w: 100, h: 80 },
    ]);
  });

  it('splits 2 items into a 2x1 row of equal cells', () => {
    // ceil(sqrt(2)) = 2 cols, ceil(2/2) = 1 row.
    const cells = computeGrid({ x: 0, y: 0, w: 200, h: 100 }, 2);
    expect(cells).toEqual([
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 100, y: 0, w: 100, h: 100 },
    ]);
  });

  it('splits 3 items into a 2x2 grid with the last cell empty', () => {
    // ceil(sqrt(3)) = 2 cols, ceil(3/2) = 2 rows. Last slot stays unused.
    const cells = computeGrid({ x: 0, y: 0, w: 200, h: 200 }, 3);
    expect(cells).toHaveLength(3);
    expect(cells).toEqual([
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 100, y: 0, w: 100, h: 100 },
      { x: 0, y: 100, w: 100, h: 100 },
    ]);
  });

  it('splits 4 items into a perfect 2x2 grid', () => {
    const cells = computeGrid({ x: 0, y: 0, w: 200, h: 200 }, 4);
    expect(cells).toEqual([
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 100, y: 0, w: 100, h: 100 },
      { x: 0, y: 100, w: 100, h: 100 },
      { x: 100, y: 100, w: 100, h: 100 },
    ]);
  });

  it('splits 9 items into a perfect 3x3 grid', () => {
    const cells = computeGrid({ x: 0, y: 0, w: 300, h: 300 }, 9);
    expect(cells).toHaveLength(9);
    expect(cells[0]).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(cells[4]).toEqual({ x: 100, y: 100, w: 100, h: 100 });
    expect(cells[8]).toEqual({ x: 200, y: 200, w: 100, h: 100 });
  });

  it('preserves the input origin (rect not assumed to be at 0,0)', () => {
    const cells = computeGrid({ x: 50, y: 60, w: 200, h: 100 }, 2);
    expect(cells[0].x).toBe(50);
    expect(cells[1].x).toBe(150);
    expect(cells[0].y).toBe(60);
    expect(cells[1].y).toBe(60);
  });
});

describe('fitContentToCell', () => {
  it('preserves aspect ratio when source is wider than the cell', () => {
    // Source is 2:1, cell is 1:1 -> width-limited, height halves.
    const fit = fitContentToCell({ x: 0, y: 0, w: 100, h: 100 }, 200, 100);
    expect(fit.w).toBe(100);
    expect(fit.h).toBe(50);
    // Centered vertically.
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(25);
  });

  it('preserves aspect ratio when source is taller than the cell', () => {
    // Source is 1:2, cell is 1:1 -> height-limited, width halves.
    const fit = fitContentToCell({ x: 0, y: 0, w: 100, h: 100 }, 100, 200);
    expect(fit.w).toBe(50);
    expect(fit.h).toBe(100);
    expect(fit.x).toBe(25);
    expect(fit.y).toBe(0);
  });

  it('honors padding by shrinking the inner box uniformly', () => {
    const fit = fitContentToCell({ x: 0, y: 0, w: 100, h: 100 }, 100, 100, { padding: 10 });
    expect(fit.w).toBe(80);
    expect(fit.h).toBe(80);
    expect(fit.x).toBe(10);
    expect(fit.y).toBe(10);
  });

  it('returns a zero-sized rect when padding exceeds the cell', () => {
    const fit = fitContentToCell({ x: 0, y: 0, w: 10, h: 10 }, 100, 100, { padding: 20 });
    expect(fit.w).toBe(0);
    expect(fit.h).toBe(0);
  });

  it('fills the inner box when source dimensions are degenerate', () => {
    // A transiently-zero source (e.g. window mid-resize) should not crash on
    // division by zero — fall back to filling the cell so the user still sees
    // a placeholder rather than nothing.
    const fit = fitContentToCell({ x: 0, y: 0, w: 100, h: 100 }, 0, 0);
    expect(fit.w).toBe(100);
    expect(fit.h).toBe(100);
  });

  it('preserves the cell origin', () => {
    const fit = fitContentToCell({ x: 200, y: 300, w: 100, h: 100 }, 100, 100);
    expect(fit.x).toBe(200);
    expect(fit.y).toBe(300);
  });
});

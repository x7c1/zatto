import { describe, expect, it } from 'vitest';
import { computeDepthLayout, type Rect } from './depth-layout.js';

const tuning = { tiltDegrees: 15, zStepPx: 80, opacity: 0.85 };
const monitor = { width: 1920, height: 1080 };
const cos = Math.cos((15 * Math.PI) / 180);
const sin = Math.sin((15 * Math.PI) / 180);

function frame(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/** Left edge of `frame` on screen after the container transform. */
function screenLeft(layout: ReturnType<typeof computeDepthLayout>, f: Rect, i: number): number {
  const { container } = layout;
  return container.translationX + (f.x + layout.clones[i].offsetX) * container.scaleX;
}

describe('computeDepthLayout', () => {
  it('returns an empty layout and an identity transform for no clones', () => {
    expect(computeDepthLayout([], monitor, tuning)).toEqual({
      clones: [],
      container: { scaleX: 1, scaleY: 1, translationX: 0, translationY: 0 },
    });
  });

  it('gives a single clone offset 0 and keeps it centred under the squash', () => {
    const f = frame(0, 0, 1920, 1080);
    const layout = computeDepthLayout([f], monitor, tuning);
    // toEqual distinguishes -0 from 0, so this also pins the topmost entry to +0.
    expect(layout.clones.map((c) => c.offsetX)).toEqual([0]);
    expect(layout.container.scaleX).toBeCloseTo(cos);
    expect(layout.container.scaleY).toBe(1);
    expect(screenLeft(layout, f, 0)).toBeCloseTo((1920 * (1 - cos)) / 2);
    expect(layout.container.translationY).toBe(0);
  });

  it('keeps the topmost (last) clone at offset 0 and moves each deeper one zStepPx·sin(tilt) further towards the near side', () => {
    const frames = [
      frame(100, 100, 400, 300),
      frame(200, 150, 400, 300),
      frame(300, 200, 400, 300),
    ];
    const layout = computeDepthLayout(frames, monitor, tuning);
    const screenLefts = frames.map((f, i) => screenLeft(layout, f, i));
    // On screen, each depth level shifts left by zStepPx·sin(tilt) relative to its own x.
    const shifts = screenLefts.map(
      (left, i) => left - layout.container.translationX - frames[i].x * cos
    );
    expect(shifts[2]).toBeCloseTo(0);
    expect(shifts[1]).toBeCloseTo(-80 * sin);
    expect(shifts[0]).toBeCloseTo(-160 * sin);
    expect(layout.clones[2].offsetX).toBe(0);
  });

  it('does not change size when every clone already fits', () => {
    const frames = [frame(100, 100, 400, 300), frame(600, 400, 800, 500)];
    const layout = computeDepthLayout(frames, monitor, tuning);
    expect(layout.container.scaleX).toBeCloseTo(cos);
    expect(layout.container.scaleY).toBe(1);
  });

  it('shifts the plane right just enough when deep clones would spill off the left edge', () => {
    // Four full-width windows: the deepest one is offset 3·80·sin(15°) ≈ 62 px
    // to the left, more than the ≈ 33 px the squash frees on each side, while
    // the whole extent (≈ 1917 px) still fits without scaling.
    const frames = Array.from({ length: 4 }, () => frame(0, 0, 1920, 1080));
    const layout = computeDepthLayout(frames, monitor, tuning);
    expect(layout.container.scaleY).toBe(1);
    expect(screenLeft(layout, frames[0], 0)).toBeCloseTo(0);
    const topRight = screenLeft(layout, frames[3], 3) + 1920 * layout.container.scaleX;
    expect(topRight).toBeLessThanOrEqual(1920);
  });

  it('scales the plane down uniformly when the projected extent is wider than the monitor', () => {
    const frames = Array.from({ length: 30 }, () => frame(0, 0, 1920, 1080));
    const layout = computeDepthLayout(frames, monitor, tuning);
    expect(layout.container.scaleY).toBeLessThan(1);
    expect(layout.container.scaleX / layout.container.scaleY).toBeCloseTo(cos);
    const lefts = frames.map((f, i) => screenLeft(layout, f, i));
    const rights = lefts.map((left) => left + 1920 * layout.container.scaleX);
    expect(Math.min(...lefts)).toBeCloseTo(0);
    expect(Math.max(...rights)).toBeCloseTo(1920);
  });

  it('brings a window that hangs off the bottom back on screen', () => {
    const f = frame(100, 900, 600, 400);
    const layout = computeDepthLayout([f], monitor, tuning);
    expect(layout.container.scaleY).toBe(1);
    expect(layout.container.translationY + 1300).toBeCloseTo(1080);
  });

  it('gives every clone the same integer opacity', () => {
    const frames = Array.from({ length: 5 }, () => frame(0, 0, 100, 100));
    const expected = Math.round(0.85 * 255);
    expect(computeDepthLayout(frames, monitor, tuning).clones.map((c) => c.opacity)).toEqual(
      Array(5).fill(expected)
    );
  });
});

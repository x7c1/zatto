import { describe, expect, it } from 'vitest';
import { computeDepthLayout, type DepthViewLayout, type Rect } from './depth-layout.js';

const tuning = { depthAxisDegrees: 45, depthStepPx: 32, opacity: 0.85, transitionMs: 250 };
const area = { width: 1920, height: 1080 };
/** One level away from the viewer: up and to the left along the 45° axis. */
const step = 32 / Math.SQRT2;

function frame(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/** Top-left corner of frame `i` on screen after the container transform. */
function screenTopLeft(layout: DepthViewLayout, f: Rect, i: number): [number, number] {
  const { container } = layout;
  return [
    container.translationX + (f.x + layout.clones[i].offsetX) * container.scale,
    container.translationY + (f.y + layout.clones[i].offsetY) * container.scale,
  ];
}

describe('computeDepthLayout', () => {
  it('returns an empty layout and an identity transform for no clones', () => {
    expect(computeDepthLayout([], area, tuning)).toEqual({
      clones: [],
      container: { scale: 1, translationX: 0, translationY: 0 },
    });
  });

  it('leaves a single clone exactly where its window is', () => {
    const f = frame(100, 200, 640, 480);
    const layout = computeDepthLayout([f], area, tuning);
    // toEqual distinguishes -0 from 0, so this also pins the topmost entry to +0.
    expect(layout.clones).toEqual([{ offsetX: 0, offsetY: 0, opacity: Math.round(0.85 * 255) }]);
    expect(layout.container).toEqual({ scale: 1, translationX: 0, translationY: 0 });
  });

  it('offsets each deeper clone depthStepPx further up-left and centres the stack on the windows', () => {
    const frames = [
      frame(300, 300, 400, 300),
      frame(300, 300, 400, 300),
      frame(300, 300, 400, 300),
    ];
    const layout = computeDepthLayout(frames, area, tuning);
    // The stack spans 2·step up-left of the windows, so the container moves
    // it back by half of that to keep its centre on theirs.
    expect(layout.container.scale).toBe(1);
    expect(layout.container.translationX).toBeCloseTo(step);
    expect(layout.container.translationY).toBeCloseTo(step);
    expect(layout.clones[2].offsetX).toBe(0);
    expect(layout.clones[2].offsetY).toBe(0);
    expect(layout.clones[1].offsetX).toBeCloseTo(-step);
    expect(layout.clones[1].offsetY).toBeCloseTo(-step);
    expect(layout.clones[0].offsetX).toBeCloseTo(-2 * step);
    expect(layout.clones[0].offsetY).toBeCloseTo(-2 * step);
  });

  it('points the depth axis the other way when the angle is flipped', () => {
    const frames = [frame(300, 300, 400, 300), frame(300, 300, 400, 300)];
    const layout = computeDepthLayout(frames, area, { ...tuning, depthAxisDegrees: 225 });
    expect(layout.clones[0].offsetX).toBeCloseTo(step);
    expect(layout.clones[0].offsetY).toBeCloseTo(step);
  });

  it('scales a stack of maximised windows down and centres it in the area', () => {
    const frames = Array.from({ length: 3 }, () => frame(0, 0, 1920, 1080));
    const layout = computeDepthLayout(frames, area, tuning);
    // Extent is 1920 + 2·step by 1080 + 2·step, so it no longer fits at
    // scale 1; the height is the tighter of the two.
    const scale = 1080 / (1080 + 2 * step);
    expect(layout.container.scale).toBeCloseTo(scale);
    const [deepestLeft, deepestTop] = screenTopLeft(layout, frames[0], 0);
    const [topLeft, topTop] = screenTopLeft(layout, frames[2], 2);
    const right = topLeft + 1920 * scale;
    // Equal margins left and right, flush top and bottom.
    expect(deepestLeft).toBeGreaterThan(0);
    expect(deepestLeft).toBeCloseTo(1920 - right);
    expect(deepestTop).toBeCloseTo(0);
    expect(topTop + 1080 * scale).toBeCloseTo(1080);
  });

  it('only translates when the clones fit the area after the offsets', () => {
    const frames = [frame(0, 0, 800, 600), frame(0, 0, 800, 600)];
    const layout = computeDepthLayout(frames, area, tuning);
    expect(layout.container.scale).toBe(1);
    expect(layout.container.translationX).toBeCloseTo(step);
    expect(layout.container.translationY).toBeCloseTo(step);
  });

  it('brings a window that hangs off the bottom-right back on screen', () => {
    const f = frame(1500, 900, 600, 400);
    const layout = computeDepthLayout([f], area, tuning);
    expect(layout.container.scale).toBe(1);
    expect(layout.container.translationX + 2100).toBeCloseTo(1920);
    expect(layout.container.translationY + 1300).toBeCloseTo(1080);
  });

  it('gives every clone the same integer opacity', () => {
    const frames = Array.from({ length: 5 }, () => frame(0, 0, 100, 100));
    const expected = Math.round(0.85 * 255);
    expect(computeDepthLayout(frames, area, tuning).clones.map((c) => c.opacity)).toEqual(
      Array(5).fill(expected)
    );
  });
});

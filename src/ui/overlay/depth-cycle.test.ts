import { describe, expect, it } from 'vitest';
import { cycleFocus, windowsUnder } from './depth-cycle.js';
import type { DepthViewLayout, Rect } from './depth-layout.js';

function frame(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/** A layout with the given clone offsets and container transform. */
function layoutOf(
  offsets: [number, number][],
  container: DepthViewLayout['container'] = { scale: 1, translationX: 0, translationY: 0 }
): DepthViewLayout {
  return {
    clones: offsets.map(([offsetX, offsetY]) => ({ offsetX, offsetY, opacity: 217 })),
    container,
  };
}

describe('windowsUnder', () => {
  it('returns the windows that overlap the point, bottom to top, and not one elsewhere', () => {
    const frames = [frame(0, 0, 400, 300), frame(1000, 600, 200, 200), frame(200, 100, 400, 300)];
    const layout = layoutOf([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);

    expect(windowsUnder({ x: 300, y: 200 }, frames, layout)).toEqual([0, 2]);
  });

  it('applies the container scale and translation', () => {
    const frames = [frame(1000, 1000, 200, 200)];
    const layout = layoutOf([[0, 0]], { scale: 0.5, translationX: 100, translationY: 50 });

    // Untransformed the frame spans 1000..1200; drawn it spans 600..700 by 550..650.
    expect(windowsUnder({ x: 650, y: 600 }, frames, layout)).toEqual([0]);
    expect(windowsUnder({ x: 1100, y: 1100 }, frames, layout)).toEqual([]);
  });

  it('applies the clone offset before the container transform', () => {
    const frames = [frame(100, 100, 100, 100)];
    const layout = layoutOf([[-40, -40]], { scale: 0.5, translationX: 10, translationY: 10 });

    // Drawn at ((100 - 40) * 0.5 + 10) = 40 .. 90 on both axes.
    expect(windowsUnder({ x: 41, y: 41 }, frames, layout)).toEqual([0]);
    expect(windowsUnder({ x: 95, y: 95 }, frames, layout)).toEqual([]);
  });

  it('hits only the deeper window in the strip its offset uncovers', () => {
    const frames = [frame(300, 300, 400, 300), frame(300, 300, 400, 300)];
    const layout = layoutOf([
      [-20, -20],
      [0, 0],
    ]);

    expect(windowsUnder({ x: 290, y: 290 }, frames, layout)).toEqual([0]);
    expect(windowsUnder({ x: 400, y: 400 }, frames, layout)).toEqual([0, 1]);
  });

  it('treats the right and bottom edges as outside', () => {
    const frames = [frame(0, 0, 100, 100)];
    const layout = layoutOf([[0, 0]]);

    expect(windowsUnder({ x: 0, y: 0 }, frames, layout)).toEqual([0]);
    expect(windowsUnder({ x: 100, y: 50 }, frames, layout)).toEqual([]);
    expect(windowsUnder({ x: 50, y: 100 }, frames, layout)).toEqual([]);
  });
});

describe('cycleFocus', () => {
  // Bottom to top: 4 is the deepest, 7 the frontmost under the cursor.
  const group = [4, 2, 7];

  it('starts one window behind the frontmost member when nothing is focused', () => {
    expect(cycleFocus(group, null, 'forward')).toBe(2);
  });

  it('starts at the deepest member when going backward with nothing focused', () => {
    expect(cycleFocus(group, null, 'backward')).toBe(4);
  });

  it('walks forward one window deeper per step and wraps to the frontmost', () => {
    expect(cycleFocus(group, 7, 'forward')).toBe(2);
    expect(cycleFocus(group, 2, 'forward')).toBe(4);
    expect(cycleFocus(group, 4, 'forward')).toBe(7);
  });

  it('walks backward one window nearer per step and wraps to the deepest', () => {
    expect(cycleFocus(group, 4, 'backward')).toBe(2);
    expect(cycleFocus(group, 2, 'backward')).toBe(7);
    expect(cycleFocus(group, 7, 'backward')).toBe(4);
  });

  it('returns to the start after one forward step per member', () => {
    let focused: number | null = null;
    const visited: number[] = [];
    for (let i = 0; i < group.length; i++) {
      focused = cycleFocus(group, focused, 'forward');
      visited.push(focused);
    }
    expect(visited).toEqual([2, 4, 7]);
  });

  it('treats a focused index outside the group like null', () => {
    expect(cycleFocus(group, 9, 'forward')).toBe(cycleFocus(group, null, 'forward'));
    expect(cycleFocus(group, 9, 'backward')).toBe(cycleFocus(group, null, 'backward'));
  });

  it('alternates between the two members of a two-member group', () => {
    expect(cycleFocus([0, 1], null, 'forward')).toBe(0);
    expect(cycleFocus([0, 1], 0, 'forward')).toBe(1);
    expect(cycleFocus([0, 1], 1, 'backward')).toBe(0);
  });
});

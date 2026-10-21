import { describe, expect, it } from 'vitest';
import {
  closeButtonCarrier,
  closeButtonProbe,
  closeButtonRect,
  focusAfterClose,
  withoutIndex,
} from './depth-close.js';
import { drawnFrame, windowsUnder } from './depth-cycle.js';
import type { DepthViewLayout } from './depth-layout.js';

describe('closeButtonCarrier', () => {
  it('puts the button on the focused window while it is under the pointer, drawn on top', () => {
    expect(closeButtonCarrier(1, [0, 1, 2], null, false)).toBe(1);
  });

  it('moves the button from the focused window to the frontmost one under the pointer', () => {
    expect(closeButtonCarrier(1, [0, 2], 1, false)).toBe(2);
  });

  it('keeps the button on the focused window while no window is under the pointer', () => {
    expect(closeButtonCarrier(1, [], 2, false)).toBe(1);
  });

  it('puts the button on the frontmost window under the pointer when nothing is focused', () => {
    expect(closeButtonCarrier(null, [0, 2, 3], null, false)).toBe(3);
  });

  it('puts the button on a window under the pointer that overlaps nothing', () => {
    expect(closeButtonCarrier(null, [4], 1, false)).toBe(4);
  });

  it('puts the button on no window when nothing is focused and no window is under the pointer', () => {
    expect(closeButtonCarrier(null, [], null, false)).toBeNull();
    expect(closeButtonCarrier(null, [], 2, false)).toBeNull();
  });

  it('keeps the button where it is while the pointer is on it', () => {
    // The button reaches past its carrier 3 onto window 1, drawn behind it.
    expect(closeButtonCarrier(null, [1], 3, true)).toBe(3);
    // Also when another window is focused.
    expect(closeButtonCarrier(0, [1], 3, true)).toBe(3);
  });

  it('gives the button up where a window drawn in front of its carrier covers it', () => {
    // Window 3 is drawn in front of the carrier 1 and covers its button.
    expect(closeButtonCarrier(null, [1, 3], 1, true)).toBe(3);
    // The focused window 0 is drawn on top of everything.
    expect(closeButtonCarrier(0, [0, 1], 1, true)).toBe(0);
    // A focused carrier is not covered.
    expect(closeButtonCarrier(1, [1, 3], 1, true)).toBe(1);
  });
});

describe('closeButtonRect', () => {
  const size = { width: 42, height: 42 };
  const right = { size, onLeft: false, inset: 8 };
  const left = { size, onLeft: true, inset: 8 };
  const frame = { x: 100, y: 50, width: 400, height: 300 };

  it('puts the button inside the top-right corner of the frame, inset from its edges', () => {
    expect(closeButtonRect(frame, right)).toEqual({
      x: 500 - 8 - 42,
      y: 50 + 8,
      width: 42,
      height: 42,
    });
  });

  it('puts the button inside the top-left corner when close is on the left', () => {
    expect(closeButtonRect(frame, left)).toEqual({
      x: 100 + 8,
      y: 50 + 8,
      width: 42,
      height: 42,
    });
  });

  it('keeps the button inside the frame of a maximized window', () => {
    const maximized = { x: 0, y: 0, width: 1000, height: 800 };
    expect(closeButtonRect(maximized, right)).toEqual({ x: 950, y: 8, width: 42, height: 42 });
    expect(closeButtonRect(maximized, left)).toEqual({ x: 8, y: 8, width: 42, height: 42 });
  });

  it('lets a negative inset put the button partly outside the frame, even past the screen edge', () => {
    const maximized = { x: 0, y: 0, width: 1000, height: 800 };
    expect(closeButtonRect(maximized, { ...right, inset: -8 })).toEqual({
      x: 1000 + 8 - 42,
      y: -8,
      width: 42,
      height: 42,
    });
  });

  it('does not leave the far side of a frame too small for the button', () => {
    const small = { x: 300, y: 300, width: 10, height: 10 };
    // Close on the right: not left of the frame's left edge, not below its bottom.
    expect(closeButtonRect(small, right)).toEqual({ x: 300, y: 310 - 42, width: 42, height: 42 });
    // Close on the left: not right of the frame's right edge.
    expect(closeButtonRect(small, left)).toEqual({
      x: 310 - 42,
      y: 310 - 42,
      width: 42,
      height: 42,
    });
    // Narrower than the button with the inset, but wider than the button.
    expect(closeButtonRect({ x: 300, y: 300, width: 46, height: 46 }, right)).toEqual({
      x: 300,
      y: 304,
      width: 42,
      height: 42,
    });
  });
});

describe('closeButtonProbe', () => {
  const frames = [
    { x: 0, y: 0, width: 600, height: 400 },
    { x: 200, y: 100, width: 600, height: 400 },
  ];
  const layout: DepthViewLayout = {
    clones: frames.map(() => ({ offsetX: 0, offsetY: 0, opacity: 217 })),
    container: { scale: 1, translationX: 0, translationY: 0 },
  };
  const placement = {
    size: { width: 42, height: 42 },
    inset: 8,
  };

  it('finds the closed window under its button on the right corner', () => {
    const drawn = drawnFrame(frames[1], 1, layout);
    const button = closeButtonRect(drawn, { ...placement, onLeft: false });
    const probe = closeButtonProbe(button, drawn);
    // The button lies inside the frame, so the probe is its centre.
    expect(probe).toEqual({ x: button.x + 21, y: button.y + 21 });
    expect(windowsUnder(probe, frames, layout)).toEqual([1]);
  });

  it('finds the closed window and the ones it overlaps under its button on the left corner', () => {
    const drawn = drawnFrame(frames[1], 1, layout);
    const button = closeButtonRect(drawn, { ...placement, onLeft: true });
    expect(windowsUnder(closeButtonProbe(button, drawn), frames, layout)).toEqual([0, 1]);
  });

  it('finds the closed window under a button reaching past its corner', () => {
    const drawn = drawnFrame(frames[1], 1, layout);
    const button = closeButtonRect(drawn, { ...placement, onLeft: false, inset: -8 });
    expect(button.x + button.width).toBeGreaterThan(drawn.x + drawn.width);
    expect(button.y).toBeLessThan(drawn.y);
    expect(windowsUnder(closeButtonProbe(button, drawn), frames, layout)).toEqual([1]);
  });

  it('finds a closed window smaller than its button', () => {
    const tiny = [...frames, { x: 900, y: 600, width: 10, height: 10 }];
    const tinyLayout: DepthViewLayout = {
      clones: tiny.map(() => ({ offsetX: 0, offsetY: 0, opacity: 217 })),
      container: layout.container,
    };
    const drawn = drawnFrame(tiny[2], 2, tinyLayout);
    const button = closeButtonRect(drawn, { ...placement, onLeft: false });
    // The button's centre lies outside the frame, where no window is drawn.
    expect(windowsUnder({ x: button.x + 21, y: button.y + 21 }, tiny, tinyLayout)).toEqual([]);
    expect(windowsUnder(closeButtonProbe(button, drawn), tiny, tinyLayout)).toEqual([2]);
  });
});

describe('focusAfterClose', () => {
  it('moves the focus to the window behind the closed focused one', () => {
    // Overlap [0, 2, 3] with 2 focused: 0 is behind it and keeps its index.
    expect(focusAfterClose(2, 2, [0, 2, 3])).toBe(0);
  });

  it('moves indices above the closed window down by one', () => {
    // Overlap [1, 4] with 1 focused and deepest: the focus wraps to 4, now 3.
    expect(focusAfterClose(1, 1, [1, 4])).toBe(3);
  });

  it('clears the focus when no window is left in the overlap', () => {
    expect(focusAfterClose(2, 2, [2])).toBeNull();
  });

  it('clears the focus when the closed focused window is not in the overlap', () => {
    expect(focusAfterClose(2, 2, [0, 1])).toBeNull();
  });

  it('keeps the focus on another window, reindexed', () => {
    expect(focusAfterClose(1, 3, [1, 3])).toBe(2);
    expect(focusAfterClose(3, 1, [1, 3])).toBe(1);
  });

  it('leaves the focus cleared when nothing was focused', () => {
    // 3 frontmost under the pointer carried the button: 2 behind it stays unfocused.
    expect(focusAfterClose(3, null, [0, 2, 3])).toBeNull();
    expect(focusAfterClose(2, null, [2])).toBeNull();
  });
});

describe('withoutIndex', () => {
  it('drops the index and moves the ones above it down', () => {
    expect(withoutIndex([0, 2, 3, 5], 2)).toEqual([0, 2, 4]);
    expect(withoutIndex([0, 1], 4)).toEqual([0, 1]);
  });
});

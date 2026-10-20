import { describe, expect, it } from 'vitest';
import {
  closeButtonCarrier,
  closeButtonRect,
  focusAfterClose,
  withoutIndex,
} from './depth-close.js';

describe('closeButtonCarrier', () => {
  it('puts the button on the focused window, wherever the pointer is', () => {
    expect(closeButtonCarrier(1, [0, 2], null, false)).toBe(1);
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
    // The button overlaps window 3, drawn in front of its carrier 1.
    expect(closeButtonCarrier(null, [1, 3], 1, true)).toBe(1);
  });
});

describe('closeButtonRect', () => {
  const tuning = { closeButtonSizePx: 28, closeButtonInsetPx: 8 };

  it('sits inset from the top-right corner of the frame', () => {
    expect(closeButtonRect({ x: 100, y: 50, width: 400, height: 300 }, tuning)).toEqual({
      x: 100 + 400 - 8 - 28,
      y: 58,
      width: 28,
      height: 28,
    });
  });

  it('stays within the left and top of a frame too small for the inset', () => {
    expect(closeButtonRect({ x: 10, y: 20, width: 30, height: 30 }, tuning)).toEqual({
      x: 10,
      y: 22,
      width: 28,
      height: 28,
    });
    expect(closeButtonRect({ x: 10, y: 20, width: 20, height: 20 }, tuning)).toEqual({
      x: 10,
      y: 20,
      width: 28,
      height: 28,
    });
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

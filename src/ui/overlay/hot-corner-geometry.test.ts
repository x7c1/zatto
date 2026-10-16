import { describe, expect, it } from 'vitest';
import { hotCornerRect } from './hot-corner-geometry.js';

const monitor = { x: 1920, y: 0, width: 2560, height: 1440 };
const size = 5;

describe('hotCornerRect', () => {
  it('anchors bottom-left at the monitor origin x and bottom edge', () => {
    expect(hotCornerRect('bottom-left', monitor, size)).toEqual({
      x: 1920,
      y: 1440 - size,
      width: size,
      height: size,
    });
  });

  it('anchors bottom-right at the right and bottom edges', () => {
    expect(hotCornerRect('bottom-right', monitor, size)).toEqual({
      x: 1920 + 2560 - size,
      y: 1440 - size,
      width: size,
      height: size,
    });
  });

  it('anchors the top corners at the monitor top edge', () => {
    const offset = { x: 100, y: 50, width: 800, height: 600 };
    expect(hotCornerRect('top-left', offset, size)).toEqual({ x: 100, y: 50, width: 5, height: 5 });
    expect(hotCornerRect('top-right', offset, size)).toEqual({
      x: 100 + 800 - size,
      y: 50,
      width: 5,
      height: 5,
    });
  });
});

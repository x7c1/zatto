import { describe, expect, it } from 'vitest';
import {
  CORNER_PLACEMENTS,
  type CornerPlacement,
  FALLBACK_ASPECT,
  PICTURE_EXTENT,
  pictureSize,
} from './corner-picture.js';

function placementOf(corner: CornerPlacement['corner']): CornerPlacement {
  const found = CORNER_PLACEMENTS.filter((placement) => placement.corner === corner);
  expect(found).toHaveLength(1);
  return found[0];
}

describe('CORNER_PLACEMENTS', () => {
  it.each([
    ['top-left', 'start', 'start', 'Top left corner'],
    ['top-right', 'end', 'start', 'Top right corner'],
    ['bottom-left', 'start', 'end', 'Bottom left corner'],
    ['bottom-right', 'end', 'end', 'Bottom right corner'],
  ] as const)('puts the %s corner at its picture corner', (corner, horizontal, vertical, label) => {
    expect(placementOf(corner)).toEqual({ corner, horizontal, vertical, label });
  });

  it('places every corner exactly once', () => {
    expect(CORNER_PLACEMENTS).toHaveLength(4);
  });
});

describe('pictureSize', () => {
  it('keeps a landscape monitor aspect at the fixed width', () => {
    expect(pictureSize(2560, 1600)).toEqual({ width: PICTURE_EXTENT, height: 175 });
  });

  it('falls back to 16:9 when the size cannot be read', () => {
    const fallback = {
      width: PICTURE_EXTENT,
      height: Math.round(PICTURE_EXTENT / FALLBACK_ASPECT),
    };
    expect(pictureSize(undefined, undefined)).toEqual(fallback);
    expect(pictureSize(0, 1080)).toEqual(fallback);
    expect(pictureSize(1920, Number.NaN)).toEqual(fallback);
  });

  it('limits a portrait monitor to the fixed height', () => {
    expect(pictureSize(1080, 1920)).toEqual({ width: 158, height: PICTURE_EXTENT });
  });
});

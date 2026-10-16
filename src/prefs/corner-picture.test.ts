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
    ['bottom-left', 'start', 'end', 'Bottom left corner'],
    ['bottom-right', 'end', 'end', 'Bottom right corner'],
    ['top-right', 'end', 'start', 'Top right corner'],
  ] as const)('puts the offered %s corner at its picture corner as a toggle', (corner, horizontal, vertical, label) => {
    expect(placementOf(corner)).toEqual({ corner, horizontal, vertical, interactive: true, label });
  });

  it('marks the top-left corner at the top left without a toggle', () => {
    const placement = placementOf('top-left');
    expect(placement.horizontal).toBe('start');
    expect(placement.vertical).toBe('start');
    expect(placement.interactive).toBe(false);
    expect(placement.label).toContain('Activities');
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

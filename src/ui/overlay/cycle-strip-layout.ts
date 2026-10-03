/**
 * Pure geometry for the cycle strip: the row of thumbnails along the
 * bottom of the depth view that shows the windows under the cursor,
 * frontmost on the left (see `cycle-strip.ts` for the actor).
 *
 * Every thumbnail is `thumbHeightPx` tall and as wide as its window's
 * aspect requires. The thumbnails sit in a row, `thumbGapPx` apart,
 * inside a background `paddingPx` larger on every side. The strip is
 * centred horizontally and its bottom edge sits `bottomMarginPx` above
 * the bottom of the work area. A row that would not fit the work area
 * width minus `bottomMarginPx` on either side is scaled down uniformly
 * (the thumbnails only; gaps and padding keep their size) until it does.
 *
 * The values in {@link CYCLE_STRIP_TUNING} are starting points for the
 * on-hardware checks, not settled choices.
 *
 * No `gi://` imports: this module is unit-tested under vitest.
 */

import type { Rect, Size } from './depth-layout.js';

export interface CycleStripTuning {
  /** Height of every thumbnail before any scale-to-fit, in px. */
  readonly thumbHeightPx: number;
  /** Horizontal distance between adjacent thumbnails, in px. */
  readonly thumbGapPx: number;
  /** Space between the thumbnails and the edge of the background, in px. */
  readonly paddingPx: number;
  /**
   * Distance between the strip's bottom edge and the work area's bottom
   * edge, in px. Also the least distance kept from the work area's left
   * and right edges.
   */
  readonly bottomMarginPx: number;
  /**
   * Duration of the strip's fade in and out, in ms. Not an input to
   * {@link computeStripLayout}; it lives here so all the strip's knobs sit
   * in one place.
   */
  readonly fadeMs: number;
}

export const CYCLE_STRIP_TUNING: CycleStripTuning = {
  thumbHeightPx: 120,
  thumbGapPx: 12,
  paddingPx: 12,
  bottomMarginPx: 24,
  fadeMs: 150,
};

export interface StripLayout {
  /** The background rect, relative to the work area. */
  readonly strip: Rect;
  /** One rect per input size, in the same order, relative to the work area. */
  readonly thumbs: Rect[];
}

/**
 * Lay out the strip for windows of the given `sizes` (in strip order)
 * inside a work area of size `area`. An empty `sizes` gives a zero-size
 * strip at the bottom centre and no thumbnails.
 */
export function computeStripLayout(
  sizes: readonly Size[],
  area: Size,
  tuning: CycleStripTuning
): StripLayout {
  const { thumbHeightPx, thumbGapPx, paddingPx, bottomMarginPx } = tuning;
  const bottom = area.height - bottomMarginPx;
  if (sizes.length === 0) {
    return { strip: { x: area.width / 2, y: bottom, width: 0, height: 0 }, thumbs: [] };
  }

  const widths = sizes.map(({ width, height }) =>
    height > 0 ? (thumbHeightPx * width) / height : 0
  );
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  const fixed = thumbGapPx * (sizes.length - 1) + 2 * paddingPx;
  const available = area.width - 2 * bottomMarginPx - fixed;
  const scale = totalWidth > 0 && totalWidth > available ? Math.max(0, available) / totalWidth : 1;

  const thumbHeight = thumbHeightPx * scale;
  const stripWidth = totalWidth * scale + fixed;
  const stripHeight = thumbHeight + 2 * paddingPx;
  const strip = {
    x: (area.width - stripWidth) / 2,
    y: bottom - stripHeight,
    width: stripWidth,
    height: stripHeight,
  };

  let x = strip.x + paddingPx;
  const thumbs = widths.map((w) => {
    const width = w * scale;
    const rect = { x, y: strip.y + paddingPx, width, height: thumbHeight };
    x += width + thumbGapPx;
    return rect;
  });
  return { strip, thumbs };
}

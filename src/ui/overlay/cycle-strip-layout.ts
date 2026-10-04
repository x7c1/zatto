/**
 * Pure geometry for the cycle strip: the row of thumbnails along the
 * bottom of the depth view that shows the windows under the cursor,
 * frontmost on the left (see `cycle-strip.ts` for the actor).
 *
 * Every thumbnail is `thumbHeightPx` tall and as wide as its window's
 * aspect requires. The thumbnails sit in a row, `thumbGapPx` apart,
 * inside a background `paddingPx` larger on every side, plus half an
 * icon at the top: each thumbnail carries its app icon centred on its
 * top edge, like the Activities Overview's window previews carry theirs
 * on the bottom edge. Below the thumbnails, `paddingPx` further down and
 * still inside the background, a `titleHeightPx` band holds the
 * highlighted window's title, so the title reads against the background
 * whatever lies behind the strip. The
 * strip's bottom edge sits `bottomMarginPx` above the bottom of the work
 * area, and the strip is centred horizontally. A row that would not fit the work area width minus
 * `bottomMarginPx` on either side is scaled down uniformly (the
 * thumbnails only; gaps, padding and icons keep their size) until it does.
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
  /**
   * Horizontal distance between adjacent thumbnails, in px. Wider than the
   * highlight's pad (see `cycle-strip.ts`), so the highlight behind the
   * focused thumbnail stays clear of its neighbours.
   */
  readonly thumbGapPx: number;
  /** Space between the thumbnails and the edge of the background, in px. */
  readonly paddingPx: number;
  /**
   * Distance between the strip's bottom edge and the work area's bottom
   * edge, in px. Also the least distance kept from the work area's left
   * and right edges.
   */
  readonly bottomMarginPx: number;
  /** Side of the square app icon centred on each thumbnail's top edge, in px. */
  readonly iconSizePx: number;
  /**
   * Height of the band inside the background, below the thumbnails, that
   * holds the highlighted window's title, in px; the title is centred in
   * it.
   */
  readonly titleHeightPx: number;
  /**
   * Duration of the strip's fade in and out, in ms. Not an input to
   * {@link computeStripLayout}; it lives here so all the strip's knobs sit
   * in one place.
   */
  readonly fadeMs: number;
}

export const CYCLE_STRIP_TUNING: CycleStripTuning = {
  thumbHeightPx: 120,
  thumbGapPx: 18,
  paddingPx: 12,
  bottomMarginPx: 24,
  iconSizePx: 32,
  titleHeightPx: 24,
  fadeMs: 150,
};

export interface StripLayout {
  /** The background rect, relative to the work area. */
  readonly strip: Rect;
  /** One rect per input size, in the same order, relative to the work area. */
  readonly thumbs: Rect[];
  /** One square per thumbnail, centred on the thumbnail's top edge. */
  readonly icons: Rect[];
  /** The title band: inside the background, below the thumbnails, within the padding. */
  readonly title: Rect;
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
  const { thumbHeightPx, thumbGapPx, paddingPx, bottomMarginPx, iconSizePx, titleHeightPx } =
    tuning;
  const bottom = area.height - bottomMarginPx;
  if (sizes.length === 0) {
    return {
      strip: { x: area.width / 2, y: bottom, width: 0, height: 0 },
      thumbs: [],
      icons: [],
      title: { x: area.width / 2, y: bottom, width: 0, height: 0 },
    };
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
  // Room above the thumbnails for the half of each icon that sticks out,
  // and the title band below them, a padding away, all inside the padding.
  const top = paddingPx + iconSizePx / 2;
  const stripHeight = top + thumbHeight + paddingPx + titleHeightPx + paddingPx;
  const strip = {
    x: (area.width - stripWidth) / 2,
    y: bottom - stripHeight,
    width: stripWidth,
    height: stripHeight,
  };

  let x = strip.x + paddingPx;
  const thumbs = widths.map((w) => {
    const width = w * scale;
    const rect = { x, y: strip.y + top, width, height: thumbHeight };
    x += width + thumbGapPx;
    return rect;
  });
  const icons = thumbs.map((thumb) => ({
    x: thumb.x + (thumb.width - iconSizePx) / 2,
    y: thumb.y - iconSizePx / 2,
    width: iconSizePx,
    height: iconSizePx,
  }));
  const title = {
    x: strip.x + paddingPx,
    y: strip.y + top + thumbHeight + paddingPx,
    width: stripWidth - 2 * paddingPx,
    height: titleHeightPx,
  };
  return { strip, thumbs, icons, title };
}

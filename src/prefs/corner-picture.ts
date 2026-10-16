/**
 * Pure layout of the preferences window's picture of the display: where each
 * hot corner sits on the picture, which corners can be switched there, and
 * how large the picture is. Kept free of GTK imports so it can be
 * unit-tested; `hot-corners-page.ts` turns it into widgets.
 */

import type { HotCorner } from '../ui/overlay/hot-corner-geometry.js';

/** An edge of the picture along one axis, as GTK's `START` / `END` alignment. */
export type PictureEdge = 'start' | 'end';

/** One corner of the picture. */
export interface CornerPlacement {
  readonly corner: HotCorner;
  /** The picture's left (`start`) or right (`end`) edge. */
  readonly horizontal: PictureEdge;
  /** The picture's top (`start`) or bottom (`end`) edge. */
  readonly vertical: PictureEdge;
  /**
   * Whether the corner is a toggle. The top-left corner is not: GNOME
   * Shell's own Activities hot corner lives there, so it is only marked.
   */
  readonly interactive: boolean;
  /** Tooltip and accessible label of the corner's control. */
  readonly label: string;
}

/** Every corner of the picture, in the order the window builds them. */
export const CORNER_PLACEMENTS: readonly CornerPlacement[] = [
  {
    corner: 'top-left',
    horizontal: 'start',
    vertical: 'start',
    interactive: false,
    label: 'Activities: GNOME Shell opens the overview from this corner',
  },
  {
    corner: 'top-right',
    horizontal: 'end',
    vertical: 'start',
    interactive: true,
    label: 'Top right corner',
  },
  {
    corner: 'bottom-left',
    horizontal: 'start',
    vertical: 'end',
    interactive: true,
    label: 'Bottom left corner',
  },
  {
    corner: 'bottom-right',
    horizontal: 'end',
    vertical: 'end',
    interactive: true,
    label: 'Bottom right corner',
  },
];

/** The aspect ratio used when the monitor's size cannot be read. */
export const FALLBACK_ASPECT = 16 / 9;

/** The picture's width, and its height limit for a portrait monitor. */
export const PICTURE_EXTENT = 280;

/**
 * The picture's size in pixels for a monitor of `width` x `height`: the
 * fixed width {@link PICTURE_EXTENT} with the monitor's aspect ratio, or
 * {@link FALLBACK_ASPECT} when the size is missing or not positive. A
 * portrait monitor is scaled down to {@link PICTURE_EXTENT} high instead,
 * so the picture still fits the window.
 */
export function pictureSize(
  width: number | undefined,
  height: number | undefined
): { width: number; height: number } {
  const readable =
    width !== undefined &&
    height !== undefined &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0;
  const aspect = readable ? width / height : FALLBACK_ASPECT;
  if (aspect >= 1) {
    return { width: PICTURE_EXTENT, height: Math.round(PICTURE_EXTENT / aspect) };
  }
  return { width: Math.round(PICTURE_EXTENT * aspect), height: PICTURE_EXTENT };
}

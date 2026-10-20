/**
 * Pure decisions for the close button of the depth view: which window
 * carries it, where it sits on that window's clone, and where the focus
 * goes once a window has gone.
 *
 * One button is shown at a time, at the top-right corner of the frontmost
 * window's clone, as the Activities Overview shows one on a window preview:
 *
 *   - With a focus (the cycle has focused a window, which is then drawn on
 *     top of everything), the focused window carries it, wherever the
 *     pointer is.
 *   - Without one, the window drawn frontmost under the pointer carries
 *     it: the window a click there would raise. Keying the button on the
 *     focus alone would leave a window that is in front without being
 *     cycled to (one that overlaps nothing, for one) without a button.
 *   - With neither, no window carries it.
 *
 * Unlike the Overview's, the button does not fade after a while: it stays
 * until the frontmost window changes.
 *
 * Indices are into the mirror's clones, bottom to top, as in
 * `depth-cycle.ts`.
 *
 * No `gi://` imports: this module is unit-tested under vitest.
 */

import type { Rect } from './depth-layout.js';

/** The knobs of `DEPTH_VIEW_TUNING` that place the close button. */
export interface CloseButtonTuning {
  readonly closeButtonSizePx: number;
  readonly closeButtonInsetPx: number;
}

/**
 * The window that carries the close button, or `null` when none does.
 *
 * `focused` is the focused index or `null`; `under` the windows drawn
 * under the pointer ({@link windowsUnder} order, empty when the pointer is
 * over empty desktop, on the cycle strip or unknown). `current` is the
 * window that carries the button now and `onButton` whether the pointer is
 * on the button: the button may overlap a window drawn in front of its
 * carrier, and reaching for it must not move it to that window.
 */
export function closeButtonCarrier(
  focused: number | null,
  under: readonly number[],
  current: number | null,
  onButton: boolean
): number | null {
  if (focused !== null) {
    return focused;
  }
  if (onButton && current !== null) {
    return current;
  }
  return under.at(-1) ?? null;
}

/**
 * Where the close button sits on a clone whose visible (frame) rect is
 * drawn at `frame`: a `closeButtonSizePx` square `closeButtonInsetPx` in
 * from the frame's top and right edges. On a frame too small for that, it
 * moves left and down only as far as the frame's left and top edges, so it
 * never leaves the visible area on those sides.
 */
export function closeButtonRect(frame: Rect, tuning: CloseButtonTuning): Rect {
  const size = tuning.closeButtonSizePx;
  const inset = tuning.closeButtonInsetPx;
  return {
    x: Math.max(frame.x, frame.x + frame.width - inset - size),
    y: frame.y + Math.min(inset, Math.max(0, frame.height - size)),
    width: size,
    height: size,
  };
}

/**
 * The focus once the window at `closed` has gone, as an index into the
 * clones that remain (every index above `closed` moves down by one), or
 * `null` for no focus.
 *
 * `focused` is the focus before the window went. `group` holds the
 * windows drawn where the closed window was picked ({@link windowsUnder}
 * order, before the removal, the closed window among them).
 *
 * When the closed window was focused, the focus moves to the next window
 * in that overlap, the one the cycle's `forward` step would reach: the
 * window directly behind the closed one, or the frontmost one when it was
 * the deepest; with no other window there, the focus is cleared. Otherwise
 * the focus stays where it is, and stays cleared when there was none: the
 * button then follows the pointer to the window now frontmost under it.
 * Focusing a window there would pin the button to it, and a window
 * elsewhere that overlaps nothing could not carry it again.
 */
export function focusAfterClose(
  closed: number,
  focused: number | null,
  group: readonly number[]
): number | null {
  let next: number | null = focused;
  if (focused === closed) {
    const position = group.indexOf(closed);
    if (position === -1 || group.length < 2) {
      next = null;
    } else {
      next = position > 0 ? group[position - 1] : group[group.length - 1];
    }
  }
  return next === null ? null : reindexAfterRemoval(next, closed);
}

/**
 * `group` ({@link windowsUnder} order) once the window at `removed` has
 * gone: without it, and with every index above it moved down by one.
 */
export function withoutIndex(group: readonly number[], removed: number): number[] {
  return group
    .filter((index) => index !== removed)
    .map((index) => reindexAfterRemoval(index, removed));
}

function reindexAfterRemoval(index: number, removed: number): number {
  return index > removed ? index - 1 : index;
}

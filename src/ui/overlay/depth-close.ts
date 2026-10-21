/**
 * Pure decisions for the close button of the depth view: which window
 * carries it, where it sits on that window's clone, and where the focus
 * goes once a window has gone.
 *
 * One button is shown at a time, at a top corner of the frontmost
 * window's clone, styled as the Activities Overview's on a window preview:
 *
 *   - The window drawn frontmost under the pointer carries it: the window
 *     a click there would raise. The focused window, drawn on top of
 *     everything, is that window wherever it is under the pointer; any
 *     other window under the pointer takes the button once the pointer
 *     moves onto it, whether the focus came from the wheel or not.
 *   - With no window under the pointer (empty desktop, the cycle strip),
 *     the focused window carries it, and with no focus either, none does.
 *
 * Unlike the Overview's, the button does not fade after a while: it stays
 * until the frontmost window changes.
 *
 * It closes its window when released over it, as the Overview's does.
 * While it is held down it stays on its window whatever the pointer, the
 * focus or the windows under the pointer do, so the release acts on the
 * window the press was made on and the button does not move from under
 * the pointer mid-click; once released, the rules above apply again.
 *
 * Indices are into the mirror's clones, bottom to top, as in
 * `depth-cycle.ts`.
 *
 * No `gi://` imports: this module is unit-tested under vitest.
 */

import type { Point } from './depth-cycle.js';
import type { Rect } from './depth-layout.js';

/** What, besides the frame, decides where the close button sits. */
export interface CloseButtonPlacement {
  /** The button's size, as the shell theme styles it. */
  readonly size: { readonly width: number; readonly height: number };
  /** Whether the window button layout puts close among the left buttons. */
  readonly onLeft: boolean;
  /**
   * Distance from the button to the frame's top edge and to the side edge
   * of its corner, in px (`DEPTH_VIEW_TUNING.closeButtonInsetPx`).
   */
  readonly inset: number;
}

/**
 * Where the pointer is relative to the close button: elsewhere, within
 * its rect, or holding it down (wherever the pointer has moved since).
 */
export type ButtonPointer = 'elsewhere' | 'over' | 'holding';

/**
 * The window that carries the close button, or `null` when none does.
 *
 * `focused` is the focused index or `null`; `under` the windows drawn
 * under the pointer ({@link windowsUnder} order, empty when the pointer is
 * over empty desktop, on the cycle strip or unknown). `current` is the
 * window that carries the button now and `button` where the pointer is
 * relative to it. While the button is held, it stays on `current`. Over
 * the button, it stays there too: the button may reach past its carrier's
 * frame onto a window drawn behind it, and reaching for it must not move
 * it to that window. A window drawn in front of the carrier hides the
 * button where it covers it, as it hides the carrier, so the pointer
 * there is on that window.
 */
export function closeButtonCarrier(
  focused: number | null,
  under: readonly number[],
  current: number | null,
  button: ButtonPointer
): number | null {
  if (current !== null && button === 'holding') {
    return current;
  }
  if (
    current !== null &&
    button === 'over' &&
    !under.some((i) => drawnAbove(i, current, focused))
  ) {
    return current;
  }
  if (focused !== null && under.includes(focused)) {
    return focused;
  }
  return under.at(-1) ?? focused;
}

/**
 * Whether the window at `a` is drawn in front of the one at `b`: the
 * focused window is drawn on top of everything, the others in index order.
 */
function drawnAbove(a: number, b: number, focused: number | null): boolean {
  if (a === b || b === focused) {
    return false;
  }
  return a === focused || a > b;
}

/**
 * Where the close button sits on a clone whose visible (frame) rect is
 * drawn at `frame`: `inset` in from its top edge and its right edge, or
 * its left one when close is on the left. A negative inset puts the
 * button that far past those edges; it is not kept inside the work area,
 * so on a maximized window it reaches past the screen's edge.
 *
 * The Activities Overview centres its button on the preview's corner,
 * half outside it. The depth view draws windows near their real size, so
 * there such a button reads as a half-overlapping duplicate of the
 * window's own title bar close button; at the corner, mostly inside the
 * frame, it covers that button instead, which suits a control that does
 * the same thing.
 *
 * On a frame too small for that, the button moves only as far as needed
 * not to leave the frame's far side: the left edge (the right one when
 * close is on the left) and the bottom edge.
 */
export function closeButtonRect(frame: Rect, placement: CloseButtonPlacement): Rect {
  const { width, height } = placement.size;
  const { inset } = placement;
  const x = placement.onLeft
    ? Math.min(frame.x + inset, frame.x + frame.width - width)
    : Math.max(frame.x, frame.x + frame.width - inset - width);
  const y = Math.min(frame.y + inset, frame.y + frame.height - height);
  return {
    x,
    y,
    width,
    height,
  };
}

/**
 * A point inside `frame` for the close button drawn at `button` on it:
 * the button's centre, moved into the frame when it lies outside, as it
 * does on a frame smaller than the button or with a negative inset. The
 * point is where {@link windowsUnder} (whose hit test leaves out a
 * frame's right and bottom edges) finds the windows drawn where the
 * button was pressed, the frame's window among them.
 */
export function closeButtonProbe(button: Rect, frame: Rect): Point {
  const inX = Math.min(1, frame.width / 2);
  const inY = Math.min(1, frame.height / 2);
  return {
    x: Math.min(Math.max(button.x + button.width / 2, frame.x), frame.x + frame.width - inX),
    y: Math.min(Math.max(button.y + button.height / 2, frame.y), frame.y + frame.height - inY),
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

/**
 * Pure hit-testing and focus stepping for cycling through the windows
 * under the cursor in the depth view.
 *
 * The depth view draws the stacking order as an oblique stack (see
 * `depth-layout.ts`) and stays still while the overlay is open. Turning
 * the scroll wheel over a spot where windows overlap moves a focus one
 * window deeper (or shallower) at that spot: {@link windowsUnder} finds
 * the windows drawn under the cursor and {@link cycleFocus} picks the
 * next one to focus among them.
 *
 * No `gi://` imports: this module is unit-tested under vitest.
 */

import type { DepthViewLayout, Rect } from './depth-layout.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Which way {@link cycleFocus} moves the focus: `forward` goes one window
 * deeper, `backward` one window nearer the viewer.
 */
export type CycleDirection = 'forward' | 'backward';

/**
 * The indices of the `frames` whose drawn rect contains `point`.
 *
 * `frames` are the work-area-relative frame rects in bottom-to-top
 * stacking order and `layout` is the {@link DepthViewLayout} computed for
 * them. A frame is drawn moved by its clone's offset and then put
 * through the container transform (scale about (0, 0), then
 * translation). Frame rects, not buffer rects, are tested, so
 * shadows and invisible borders do not count as the window. `point` is
 * in work-area coordinates; a rect contains its left and top edges but
 * not its right and bottom ones.
 *
 * The result is in the same order as `frames`, so its last entry is the
 * frontmost window under the point.
 */
export function windowsUnder(
  point: Point,
  frames: readonly Rect[],
  layout: DepthViewLayout
): number[] {
  const { scale, translationX, translationY } = layout.container;
  const hits: number[] = [];
  frames.forEach((frame, i) => {
    const offsetX = layout.clones[i]?.offsetX ?? 0;
    const offsetY = layout.clones[i]?.offsetY ?? 0;
    const left = (frame.x + offsetX) * scale + translationX;
    const top = (frame.y + offsetY) * scale + translationY;
    const right = left + frame.width * scale;
    const bottom = top + frame.height * scale;
    if (point.x >= left && point.x < right && point.y >= top && point.y < bottom) {
      hits.push(i);
    }
  });
  return hits;
}

/**
 * The member of `group` to focus after one step in `direction`.
 *
 * `group` is the result of {@link windowsUnder}: indices bottom to top,
 * at least two of them. `focused` is the index currently focused, or
 * `null`. With `focused` `null` or not in `group`, the focus is taken to
 * sit on the frontmost member (the window the user sees there), so
 * `forward` returns the member directly behind it and `backward` the
 * deepest member. Otherwise `forward` returns the next deeper member,
 * wrapping from the deepest to the frontmost, and `backward` the reverse.
 */
export function cycleFocus(
  group: readonly number[],
  focused: number | null,
  direction: CycleDirection
): number {
  const found = focused === null ? -1 : group.indexOf(focused);
  const position = found === -1 ? group.length - 1 : found;
  const step = direction === 'forward' ? -1 : 1;
  const next = (position + step + group.length) % group.length;
  return group[next];
}

/**
 * The position in the cycle strip of the thumbnail to highlight.
 *
 * `group` is the result of {@link windowsUnder} (indices bottom to top)
 * and `focused` the index currently focused, or `null`. The strip shows
 * the group front to back, so position 0 is the frontmost member (the
 * last entry of `group`). Returns the position of `focused` when it is in
 * `group`, else 0: like {@link cycleFocus}, the focus is then taken to sit
 * on the frontmost member.
 */
export function focusWithin(group: readonly number[], focused: number | null): number {
  const found = focused === null ? -1 : group.indexOf(focused);
  return found === -1 ? 0 : group.length - 1 - found;
}

/**
 * Pure geometry for the hot-corner trigger: where the reactive square for a
 * given corner sits on a monitor. Kept free of GNOME Shell imports so it can
 * be unit-tested.
 */

import type { Rect } from './depth-layout.js';

/** A corner of a monitor that can host a hot-corner trigger. */
export type HotCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Rect of the `size` x `size` trigger square anchored at `corner` of
 * `monitor`, in stage coordinates.
 */
export function hotCornerRect(corner: HotCorner, monitor: Rect, size: number): Rect {
  const left = monitor.x;
  const right = monitor.x + monitor.width - size;
  const top = monitor.y;
  const bottom = monitor.y + monitor.height - size;
  switch (corner) {
    case 'top-left':
      return { x: left, y: top, width: size, height: size };
    case 'top-right':
      return { x: right, y: top, width: size, height: size };
    case 'bottom-left':
      return { x: left, y: bottom, width: size, height: size };
    case 'bottom-right':
      return { x: right, y: bottom, width: size, height: size };
  }
}

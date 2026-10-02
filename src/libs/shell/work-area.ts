import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** A rectangle in stage coordinates. */
export interface WorkArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The primary monitor's work area: the monitor minus the struts the top
 * bar and the dock reserve, the same area the Activities Overview lays
 * windows out in. `null` when there is no primary monitor.
 *
 * The work area excludes the dock only when the dock reserves space
 * (Ubuntu's default, auto-hide off). With an auto-hiding dock it includes
 * the dock's strip, so the overlay draws there too; whether the dock shows
 * over it is the dock's own decision, and the overlay does not drive it.
 */
export function primaryWorkArea(): WorkArea | null {
  const { layoutManager } = Main;
  if (!layoutManager.primaryMonitor) {
    return null;
  }
  const { x, y, width, height } = layoutManager.getWorkAreaForMonitor(layoutManager.primaryIndex);
  return { x, y, width, height };
}

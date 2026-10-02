/**
 * GNOME Shell production implementation of {@link RealWindowsPort}.
 *
 * Flips `visible` on both `global.window_group` and
 * `global.top_window_group`, as gnome-shell's own
 * `LayoutManager._updateVisibility()` (`js/ui/layout.js`) does for the
 * Activities Overview. `window_group` parents the normal window actors;
 * `top_window_group` parents popups, OSDs and similar surfaces that would
 * otherwise show through the overlay. `Clutter.Clone` keeps painting a
 * hidden source, so the clones are unaffected.
 *
 * `hide()` and `show()` are synchronous and do not fade: the clones cover
 * their sources exactly at both moments, so a fade would only show the
 * double image the hiding exists to remove.
 *
 * Every call also cancels transitions on the groups and resets `opacity`,
 * in case anything else left them half-hidden. {@link restore} is the
 * safety net: `show()` plus a timestamp, safe to call at any time.
 * {@link snapshot} reports intent, not live state.
 */

import type Clutter from 'gi://Clutter';
import type { RealWindowsPort, RealWindowsSnapshot } from './ports.js';

export class GnomeRealWindows implements RealWindowsPort {
  private hidden = false;
  private lastRestoredAt: number | null = null;

  hide(): void {
    this.setVisible(false);
    this.hidden = true;
  }

  show(): void {
    this.setVisible(true);
    this.hidden = false;
  }

  restore(): void {
    this.setVisible(true);
    this.hidden = false;
    this.lastRestoredAt = Date.now();
  }

  snapshot(): RealWindowsSnapshot {
    return {
      hidden: this.hidden,
      lastRestoredAt: this.lastRestoredAt,
    };
  }

  private setVisible(visible: boolean): void {
    for (const group of this.groups()) {
      // A stale ease from elsewhere must not resurrect an older state.
      group.remove_all_transitions();
      group.visible = visible;
      group.opacity = 255;
    }
  }

  private groups(): readonly Clutter.Actor[] {
    return [global.window_group, global.top_window_group];
  }
}

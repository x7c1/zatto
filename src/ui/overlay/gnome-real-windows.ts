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
 *
 * Backdrop: the shell keeps the wallpaper inside `window_group`, and the
 * stage is not cleared between frames because the wallpaper is expected
 * to cover it. Hiding the group would leave nothing opaque behind the
 * clones, and a moving clone would leave trails of its earlier frames.
 * While the windows are hidden, an opaque backdrop covers the whole
 * stage just above `window_group`, below the top bar, the dock and the
 * overlay, as the Activities Overview paints its own background. It
 * draws a copy of the wallpaper on every monitor, at the same place and
 * size as the real one, so opening the overlay does not change the
 * background at all; the dark colour only shows between monitors. It is
 * not faded: a translucent backdrop would bring the trails back.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type { RealWindowsPort, RealWindowsSnapshot } from './ports.js';

const BACKDROP_STYLE = 'background-color: #242424;';

export class GnomeRealWindows implements RealWindowsPort {
  private hidden = false;
  private lastRestoredAt: number | null = null;
  private backdrop: St.Widget | null = null;
  private backgrounds: Background.BackgroundManager[] = [];
  private monitorsChangedId: number | null = null;

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

  /** Remove the backdrop actor. Call on disable, after {@link restore}. */
  destroy(): void {
    if (this.monitorsChangedId !== null) {
      Main.layoutManager.disconnect(this.monitorsChangedId);
      this.monitorsChangedId = null;
    }
    this.destroyBackgrounds();
    this.backdrop?.destroy();
    this.backdrop = null;
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
    if (visible) {
      this.backdrop?.hide();
    } else {
      this.ensureBackdrop().show();
    }
  }

  private ensureBackdrop(): St.Widget {
    if (this.backdrop === null) {
      const backdrop = new St.Widget({ style: BACKDROP_STYLE, reactive: false, visible: false });
      backdrop.add_constraint(
        new Clutter.BindConstraint({
          source: global.stage,
          coordinate: Clutter.BindCoordinate.SIZE,
        })
      );
      Main.layoutManager.uiGroup.insert_child_above(backdrop, global.window_group);
      this.backdrop = backdrop;
      this.createBackgrounds();
      this.monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
        this.destroyBackgrounds();
        this.createBackgrounds();
      });
    }
    return this.backdrop;
  }

  /** One wallpaper copy per monitor, positioned on that monitor. */
  private createBackgrounds(): void {
    const container = this.backdrop;
    if (container === null) {
      return;
    }
    this.backgrounds = Main.layoutManager.monitors.map(
      (_monitor, monitorIndex) =>
        new Background.BackgroundManager({ container, monitorIndex, vignette: false })
    );
  }

  private destroyBackgrounds(): void {
    for (const manager of this.backgrounds) {
      manager.destroy();
    }
    this.backgrounds = [];
  }

  private groups(): readonly Clutter.Actor[] {
    return [global.window_group, global.top_window_group];
  }
}

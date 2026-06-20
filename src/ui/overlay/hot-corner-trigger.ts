/**
 * Hot-corner trigger for the bottom-left of the primary monitor.
 *
 * We deliberately use a small invisible reactive Clutter.Actor anchored to the
 * corner rather than `Layout.PressureBarrier` or the private `Layout.HotCorner`
 * class. Two reasons:
 *
 *   1. `Layout.HotCorner` is a Shell-internal helper that bakes in
 *      assumptions about the Activities-style top-left corner (animation,
 *      ripple effect, click-through behavior). Reusing it would force us to
 *      either fight those defaults or override private fields.
 *   2. `PressureBarrier` requires a measurable cursor pressure threshold
 *      which is great for accidental-trigger prevention but adds a tunable we
 *      don't yet know how to set well. A simple `enter-event` is enough for
 *      a PoC and keeps the surface area small.
 *
 * The actor itself is 5x5 px (smaller than a deliberate cursor move) and
 * positioned at (monitor.x, monitor.y + monitor.height - 5). It is invisible
 * (`opacity: 0`) but reactive, so it fires `enter-event` without any visual
 * disruption.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { safeAddChrome } from '../../libs/shell/safe-add-chrome.js';

const TRIGGER_SIZE = 5;

export class HotCornerTrigger {
  private actor: St.Widget | null = null;
  private enterHandlerId: number | null = null;

  constructor(private readonly onEnter: () => void) {}

  /** Install the corner actor and start listening for hovers. */
  enable(): void {
    if (this.actor !== null) {
      return;
    }
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) {
      console.warn('[Zatto] HotCornerTrigger.enable: no primary monitor available');
      return;
    }

    const actor = new St.Widget({
      reactive: true,
      opacity: 0,
      width: TRIGGER_SIZE,
      height: TRIGGER_SIZE,
      x: monitor.x,
      y: monitor.y + monitor.height - TRIGGER_SIZE,
    });
    actor.add_style_class_name('zatto-hotcorner-trigger');

    this.enterHandlerId = actor.connect('enter-event', () => {
      this.onEnter();
      return Clutter.EVENT_PROPAGATE;
    });

    safeAddChrome(actor);
    this.actor = actor;
  }

  /** Tear down the corner actor. Idempotent. */
  disable(): void {
    if (this.actor !== null) {
      if (this.enterHandlerId !== null) {
        this.actor.disconnect(this.enterHandlerId);
        this.enterHandlerId = null;
      }
      Main.layoutManager.removeChrome(this.actor);
      this.actor.destroy();
      this.actor = null;
    }
  }
}

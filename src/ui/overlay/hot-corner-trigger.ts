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
 *
 * Activities-Overview suppression: Clutter performs a stage repick whenever
 * pointer grabs are acquired/released or the reactive actor graph changes
 * substantially. The `Main.overview` showing/hidden lifecycle does both, and
 * during a repick Clutter synthesizes `enter`/`leave` events on the actor now
 * under the cursor even with no physical cursor motion. Our reactive 5x5
 * chrome actor gets caught in that synthesis and spuriously fires
 * `enter-event`. We mirror Shell's own `Layout.HotCorner` guard: while the
 * Overview is active, ignore `enter-event` entirely.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { safeAddChrome } from '../../libs/shell/safe-add-chrome.js';
import type { HotCornerPort } from './ports.js';

/**
 * Side length (px) of the invisible reactive square anchored at the bottom-left
 * corner. Exported so the in-overlay re-entry sensor (mounted as a child of
 * the dimmer in {@link OverlayActor}) can mirror the same rect — the user must
 * see the two sensors as a single corner regardless of whether the modal grab
 * is held.
 */
export const HOT_CORNER_SIZE = 5;

export class HotCornerTrigger implements HotCornerPort {
  private actor: St.Widget | null = null;
  private enterHandlerId: number | null = null;
  private handler: (() => void) | null = null;
  private suppressed = false;
  private overviewShowingId: number | null = null;
  private overviewHiddenId: number | null = null;

  /** Register the single enter handler. Must be set before {@link enable}. */
  onEnter(handler: () => void): void {
    this.handler = handler;
  }

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
      width: HOT_CORNER_SIZE,
      height: HOT_CORNER_SIZE,
      x: monitor.x,
      y: monitor.y + monitor.height - HOT_CORNER_SIZE,
    });
    actor.add_style_class_name('zatto-hotcorner-trigger');

    this.enterHandlerId = actor.connect('enter-event', () => {
      if (this.suppressed || Main.overview.visible) {
        return Clutter.EVENT_PROPAGATE;
      }
      this.handler?.();
      return Clutter.EVENT_PROPAGATE;
    });

    safeAddChrome(actor);
    this.actor = actor;

    this.overviewShowingId = Main.overview.connect('showing', () => {
      this.suppressed = true;
    });
    this.overviewHiddenId = Main.overview.connect('hidden', () => {
      this.suppressed = false;
    });
  }

  /** Tear down the corner actor. Idempotent. */
  disable(): void {
    if (this.overviewShowingId !== null) {
      Main.overview.disconnect(this.overviewShowingId);
      this.overviewShowingId = null;
    }
    if (this.overviewHiddenId !== null) {
      Main.overview.disconnect(this.overviewHiddenId);
      this.overviewHiddenId = null;
    }
    this.suppressed = false;

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

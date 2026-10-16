/**
 * Hot-corner trigger for a configurable set of corners of the primary
 * monitor (see {@link HotCorner}). Every corner fires the same handler, so the
 * controller sees a single trigger.
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
 * Each corner gets its own 5x5 px actor (smaller than a deliberate cursor
 * move), placed by {@link hotCornerRect}. The actors are invisible
 * (`opacity: 0`) but reactive, so they fire `enter-event` without any visual
 * disruption. While enabled, the trigger follows `monitors-changed` and moves
 * the actors to the new primary monitor's corners, so a layout change does not
 * leave them stranded away from the real corners. {@link
 * HotCornerTrigger.setCorners} changes the corner set while enabled without
 * touching anything else (the overlay in particular), so a change can arrive
 * in any overlay state.
 *
 * Activities-Overview suppression: Clutter performs a stage repick whenever
 * pointer grabs are acquired/released or the reactive actor graph changes
 * substantially. The `Main.overview` showing/hidden lifecycle does both, and
 * during a repick Clutter synthesizes `enter`/`leave` events on the actor now
 * under the cursor even with no physical cursor motion. Our reactive 5x5
 * chrome actors get caught in that synthesis and spuriously fire
 * `enter-event`. We mirror Shell's own `Layout.HotCorner` guard: while the
 * Overview is active, ignore `enter-event` entirely.
 *
 * Stacking: each trigger actor is added as top chrome (`addTopChrome`), above
 * everything `addChrome` places, popups included. A dock that reaches the
 * corner is ordinary chrome, and Ubuntu Dock removes and re-adds itself
 * each time its "fixed" mode is toggled; `addChrome` restacks the re-added
 * dock to just below `top_window_group` after the `child-added` signal has
 * fired, so re-raising a trigger from that signal lost the race and the
 * fixed dock ended up covering the corner. Top chrome stays above the
 * dock whatever it does. In exchange, the 5x5 px at each corner receive no
 * clicks, whether a dock or a popup is drawn there.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { safeAddTopChrome } from '../../libs/shell/safe-add-chrome.js';
import { type HotCorner, hotCornerRect } from './hot-corner-geometry.js';
import type { HotCornerPort } from './ports.js';

/** Side length (px) of the invisible reactive square anchored at each corner. */
const HOT_CORNER_SIZE = 5;

interface CornerActor {
  readonly corner: HotCorner;
  readonly actor: St.Widget;
  readonly enterHandlerId: number;
}

export class HotCornerTrigger implements HotCornerPort {
  private corners: readonly HotCorner[];
  private enabled = false;
  private actors: CornerActor[] = [];
  private handler: (() => void) | null = null;
  private suppressed = false;
  private overviewShowingId: number | null = null;
  private overviewHiddenId: number | null = null;
  private monitorsChangedId: number | null = null;

  /** @param corners Corners of the primary monitor that open the depth view. */
  constructor(corners: readonly HotCorner[]) {
    this.corners = [...new Set(corners)];
  }

  /** The corners the trigger currently covers (its configured set). */
  getCorners(): readonly HotCorner[] {
    return this.corners;
  }

  /**
   * Replace the corner set. While enabled, the actors follow at once: removed
   * corners lose their actor, added corners get one, kept corners keep theirs.
   */
  setCorners(corners: readonly HotCorner[]): void {
    this.corners = [...new Set(corners)];
    if (this.enabled) {
      this.syncToPrimaryMonitor('corners-changed');
    }
  }

  /** Register the single enter handler. Must be set before {@link enable}. */
  onEnter(handler: () => void): void {
    this.handler = handler;
  }

  /** Install the corner actors and start listening for hovers. */
  enable(): void {
    if (this.enabled) {
      return;
    }
    this.enabled = true;

    this.overviewShowingId = Main.overview.connect('showing', () => {
      this.suppressed = true;
    });
    this.overviewHiddenId = Main.overview.connect('hidden', () => {
      this.suppressed = false;
    });
    this.monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
      this.syncToPrimaryMonitor('monitors-changed');
    });

    this.syncToPrimaryMonitor('enable');
  }

  /** Tear down the corner actors. Idempotent. */
  disable(): void {
    if (this.overviewShowingId !== null) {
      Main.overview.disconnect(this.overviewShowingId);
      this.overviewShowingId = null;
    }
    if (this.overviewHiddenId !== null) {
      Main.overview.disconnect(this.overviewHiddenId);
      this.overviewHiddenId = null;
    }
    if (this.monitorsChangedId !== null) {
      Main.layoutManager.disconnect(this.monitorsChangedId);
      this.monitorsChangedId = null;
    }
    this.suppressed = false;
    this.destroyActors();
    this.enabled = false;
  }

  /**
   * Place one actor on each configured corner of the current primary monitor,
   * creating missing actors and destroying those of corners no longer
   * configured. Without a primary monitor the actors are removed until a later
   * `monitors-changed` brings one back.
   */
  private syncToPrimaryMonitor(reason: string): void {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) {
      console.warn(`[Zatto] HotCornerTrigger (${reason}): no primary monitor available`);
      this.destroyActors();
      return;
    }
    for (const entry of [...this.actors]) {
      if (!this.corners.includes(entry.corner)) {
        // Untrack only after the destroy succeeded, so a throw leaves the
        // actor tracked and `disable()` tries again.
        this.destroyActor(entry);
        this.actors = this.actors.filter((a) => a !== entry);
      }
    }
    for (const corner of this.corners) {
      if (!this.actors.some((a) => a.corner === corner)) {
        // Push each actor as it is created: if a later `createActor` throws,
        // the earlier ones are already tracked and `disable()` removes them.
        this.actors.push(this.createActor(corner));
      }
    }
    for (const { corner, actor } of this.actors) {
      const rect = hotCornerRect(corner, monitor, HOT_CORNER_SIZE);
      actor.set_position(rect.x, rect.y);
      actor.set_size(rect.width, rect.height);
    }
  }

  private createActor(corner: HotCorner): CornerActor {
    const actor = new St.Widget({ reactive: true, opacity: 0 });
    actor.add_style_class_name('zatto-hotcorner-trigger');
    const enterHandlerId = actor.connect('enter-event', () => {
      if (this.suppressed || Main.overview.visible) {
        return Clutter.EVENT_PROPAGATE;
      }
      this.handler?.();
      return Clutter.EVENT_PROPAGATE;
    });
    safeAddTopChrome(actor);
    return { corner, actor, enterHandlerId };
  }

  private destroyActors(): void {
    for (const entry of this.actors) {
      this.destroyActor(entry);
    }
    this.actors = [];
  }

  private destroyActor({ actor, enterHandlerId }: CornerActor): void {
    actor.disconnect(enterHandlerId);
    Main.layoutManager.removeChrome(actor);
    actor.destroy();
  }
}

/**
 * Glue layer: connects the pure {@link OverlayStateMachine} to the GNOME
 * Shell runtime (hot-corner actor, dimmer/card actor, modal grab, Esc key).
 *
 * Layering: this module is the only place where GJS imports and the FSM meet.
 * The FSM stays framework-free; the actor and trigger modules stay free of
 * FSM concerns.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { HotCornerTrigger } from './hot-corner-trigger.js';
import { OverlayActor } from './overlay-actor.js';
import { OverlayStateMachine } from './overlay-state-machine.js';

/**
 * Debounce window for hot-corner re-entry. 250 ms is short enough to feel
 * responsive (a deliberate second hover is well above this) and long enough
 * to absorb cursor jitter at the corner.
 */
const HOTCORNER_DEBOUNCE_MS = 250;

export class OverlayController {
  private readonly fsm: OverlayStateMachine;
  private readonly actor: OverlayActor;
  private readonly trigger: HotCornerTrigger;
  private grab: Clutter.Grab | null = null;
  private capturedEventId: number | null = null;
  private unsubscribeFsm: (() => void) | null = null;

  constructor() {
    this.fsm = new OverlayStateMachine({
      debounceMs: HOTCORNER_DEBOUNCE_MS,
      now: () => GLib.get_monotonic_time() / 1000, // microseconds -> ms
    });
    this.actor = new OverlayActor();
    this.trigger = new HotCornerTrigger(() => this.fsm.toggle());
  }

  enable(): void {
    this.unsubscribeFsm = this.fsm.onEvent((event) => {
      switch (event.type) {
        case 'open-requested':
          this.handleOpen();
          break;
        case 'close-requested':
          this.handleClose();
          break;
        case 'opened':
        case 'closed':
          // Terminal states — no extra glue work needed for the PoC.
          break;
      }
    });

    this.actor.mount();
    this.trigger.enable();
  }

  disable(): void {
    this.trigger.disable();
    this.releaseGrab();
    this.actor.destroy();

    if (this.unsubscribeFsm !== null) {
      this.unsubscribeFsm();
      this.unsubscribeFsm = null;
    }
    this.fsm.reset();
  }

  private handleOpen(): void {
    this.actor.show();
    this.acquireGrab();
    this.fsm.commitOpened();
  }

  private handleClose(): void {
    this.releaseGrab();
    this.actor.hide();
    this.fsm.commitClosed();
  }

  private acquireGrab(): void {
    const grabActor = this.actor.getGrabActor();
    if (grabActor === null) {
      return;
    }
    try {
      this.grab = Main.pushModal(grabActor) as Clutter.Grab;
    } catch (e) {
      console.warn(`[Zatto] OverlayController: pushModal failed: ${e}`);
      this.grab = null;
      return;
    }
    this.capturedEventId = grabActor.connect('captured-event', (_actor, event) => {
      if (
        event.type() === Clutter.EventType.KEY_PRESS &&
        event.get_key_symbol() === Clutter.KEY_Escape
      ) {
        this.fsm.dismiss();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });
  }

  private releaseGrab(): void {
    const grabActor = this.actor.getGrabActor();
    if (grabActor !== null && this.capturedEventId !== null) {
      grabActor.disconnect(this.capturedEventId);
      this.capturedEventId = null;
    }
    if (this.grab !== null) {
      try {
        Main.popModal(this.grab);
      } catch (e) {
        console.warn(`[Zatto] OverlayController: popModal failed: ${e}`);
      }
      this.grab = null;
    }
  }
}

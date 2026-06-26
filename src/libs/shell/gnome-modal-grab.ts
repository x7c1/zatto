/**
 * GNOME Shell production implementation of {@link ModalGrabPort}.
 *
 * Wraps `Main.pushModal` / `Main.popModal` and the `captured-event` Esc-key
 * handler that the overlay relies on. Keeping these two together — rather
 * than splitting them across separate ports — matches reality: the Esc
 * handler is wired on the grab actor at `acquire()` time and torn down at
 * `release()` time. Splitting them would force the controller to coordinate
 * lifetimes by hand for no gain.
 *
 * The grab target is supplied lazily via the `getGrabActor` callback so this
 * class does not have to know how the overlay actor is mounted.
 */

import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type { ModalGrabPort } from '../../ui/overlay/ports.js';

export class GnomeModalGrab implements ModalGrabPort {
  private grab: Clutter.Grab | null = null;
  private capturedEventId: number | null = null;
  private capturedActor: Clutter.Actor | null = null;
  private escHandler: (() => void) | null = null;

  constructor(private readonly getGrabActor: () => Clutter.Actor | null) {}

  onEsc(handler: () => void): void {
    this.escHandler = handler;
  }

  acquire(): boolean {
    const grabActor = this.getGrabActor();
    if (grabActor === null) {
      return false;
    }
    try {
      this.grab = Main.pushModal(grabActor) as Clutter.Grab;
    } catch (e) {
      console.warn(`[Zatto] GnomeModalGrab: pushModal failed: ${e}`);
      this.grab = null;
      return false;
    }
    this.capturedActor = grabActor;
    this.capturedEventId = grabActor.connect('captured-event', (_actor, event) => {
      if (
        event.type() === Clutter.EventType.KEY_PRESS &&
        event.get_key_symbol() === Clutter.KEY_Escape
      ) {
        this.escHandler?.();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });
    return true;
  }

  release(): void {
    if (this.capturedActor !== null && this.capturedEventId !== null) {
      this.capturedActor.disconnect(this.capturedEventId);
      this.capturedEventId = null;
      this.capturedActor = null;
    }
    if (this.grab !== null) {
      try {
        Main.popModal(this.grab);
      } catch (e) {
        console.warn(`[Zatto] GnomeModalGrab: popModal failed: ${e}`);
      }
      this.grab = null;
    }
  }

  isHeld(): boolean {
    return this.grab !== null;
  }
}

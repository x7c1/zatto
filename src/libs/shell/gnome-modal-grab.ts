/**
 * GNOME Shell production implementation of {@link ModalGrabPort}.
 *
 * Wraps `Main.pushModal` / `Main.popModal` and the `captured-event` handler
 * that watches input while the grab is held. Keeping these together —
 * rather than splitting them across separate ports — matches reality: the
 * handler is connected at `acquire()` time and torn down at `release()`
 * time. Splitting them would force the controller to coordinate lifetimes
 * by hand for no gain.
 *
 * Like the Activities Overview (`Overview._show()`), the grab is taken on
 * `global.stage`, not on the overlay actor. A Clutter grab routes events
 * that land outside the grab actor's subtree to the grab actor itself, so a
 * grab on the overlay would swallow every click on the top bar and the
 * dock; a stage grab leaves them working. The default action mode
 * (`Shell.ActionMode.NONE`) keeps Shell keybindings inactive meanwhile.
 *
 * The overlay actor is supplied lazily via the `getOverlayActor` callback so
 * this class does not have to know how the overlay is mounted; it is used
 * only to tell presses and scrolls inside the overlay from those outside it.
 *
 * A vertical scroll over the overlay is turned into scroll steps and
 * consumed, so it does not reach anything beneath; a scroll outside it
 * (top bar, dock) propagates untouched. Wheel notches arrive as `UP` /
 * `DOWN` events and touchpad (or high-resolution wheel) motion as
 * `SMOOTH` events, which a {@link ScrollStepper} quantises into steps;
 * when a touchpad gesture ends (the event carries scroll finish flags),
 * the stepper drops its remainder.
 * Mutter emulates the one kind from the other, so, like gnome-shell's own
 * scroll handlers, events flagged as pointer-emulated are ignored (but
 * still consumed) to avoid counting one notch twice.
 *
 * Every pointer motion while the grab is held is reported, in stage
 * coordinates, wherever it happens (the top bar and the dock included),
 * and propagates untouched.
 */

import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type { Point } from '../../ui/overlay/depth-cycle.js';
import type { ModalGrabPort, ScrollStep } from '../../ui/overlay/ports.js';
import { type ScrollStepDirection, ScrollStepper } from './scroll-stepper.js';

export class GnomeModalGrab implements ModalGrabPort {
  private grab: Clutter.Grab | null = null;
  private capturedEventId: number | null = null;
  private escHandler: (() => void) | null = null;
  private outsidePressHandler: (() => void) | null = null;
  private scrollHandler: ((scroll: ScrollStep) => void) | null = null;
  private motionHandler: ((point: Point) => void) | null = null;
  private readonly scrollStepper = new ScrollStepper();

  constructor(private readonly getOverlayActor: () => Clutter.Actor | null) {}

  onEsc(handler: () => void): void {
    this.escHandler = handler;
  }

  onOutsidePress(handler: () => void): void {
    this.outsidePressHandler = handler;
  }

  onScroll(handler: (scroll: ScrollStep) => void): void {
    this.scrollHandler = handler;
  }

  onMotion(handler: (point: Point) => void): void {
    this.motionHandler = handler;
  }

  acquire(): boolean {
    if (this.grab !== null) {
      return true;
    }
    this.scrollStepper.reset();
    try {
      this.grab = Main.pushModal(global.stage) as Clutter.Grab;
    } catch (e) {
      console.warn(`[Zatto] GnomeModalGrab: pushModal failed: ${e}`);
      this.grab = null;
      return false;
    }
    this.capturedEventId = global.stage.connect('captured-event', (_actor, event) =>
      this.onCapturedEvent(event)
    );
    return true;
  }

  release(): void {
    if (this.capturedEventId !== null) {
      global.stage.disconnect(this.capturedEventId);
      this.capturedEventId = null;
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

  private onCapturedEvent(event: Clutter.Event): boolean {
    const type = event.type();
    if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
      this.escHandler?.();
      return Clutter.EVENT_STOP;
    }
    if (
      (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) &&
      !this.isInsideOverlay(event)
    ) {
      // Close the overlay, but let the press reach its target so a click
      // on the dock or the top bar does what it does on the desktop.
      this.outsidePressHandler?.();
    }
    if (type === Clutter.EventType.MOTION) {
      const [x, y] = event.get_coords();
      this.motionHandler?.({ x, y });
      return Clutter.EVENT_PROPAGATE;
    }
    if (type === Clutter.EventType.SCROLL && this.isInsideOverlay(event)) {
      this.onScrollEvent(event);
      return Clutter.EVENT_STOP;
    }
    return Clutter.EVENT_PROPAGATE;
  }

  /** Turn a scroll over the overlay into zero or more scroll steps. */
  private onScrollEvent(event: Clutter.Event): void {
    if (event.is_pointer_emulated()) {
      return;
    }
    let steps: ScrollStepDirection[];
    switch (event.get_scroll_direction()) {
      case Clutter.ScrollDirection.UP:
        steps = ['up'];
        break;
      case Clutter.ScrollDirection.DOWN:
        steps = ['down'];
        break;
      case Clutter.ScrollDirection.SMOOTH: {
        const [, dy] = event.get_scroll_delta();
        steps = this.scrollStepper.push(dy);
        if (event.get_scroll_finish_flags() !== Clutter.ScrollFinishFlags.NONE) {
          this.scrollStepper.finish();
        }
        break;
      }
      default:
        // LEFT / RIGHT: horizontal scrolling does not cycle.
        return;
    }
    const [x, y] = event.get_coords();
    for (const direction of steps) {
      this.scrollHandler?.({ x, y, direction });
    }
  }

  private isInsideOverlay(event: Clutter.Event): boolean {
    const overlay = this.getOverlayActor();
    const target = global.stage.get_event_actor(event);
    if (overlay === null || target === null) {
      return false;
    }
    return overlay.contains(target);
  }
}

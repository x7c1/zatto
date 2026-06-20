/**
 * Small interfaces that {@link OverlayController} uses to talk to its
 * GNOME-Shell collaborators.
 *
 * These ports exist so the controller (FSM glue) can run under vitest with
 * fake implementations, without dragging in GJS / Clutter / St / `Main`. They
 * deliberately model only what the controller touches today — there is no
 * ambition here to abstract the whole Shell. Keep the seam palm-sized; if a
 * new bit of Shell API is needed, prefer extending the relevant port over
 * inventing a generic "ShellPort".
 *
 * Production implementations live next to their concrete actors / wrappers:
 *
 * - {@link HotCornerPort}  -> `HotCornerTrigger` (`hot-corner-trigger.ts`)
 * - {@link OverlayActorPort} -> `OverlayActor` (`overlay-actor.ts`)
 * - {@link ModalGrabPort} -> `GnomeModalGrab` (`libs/shell/gnome-modal-grab.ts`)
 */

/**
 * Bottom-left hot corner. Fires {@link HotCornerPort.onEnter} every time the
 * cursor enters the trigger zone; the controller is responsible for debouncing
 * via its FSM.
 */
export interface HotCornerPort {
  /** Install the trigger actor and start listening. */
  enable(): void;
  /** Remove the trigger actor. Must be idempotent. */
  disable(): void;
  /**
   * Register the single enter handler. The port supports exactly one handler
   * at a time; the most recent registration wins. Set before calling
   * {@link enable}.
   */
  onEnter(handler: () => void): void;
}

/**
 * The visible overlay surface (dimmer + centered card for the PoC).
 *
 * The controller does not care about the actor's internal hierarchy; it only
 * needs to mount it, toggle its visibility, and tear it down.
 */
export interface OverlayActorPort {
  /** Mount the actor into the Shell chrome (hidden until {@link show}). */
  mount(): void;
  /** Make the mounted actor visible. No-op if not mounted. */
  show(): void;
  /** Hide the actor. No-op if not mounted. */
  hide(): void;
  /** Whether the actor is currently visible to the user. */
  isVisible(): boolean;
  /** Unmount and free resources. Must be idempotent. */
  destroy(): void;
}

/**
 * Wraps the modal input grab plus the Esc key binding into a single port,
 * since in production they share the same grab actor and are acquired /
 * released as a unit.
 *
 * `onEsc` must be registered before {@link acquire}; the handler is invoked
 * whenever the user presses Escape while the grab is held. The handler is
 * cleared on {@link release}.
 */
export interface ModalGrabPort {
  /**
   * Register the Esc handler. The port supports exactly one handler at a
   * time. Setting `null` (or re-registering before the next {@link acquire})
   * clears it.
   */
  onEsc(handler: () => void): void;
  /**
   * Acquire the modal grab. Returns whether the grab is now held — a `false`
   * return means the controller should treat the open as having failed and
   * roll the FSM back.
   */
  acquire(): boolean;
  /** Release the modal grab. Must be safe to call when no grab is held. */
  release(): void;
  /** Whether a grab is currently held. */
  isHeld(): boolean;
}

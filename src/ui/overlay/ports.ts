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
 * - {@link WindowMirrorPort} -> `GnomeWindowMirror` (`gnome-window-mirror.ts`)
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
 *
 * The actor also owns an in-overlay corner sensor — a small reactive child of
 * the dimmer covering the same rect as {@link HotCornerPort}. While the modal
 * grab is held, Clutter routes pointer events only to the grab actor and its
 * descendants, so the chrome-level hot corner stops firing. The in-overlay
 * sensor exists purely to restore the "re-enter the hot corner to dismiss"
 * gesture in that state, via {@link onCornerReenter}.
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
  /**
   * Register the single re-entry handler fired when the cursor enters the
   * in-overlay corner sensor (i.e. while the modal grab is held). The port
   * supports exactly one handler at a time; the most recent registration
   * wins. Set before calling {@link mount}.
   */
  onCornerReenter(handler: () => void): void;
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

/**
 * Per-zone breakdown of mounted clones. Keys match the four quadrant
 * identifiers exported by `zone-layout.ts`; each value is the count of
 * clones currently mounted in that zone (zero if the zone is empty).
 *
 * Kept here (not imported from `zone-layout.ts`) so the port surface stays
 * self-describing and the Inspect endpoint contract does not transitively
 * pull in layout-side types.
 */
export interface WindowMirrorByZone {
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomLeft: number;
  readonly bottomRight: number;
}

/**
 * Read-only snapshot of the window-mirror state exposed through the D-Bus
 * Inspect endpoint. Kept tiny on purpose — every field has to earn its keep
 * — so external tooling has a stable contract to depend on.
 */
export interface WindowMirrorSnapshot {
  /** How many live clones are currently mounted across all zones. */
  readonly clonedCount: number;
  /** Per-zone clone counts. Sum of the values equals {@link clonedCount}. */
  readonly byZone: WindowMirrorByZone;
  /**
   * Epoch ms of the most recent time the mirrored window was activated via a
   * clone click, or `null` if no activation has happened yet.
   */
  readonly lastActivatedAt: number | null;
}

/**
 * Mirrors one or more open windows into the overlay as live `Clutter.Clone`
 * thumbnails and routes a click on a clone back into a window activation
 * (`MetaWindow.activate`).
 *
 * For PoC step 4 the production implementation mirrors every eligible
 * top-level window, routes each into one of four quadrant zones by
 * `wm_class`, and auto-grids same-zone windows inside the zone rect. The
 * {@link mount} return value still reflects whether *any* clone was
 * attached, so the controller can keep the dimmer open even when no
 * windows qualify. The port surface (`mount` / `unmount` / `snapshot`) is
 * unchanged from step 3 — zone routing is an implementation detail.
 */
export interface WindowMirrorPort {
  /**
   * Mount the live clones into the overlay's clone container. Returns `true`
   * if at least one clone was attached, `false` if no eligible window was
   * available (the overlay should still open so the user sees the dim plate
   * and can dismiss).
   *
   * `onActivated` is invoked from the clone's click handler after the
   * mirrored window has been raised; the controller should use it to close
   * the overlay. The port supports exactly one handler per `mount()` call.
   */
  mount(onActivated: () => void): boolean;
  /** Unmount any clones currently attached. Must be idempotent. */
  unmount(): void;
  /** Cheap state snapshot for the D-Bus Inspect endpoint. */
  snapshot(): WindowMirrorSnapshot;
}

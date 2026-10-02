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
 * - {@link RealWindowsPort} -> `GnomeRealWindows` (`gnome-real-windows.ts`)
 */

/**
 * Bottom-left hot corner. Fires {@link HotCornerPort.onEnter} every time the
 * cursor enters the corner rect; the controller is responsible for debouncing
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
 * The visible overlay surface (a work-area dimmer hosting the window
 * clones).
 *
 * The controller does not care about the actor's internal hierarchy; it only
 * needs to mount it, toggle its visibility, and tear it down. {@link show}
 * and {@link hide} may fade the dim shade; {@link isVisible} reports the
 * intent (`true` from `show()` until `hide()`), not the fade progress.
 */
export interface OverlayActorPort {
  /** Mount the actor into the Shell chrome (hidden until {@link show}). */
  mount(): void;
  /** Make the mounted actor visible. No-op if not mounted. */
  show(): void;
  /** Hide the actor. No-op if not mounted. */
  hide(): void;
  /** Whether the overlay is meant to be visible (set by `show()`, cleared by `hide()`). */
  isVisible(): boolean;
  /** Unmount and free resources. Must be idempotent. */
  destroy(): void;
}

/**
 * Wraps the modal input grab plus the input it watches while held (Esc and
 * presses outside the overlay) into a single port, since in production they
 * share the same grab and are acquired / released as a unit.
 *
 * Handlers must be registered before {@link acquire}; they are invoked only
 * while the grab is held.
 */
export interface ModalGrabPort {
  /**
   * Register the Esc handler. The port supports exactly one handler at a
   * time; the most recent registration wins.
   */
  onEsc(handler: () => void): void;
  /**
   * Register the outside-press handler, invoked when a button press or touch
   * begins outside the overlay (e.g. on the top bar or the dock) while the
   * grab is held. The press still reaches its target. The port supports
   * exactly one handler at a time; the most recent registration wins.
   */
  onOutsidePress(handler: () => void): void;
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
 * Read-only snapshot of the window-mirror state exposed through the D-Bus
 * Inspect endpoint. Kept tiny on purpose — every field has to earn its keep
 * — so external tooling has a stable contract to depend on.
 */
export interface WindowMirrorSnapshot {
  /** How many live clones are currently mounted. */
  readonly clonedCount: number;
  /**
   * Epoch ms of the most recent time the mirrored window was activated via a
   * clone click, or `null` if no activation has happened yet.
   */
  readonly lastActivatedAt: number | null;
}

/** Options for {@link WindowMirrorPort.unmount}. */
export interface UnmountOptions {
  /**
   * Tear the clones down synchronously instead of easing them back onto
   * their windows. Used when the actor tree is about to be destroyed.
   */
  readonly immediate?: boolean;
  /**
   * Called exactly once when the clones are gone: after the close ease
   * lands, or before `unmount()` returns on the immediate path.
   */
  readonly onDone?: () => void;
}

/**
 * Mirrors the open windows into the overlay as live `Clutter.Clone` actors
 * and routes a click on a clone back into a window activation
 * (`MetaWindow.activate`).
 *
 * The production implementation creates every clone at its window's
 * on-screen position and eases it into the depth view on {@link mount},
 * and eases it back onto the window on {@link unmount}. The {@link mount}
 * return value reflects whether *any* clone was attached, so the controller
 * can keep the dimmer open even when no windows qualify.
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
  /**
   * Remove the clones currently attached. Without `immediate`, cancels any
   * ease in flight, eases the clones back onto their windows from wherever
   * they are, and tears them down when the ease lands. With `immediate`, or
   * when animations are disabled, tears down synchronously. Either way
   * `onDone` is called exactly once; an animated close still in flight when
   * a later call tears the clones down immediately has its `onDone` called
   * by that teardown. Must be idempotent.
   */
  unmount(options?: UnmountOptions): void;
  /** Cheap state snapshot for the D-Bus Inspect endpoint. */
  snapshot(): WindowMirrorSnapshot;
}

/**
 * Read-only snapshot of the real-windows state exposed through the D-Bus
 * Inspect endpoint.
 */
export interface RealWindowsSnapshot {
  /** Whether the port last hid the real windows (intent, not live Clutter state). */
  readonly hidden: boolean;
  /** Epoch ms of the most recent {@link RealWindowsPort.restore}, or `null` if never. */
  readonly lastRestoredAt: number | null;
}

/**
 * Hides and shows the real window actors while the overlay is open, so the
 * clones replace the windows instead of being painted over them.
 *
 * Safety contract: {@link restore} is synchronous, idempotent and always
 * safe to call. The controller calls it first on `enable()` (a previous
 * instance may have died with the desktop hidden), first on `disable()`,
 * and when opening throws after {@link hide}.
 */
export interface RealWindowsPort {
  /** Hide the real windows synchronously, with no fade. */
  hide(): void;
  /** Show the real windows synchronously, with no fade. */
  show(): void;
  /** Cancel any transition and force the real windows visible and opaque. */
  restore(): void;
  /** Cheap state snapshot for the D-Bus Inspect endpoint. */
  snapshot(): RealWindowsSnapshot;
}

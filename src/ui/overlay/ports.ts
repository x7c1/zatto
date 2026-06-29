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

import type { ZoneConfig } from './zone-config.js';

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
 * Per-zone breakdown of mounted clones. Keys are zone identifiers
 * (whatever the active {@link ZoneConfig} defines — four quadrants by
 * default, but loader-provided configs may add or replace them); each
 * value is the count of clones currently mounted in that zone (zero if
 * the zone is empty).
 *
 * Kept as a plain string-keyed record so the port surface stays
 * self-describing and the Inspect endpoint contract does not bake in
 * the production zone set. Consumers that need stable key order should
 * iterate over `zoneConfig.zones` from the same snapshot.
 */
export type WindowMirrorByZone = Readonly<Record<string, number>>;

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
  /**
   * The {@link ZoneConfig} the mirror is currently using to lay out
   * clones. Optional only so test fakes can omit it; the production
   * `GnomeWindowMirror` always populates this field. Echoing the live
   * config in the Inspect snapshot lets external tooling (and the
   * human running `gdbus`) verify which routing table and which zone
   * rectangles are in effect without poking at the extension source.
   */
  readonly zoneConfig?: ZoneConfig;
}

/**
 * Read-only snapshot of the {@link RealWindowsVisibilityPort} state
 * exposed through the D-Bus Inspect endpoint. Tiny on purpose so the
 * external contract is cheap to depend on.
 */
export interface RealWindowsVisibilitySnapshot {
  /**
   * Whether the port currently *intends* the user's real desktop windows
   * to be hidden. `true` between a successful {@link RealWindowsVisibilityPort.hide}
   * and the next {@link RealWindowsVisibilityPort.show} or
   * {@link RealWindowsVisibilityPort.restore}; `false` otherwise.
   *
   * This reflects intent rather than the live Clutter state because the
   * actual `visible` / `opacity` values on `global.window_group` may be
   * mid-transition.
   */
  readonly hidden: boolean;
  /**
   * Epoch ms of the most recent {@link RealWindowsVisibilityPort.restore}
   * call, or `null` if `restore` has not run yet. Useful for confirming
   * the defensive restore on `enable()` actually fired after a crash /
   * reload cycle.
   */
  readonly lastRestoredAt: number | null;
}

/**
 * Hides the user's real desktop windows while the overlay is open so the
 * live `Clutter.Clone` thumbnails are not visually mixed with the original
 * windows they mirror. The production implementation toggles
 * `global.window_group` only (NOT `top_window_group`, which contains
 * shell-managed surfaces the shell coordinates on its own schedule — see
 * `GnomeRealWindowsVisibility` for the full rationale). This is
 * documented-safe with `Clutter.Clone` because clones keep painting their
 * hidden sources.
 *
 * Safety contract — every implementation MUST honor this:
 *
 * - {@link restore} is synchronous, idempotent, and always safe to call,
 *   even when `config.hideRealWindows` is `false`. It is the desktop's
 *   last line of defense against being left invisible after a crash, an
 *   exception during open, or an extension reload.
 * - {@link hide} and {@link show} are no-ops when `config.hideRealWindows`
 *   is `false`. Only {@link restore} bypasses the kill switch.
 * - Every write to `visible` / `opacity` is preceded by
 *   `remove_all_transitions()` on the window group, so a stale in-flight
 *   ease cannot resurrect a hidden state we just restored.
 */
export interface RealWindowsVisibilityPort {
  /** Fade out (or snap) `window_group`. */
  hide(): void;
  /** Fade in (or snap back) `window_group`. */
  show(): void;
  /**
   * Synchronously force the desktop visible regardless of the kill
   * switch. Cancels any in-flight transitions and resets
   * `visible = true; opacity = 255` on the window group. Idempotent.
   */
  restore(): void;
  /** Cheap state snapshot for the D-Bus Inspect endpoint. */
  snapshot(): RealWindowsVisibilitySnapshot;
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
  /**
   * Unmount any clones currently attached. Must be idempotent.
   *
   * When `options.immediate` is `true`, implementations must tear the
   * clones down synchronously without playing the unmount ease, even
   * when easing is otherwise enabled. The controller uses this on the
   * `disable()` path where the actor tree is about to be destroyed —
   * easing children of a doomed parent wastes work and risks
   * fired-after-destroy callbacks. Normal close paths (corner re-enter,
   * Esc, clone click) pass no options and get the animated teardown.
   */
  unmount(options?: { readonly immediate?: boolean }): void;
  /** Cheap state snapshot for the D-Bus Inspect endpoint. */
  snapshot(): WindowMirrorSnapshot;
}

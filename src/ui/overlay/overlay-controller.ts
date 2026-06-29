/**
 * Glue layer: connects the pure {@link OverlayStateMachine} to its
 * collaborators (hot corner, overlay actor, modal grab, window mirror)
 * through small interfaces.
 *
 * The controller deliberately depends only on the {@link HotCornerPort},
 * {@link OverlayActorPort}, {@link ModalGrabPort}, and
 * {@link WindowMirrorPort} abstractions — never on `Main` / `Clutter` / `St`
 * / `gi:` directly. This is the seam that lets vitest exercise the full
 * toggle / Esc / debounce / live-clone wiring without booting a real GNOME
 * Shell. Production wiring lives in `extension.ts`, which instantiates the
 * real `HotCornerTrigger`, `OverlayActor`, `GnomeModalGrab`, and
 * `GnomeWindowMirror` and hands them in here.
 */

import { type OverlayState, OverlayStateMachine } from './overlay-state-machine.js';
import type {
  HotCornerPort,
  ModalGrabPort,
  OverlayActorPort,
  RealWindowsVisibilityPort,
  RealWindowsVisibilitySnapshot,
  WindowMirrorPort,
  WindowMirrorSnapshot,
} from './ports.js';

/**
 * Debounce window for hot-corner re-entry. 250 ms is short enough to feel
 * responsive (a deliberate second hover is well above this) and long enough
 * to absorb cursor jitter at the corner.
 */
const HOTCORNER_DEBOUNCE_MS = 250;

/**
 * Read-only snapshot of the controller surfaced via the D-Bus Inspect
 * endpoint. Kept intentionally small — every field has to earn its keep — so
 * external tooling has a stable, cheap contract to depend on.
 */
export interface OverlayControllerSnapshot {
  overlay: {
    state: OverlayState;
    visible: boolean;
  };
  hotCorner: {
    /** Epoch ms of the most recent hot-corner enter, or `null` if none yet. */
    lastEnterAt: number | null;
  };
  windowMirror: WindowMirrorSnapshot;
  realWindows: RealWindowsVisibilitySnapshot;
}

/** Source of a wall-clock epoch-ms timestamp. Injected so tests stay deterministic. */
export type EpochClock = () => number;

export interface OverlayControllerOptions {
  /**
   * Monotonic clock in ms used by the FSM for debounce calculations. Required
   * because no portable default exists across the GJS runtime and vitest:
   * production passes `GLib.get_monotonic_time() / 1000`, tests pass a
   * controllable counter.
   */
  readonly now: () => number;
  /**
   * Wall-clock source for the snapshot's `lastEnterAt`. Defaults to
   * `Date.now`. Separate from `now` because the FSM only needs monotonic
   * durations while the snapshot wants a comparable wall time.
   */
  readonly epochNow?: EpochClock;
  /** Override the default 250 ms debounce window. Primarily for tests. */
  readonly debounceMs?: number;
}

export class OverlayController {
  private readonly fsm: OverlayStateMachine;
  private readonly epochNow: EpochClock;
  private unsubscribeFsm: (() => void) | null = null;
  private lastEnterAt: number | null = null;

  constructor(
    private readonly hotCorner: HotCornerPort,
    private readonly actor: OverlayActorPort,
    private readonly modalGrab: ModalGrabPort,
    private readonly windowMirror: WindowMirrorPort,
    private readonly realWindows: RealWindowsVisibilityPort,
    options: OverlayControllerOptions
  ) {
    const debounceMs = options.debounceMs ?? HOTCORNER_DEBOUNCE_MS;
    this.epochNow = options.epochNow ?? (() => Date.now());
    this.fsm = new OverlayStateMachine({ debounceMs, now: options.now });
  }

  enable(): void {
    // Defensive: if a previous instance died with the desktop hidden
    // (extension crash, hard reload, prior open() that threw past the
    // catch), the user is staring at a black screen. Restore is
    // idempotent and cheap, so always run it as the very first action
    // before any other wiring — even ahead of subscribing FSM events.
    this.realWindows.restore();

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

    this.modalGrab.onEsc(() => this.fsm.dismiss());
    this.hotCorner.onEnter(() => {
      this.lastEnterAt = this.epochNow();
      this.fsm.toggle();
    });
    // The in-overlay corner sensor relays the "re-enter the hot corner while
    // open" gesture that the chrome-level `HotCornerTrigger` can no longer
    // observe under the modal grab. The FSM's debounce + state guard provide
    // the same jitter protection as the primary hot-corner path.
    this.actor.onCornerReenter(() => this.fsm.toggle());

    this.actor.mount();
    this.hotCorner.enable();
  }

  disable(): void {
    // Restore the user's real desktop windows FIRST and synchronously,
    // before touching anything else. If a later step in this teardown
    // throws (or the extension is being disabled while open) the
    // desktop must already be visible — leaving it hidden would
    // present the user with a blank screen they cannot recover from
    // without restarting the shell.
    this.realWindows.restore();
    this.hotCorner.disable();
    this.modalGrab.release();
    // Unmount any live clones BEFORE destroying the actor so the clone
    // children get a chance to disconnect their click handlers cleanly
    // instead of being torn down implicitly with the parent dimmer.
    // Force the synchronous path because the actor tree is about to be
    // destroyed — easing children of a doomed parent wastes work and
    // risks fired-after-destroy `onComplete` callbacks. Normal close
    // paths (corner re-enter, Esc, clone click) keep the animated
    // default by passing no options.
    this.windowMirror.unmount({ immediate: true });
    this.actor.destroy();

    if (this.unsubscribeFsm !== null) {
      this.unsubscribeFsm();
      this.unsubscribeFsm = null;
    }
    this.fsm.reset();
  }

  /**
   * Read-only state snapshot for the D-Bus Inspect endpoint and any other
   * external observers. Cheap to call; allocates a fresh plain object so the
   * caller can serialize it without worrying about aliasing.
   */
  snapshot(): OverlayControllerSnapshot {
    return {
      overlay: {
        state: this.fsm.getState(),
        visible: this.actor.isVisible(),
      },
      hotCorner: {
        lastEnterAt: this.lastEnterAt,
      },
      windowMirror: this.windowMirror.snapshot(),
      realWindows: this.realWindows.snapshot(),
    };
  }

  private handleOpen(): void {
    this.actor.show();
    // Hide the user's real windows immediately after the dimmer
    // appears so the live clones we're about to mount don't visually
    // mix with their sources. The kill switch (config.hideRealWindows)
    // lives inside the port — calling `hide()` with the switch off is
    // a no-op, not an error.
    this.realWindows.hide();
    // Wrap the post-hide section in a try so any exception during open
    // (grab failure, mirror crash, FSM bug) is bounced through the
    // restore() call site that guarantees the desktop comes back. The
    // exception is re-thrown so the caller still observes the failure
    // — we are widening the safety net, not swallowing bugs.
    try {
      // The grab return value is intentionally not checked: a failed
      // `pushModal` is logged by the port and the overlay still remains
      // visually open (matching the pre-port behavior). Esc will not work in
      // that degenerate case, but the user can dismiss via the hot corner.
      this.modalGrab.acquire();
      // Mount the live clones after the grab is held so the clones inherit
      // the same input-routing context the user will be clicking through. A
      // `false` return (no eligible window) is not an error: the overlay
      // stays open with just the dimmer and the user dismisses via the
      // corner or Esc — the PoC value is "did the API even fire", not "did
      // we always find something to show".
      this.windowMirror.mount(() => this.fsm.dismiss());
      this.fsm.commitOpened();
    } catch (err) {
      this.realWindows.restore();
      throw err;
    }
  }

  private handleClose(): void {
    // Bring the real windows back BEFORE hiding the dimmer so the
    // cross-dissolve direction matches the open path — real windows
    // fade in as the clone container fades out, instead of snapping
    // back on top of an empty screen.
    this.realWindows.show();
    this.modalGrab.release();
    this.windowMirror.unmount();
    this.actor.hide();
    this.fsm.commitClosed();
  }
}

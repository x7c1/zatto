/**
 * Glue layer: connects the pure {@link OverlayStateMachine} to its
 * collaborators (hot corner, overlay actor, modal grab, window mirror,
 * real windows) through small interfaces.
 *
 * The controller deliberately depends only on the {@link HotCornerPort},
 * {@link OverlayActorPort}, {@link ModalGrabPort}, {@link WindowMirrorPort},
 * and {@link RealWindowsPort} abstractions — never on `Main` / `Clutter` /
 * `St` / `gi:` directly. This is the seam that lets vitest exercise the
 * full toggle / Esc / debounce / live-clone wiring without booting a real
 * GNOME Shell. Production wiring lives in `extension.ts`, which
 * instantiates the real `HotCornerTrigger`, `OverlayActor`,
 * `GnomeModalGrab`, `GnomeWindowMirror`, and `GnomeRealWindows` and hands
 * them in here.
 *
 * Transitions: opening mounts the clones on the windows' rects, hides the
 * real windows in the same call stack (so no frame shows both), and
 * commits `opened` at once while the clones ease into the depth view.
 * Closing eases the clones back and stays in `closing` until they land;
 * only then are the real windows shown and `closed` committed.
 *
 * While `open`, each scroll step over the overlay moves the focus through
 * the windows under the cursor (`down` one window deeper, `up` one window
 * nearer); steps in any other state are dropped.
 */

import { type OverlayState, OverlayStateMachine } from './overlay-state-machine.js';
import type {
  HotCornerPort,
  ModalGrabPort,
  OverlayActorPort,
  RealWindowsPort,
  RealWindowsSnapshot,
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
  realWindows: RealWindowsSnapshot;
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
    private readonly realWindows: RealWindowsPort,
    options: OverlayControllerOptions
  ) {
    const debounceMs = options.debounceMs ?? HOTCORNER_DEBOUNCE_MS;
    this.epochNow = options.epochNow ?? (() => Date.now());
    this.fsm = new OverlayStateMachine({ debounceMs, now: options.now });
  }

  enable(): void {
    // A previous instance may have died with the desktop hidden. Restore
    // is idempotent and cheap, so it always runs before any other wiring.
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
    // A press on the top bar or the dock closes the overlay and still
    // reaches its target, as in the Activities Overview.
    this.modalGrab.onOutsidePress(() => this.fsm.dismiss());
    // Cycling only makes sense once the open has committed: `opening` can
    // still fail and be torn down by abortOpen(), and while closing the
    // clones are on their way back onto the windows in the real order.
    // `open` starts while the clones are still easing into the depth view;
    // the mirror hit-tests against the layout they are easing to.
    this.modalGrab.onScroll(({ x, y, direction }) => {
      if (this.fsm.getState() !== 'open') {
        return;
      }
      this.windowMirror.cycleAt({ x, y }, direction === 'down' ? 'forward' : 'backward');
    });
    // The modal grab is on the stage, so the trigger keeps firing while the
    // overlay is open: one trigger both opens and closes it.
    this.hotCorner.onEnter(() => {
      this.lastEnterAt = this.epochNow();
      this.fsm.toggle();
    });

    this.actor.mount();
    this.hotCorner.enable();
  }

  disable(): void {
    // Bring the real windows back first, before any teardown step that
    // may throw: a desktop left hidden is unusable.
    this.realWindows.restore();
    this.hotCorner.disable();
    this.modalGrab.release();
    // Unmount any live clones BEFORE destroying the actor so the clone
    // children get a chance to disconnect their click handlers cleanly
    // instead of being torn down implicitly with the parent dimmer. The
    // immediate path also completes a close ease still in flight.
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
    // The grab return value is intentionally not checked: a failed
    // `pushModal` is logged by the port and the overlay still remains
    // visually open (matching the pre-port behavior). Esc and outside
    // presses will not work in that degenerate case, but the user can
    // dismiss via the hot corner.
    this.modalGrab.acquire();
    // Mount the live clones after the grab is held so the clones inherit
    // the same input-routing context the user will be clicking through. A
    // `false` return (no eligible window) is not an error: the overlay
    // stays open with just the dimmer and the user dismisses via the
    // corner or Esc — the PoC value is "did the API even fire", not "did
    // we always find something to show".
    this.windowMirror.mount(() => this.fsm.dismiss());
    // The clones now sit exactly on their windows, so hiding the sources
    // in this same call stack swaps one for the other with no frame of
    // double image. Anything that throws from here on must not leave the
    // desktop hidden: restore first, then tear down the rest of what the
    // open set up and return the FSM to `closed` (from `opening`, which
    // ignores every toggle, the overlay would otherwise be stuck), then
    // let the failure propagate.
    try {
      this.realWindows.hide();
      this.fsm.commitOpened();
    } catch (err) {
      this.realWindows.restore();
      this.modalGrab.release();
      this.windowMirror.unmount({ immediate: true });
      this.actor.hide();
      this.fsm.abortOpen();
      throw err;
    }
  }

  private handleClose(): void {
    this.modalGrab.release();
    this.actor.hide();
    // Stay in `closing` (which ignores toggles) until the clones have
    // eased back onto the windows; show the real windows the moment they
    // land, under clones that cover them exactly.
    this.windowMirror.unmount({
      onDone: () => {
        this.realWindows.show();
        this.fsm.commitClosed();
      },
    });
  }
}

/**
 * Glue layer: connects the pure {@link OverlayStateMachine} to its
 * collaborators (hot corner, overlay actor, modal grab) through small
 * interfaces.
 *
 * The controller deliberately depends only on the {@link HotCornerPort},
 * {@link OverlayActorPort}, and {@link ModalGrabPort} abstractions — never on
 * `Main` / `Clutter` / `St` / `gi:` directly. This is the seam that lets
 * vitest exercise the full toggle / Esc / debounce wiring without booting
 * a real GNOME Shell. Production wiring lives in `extension.ts`, which
 * instantiates the real `HotCornerTrigger`, `OverlayActor`, and
 * `GnomeModalGrab` and hands them in here.
 */

import { type OverlayState, OverlayStateMachine } from './overlay-state-machine.js';
import type { HotCornerPort, ModalGrabPort, OverlayActorPort } from './ports.js';

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
    options: OverlayControllerOptions
  ) {
    const debounceMs = options.debounceMs ?? HOTCORNER_DEBOUNCE_MS;
    this.epochNow = options.epochNow ?? (() => Date.now());
    this.fsm = new OverlayStateMachine({ debounceMs, now: options.now });
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
    this.hotCorner.disable();
    this.modalGrab.release();
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
    };
  }

  private handleOpen(): void {
    this.actor.show();
    // The grab return value is intentionally not checked: a failed
    // `pushModal` is logged by the port and the overlay still remains
    // visually open (matching the pre-port behavior). Esc will not work in
    // that degenerate case, but the user can dismiss via the hot corner.
    this.modalGrab.acquire();
    this.fsm.commitOpened();
  }

  private handleClose(): void {
    this.modalGrab.release();
    this.actor.hide();
    this.fsm.commitClosed();
  }
}

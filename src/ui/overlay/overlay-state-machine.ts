/**
 * Pure finite state machine for the hot-corner overlay toggle.
 *
 * Deliberately framework-free: no GJS, no Clutter, no GLib imports. The
 * GNOME-Shell-facing glue (hot corner actor, modal grab, key bindings) drives
 * this machine and reacts to its output events. Keeping the logic pure lets us
 * unit-test transitions under vitest without bootstrapping a real Shell.
 *
 * States
 * ------
 * - `closed`  — overlay hidden, no input grab.
 * - `opening` — toggle requested while `closed`; glue should mount/show the
 *               overlay and call `commitOpened()` when ready.
 * - `open`    — overlay visible and grabbing input (Esc or a press outside
 *               the overlay dismisses).
 * - `closing` — toggle/dismiss requested while `open`; glue should hide/unmount
 *               the overlay and call `commitClosed()` when ready.
 *
 * `opening` and `closing` are transient. While in either, further `toggle()`
 * calls are ignored until the glue commits. This is the debounce guarantee:
 * a single physical hover produces exactly one open/close, even if the cursor
 * jitters inside the trigger area.
 *
 * On top of the state-based debounce, a separate cooldown window swallows
 * `toggle()` calls that arrive within `debounceMs` of the last accepted
 * toggle, of the last `commitClosed()`, or of the last `abortOpen()`. The
 * first handles the cursor leaving the corner and re-entering quickly
 * enough that the user clearly meant one gesture. The others matter because
 * the overlay is torn down there (for a close, well after it was requested,
 * since the clones ease back first): tearing it down makes Clutter repick
 * and synthesize an `enter-event` on whatever is now under the pointer, and
 * if that is the hot corner, the synthesized toggle must not reopen the
 * overlay.
 */

export type OverlayState = 'closed' | 'opening' | 'open' | 'closing';

export type OverlayEvent =
  | { type: 'open-requested' }
  | { type: 'close-requested' }
  | { type: 'opened' }
  | { type: 'closed' };

export interface OverlayStateMachineOptions {
  /** Minimum elapsed time (ms) between two accepted `toggle()` calls. */
  readonly debounceMs: number;
  /** Monotonic clock in ms. Injected so tests can advance time deterministically. */
  readonly now: () => number;
}

/**
 * Toggle / Esc state machine. Emits high-level events for the glue to act on.
 */
export class OverlayStateMachine {
  private state: OverlayState = 'closed';
  private lastAcceptedToggleMs: number | null = null;
  private readonly listeners = new Set<(event: OverlayEvent) => void>();

  constructor(private readonly options: OverlayStateMachineOptions) {}

  /** Current state. Primarily for tests; glue should subscribe via `onEvent`. */
  getState(): OverlayState {
    return this.state;
  }

  /** Subscribe to events emitted by accepted transitions. Returns an unsubscribe fn. */
  onEvent(listener: (event: OverlayEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Request a toggle (typically from a hot-corner hover).
   *
   * Returns `true` if the call was accepted and a transition began, `false`
   * if it was ignored (transient state or within the debounce window).
   */
  toggle(): boolean {
    if (this.state === 'opening' || this.state === 'closing') {
      return false;
    }
    const nowMs = this.options.now();
    if (
      this.lastAcceptedToggleMs !== null &&
      nowMs - this.lastAcceptedToggleMs < this.options.debounceMs
    ) {
      return false;
    }
    this.lastAcceptedToggleMs = nowMs;

    if (this.state === 'closed') {
      this.state = 'opening';
      this.emit({ type: 'open-requested' });
      return true;
    }
    // state === 'open'
    this.state = 'closing';
    this.emit({ type: 'close-requested' });
    return true;
  }

  /**
   * Request a dismiss (from Esc or a press outside the overlay). Only
   * meaningful when the overlay is `open` — ignored otherwise. Returns whether
   * it was accepted.
   *
   * Dismiss is intentionally NOT subject to the debounce window: a key press
   * or a click always reflects an explicit intent, never a stray cursor
   * jitter.
   */
  dismiss(): boolean {
    if (this.state !== 'open') {
      return false;
    }
    this.state = 'closing';
    this.emit({ type: 'close-requested' });
    return true;
  }

  /**
   * Glue notifies the machine that the open animation/mount completed.
   * No-op unless we are in `opening`.
   */
  commitOpened(): void {
    if (this.state !== 'opening') {
      return;
    }
    this.state = 'open';
    this.emit({ type: 'opened' });
  }

  /**
   * Glue notifies the machine that the close animation/unmount completed.
   * No-op unless we are in `closing`. Restarts the debounce window, so a
   * toggle synthesized by the teardown itself cannot reopen the overlay.
   */
  commitClosed(): void {
    if (this.state !== 'closing') {
      return;
    }
    this.lastAcceptedToggleMs = this.options.now();
    this.state = 'closed';
    this.emit({ type: 'closed' });
  }

  /**
   * Glue notifies the machine that opening failed and it has already torn
   * down what it set up. Returns `opening` to `closed` without emitting an
   * event and restarts the debounce window, so a toggle synthesized by the
   * teardown cannot reopen the overlay. No-op unless we are in `opening`.
   */
  abortOpen(): void {
    if (this.state !== 'opening') {
      return;
    }
    this.lastAcceptedToggleMs = this.options.now();
    this.state = 'closed';
  }

  /** Force-reset to `closed`. Used on extension teardown. */
  reset(): void {
    this.state = 'closed';
    this.lastAcceptedToggleMs = null;
  }

  private emit(event: OverlayEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

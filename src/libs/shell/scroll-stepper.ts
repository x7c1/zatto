/**
 * Turns smooth scroll deltas into whole scroll steps.
 *
 * A touchpad (and, on Wayland, a high-resolution wheel) reports scrolling
 * as `Clutter.ScrollDirection.SMOOTH` events whose vertical delta is a
 * fraction of a wheel notch. The stepper accumulates those deltas and
 * emits one step per whole unit, so a touchpad swipe steps at about the
 * pace of a wheel. Turning the other way drops whatever was left over
 * from the previous direction, so a reversal is never eaten by the
 * remainder of the scroll before it. The end of a touchpad gesture (the
 * fingers leaving the pad) drops the remainder too, so a fraction left
 * over from one swipe cannot turn the first touch of the next one into a
 * step.
 *
 * No `gi://` imports: this module is unit-tested under vitest.
 */

/** Direction of one scroll step, as on a wheel: `down` moves the content up. */
export type ScrollStepDirection = 'up' | 'down';

export class ScrollStepper {
  private remainder = 0;

  /**
   * Feed one smooth vertical delta (positive is down) and return the
   * whole steps it completes, oldest first. Usually empty or a single
   * step; a fast swipe can complete several at once.
   */
  push(dy: number): ScrollStepDirection[] {
    if (!Number.isFinite(dy) || dy === 0) {
      return [];
    }
    if (this.remainder !== 0 && Math.sign(this.remainder) !== Math.sign(dy)) {
      this.remainder = 0;
    }
    this.remainder += dy;
    const whole = Math.trunc(this.remainder);
    this.remainder -= whole;
    const direction: ScrollStepDirection = whole > 0 ? 'down' : 'up';
    return Array.from({ length: Math.abs(whole) }, () => direction);
  }

  /**
   * The gesture the deltas belonged to has finished (the event carried
   * scroll finish flags). Call after pushing that event's delta: whatever
   * fraction it left over is dropped.
   */
  finish(): void {
    this.reset();
  }

  /** Drop any partial step, e.g. when a new grab begins. */
  reset(): void {
    this.remainder = 0;
  }
}

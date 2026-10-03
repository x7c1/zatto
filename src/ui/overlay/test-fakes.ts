/**
 * Test doubles for the overlay ports.
 *
 * These fakes are the entire reason the ports exist: they let `OverlayController`
 * be exercised end-to-end under vitest without bootstrapping GNOME Shell. Each
 * fake records the lifecycle calls the controller makes on it so tests can
 * assert "we called `acquire` then later `release`" rather than checking
 * implementation details.
 */

import type { CycleDirection, Point } from './depth-cycle.js';
import type {
  HotCornerPort,
  ModalGrabPort,
  OverlayActorPort,
  RealWindowsPort,
  RealWindowsSnapshot,
  ScrollStep,
  UnmountOptions,
  WindowMirrorPort,
  WindowMirrorSnapshot,
} from './ports.js';

export class FakeHotCorner implements HotCornerPort {
  enabled = false;
  private handler: (() => void) | null = null;

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  onEnter(handler: () => void): void {
    this.handler = handler;
  }

  /** Test helper: simulate a hover into the trigger area. */
  fireEnter(): void {
    this.handler?.();
  }
}

export class FakeOverlayActor implements OverlayActorPort {
  mounted = false;
  destroyed = false;
  private visible = false;

  mount(): void {
    this.mounted = true;
  }

  show(): void {
    if (!this.mounted) {
      return;
    }
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.mounted = false;
    this.destroyed = true;
    this.visible = false;
  }
}

export class FakeModalGrab implements ModalGrabPort {
  acquireCount = 0;
  releaseCount = 0;
  /** Toggle to make `acquire()` return false (simulating a `pushModal` failure). */
  acquireShouldFail = false;
  private held = false;
  private escHandler: (() => void) | null = null;
  private outsidePressHandler: (() => void) | null = null;
  private scrollHandler: ((scroll: ScrollStep) => void) | null = null;
  private motionHandler: ((point: Point) => void) | null = null;

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
    this.acquireCount++;
    if (this.acquireShouldFail) {
      return false;
    }
    this.held = true;
    return true;
  }

  release(): void {
    if (!this.held) {
      return;
    }
    this.releaseCount++;
    this.held = false;
  }

  isHeld(): boolean {
    return this.held;
  }

  /** Test helper: simulate the user pressing Escape while the grab is held. */
  fireEsc(): void {
    this.escHandler?.();
  }

  /**
   * Test helper: simulate a press outside the overlay (top bar, dock).
   * Fires even when no grab is held, so tests can check that the
   * controller itself ignores a stray press while closing or closed.
   */
  fireOutsidePress(): void {
    this.outsidePressHandler?.();
  }

  /**
   * Test helper: simulate one scroll step over the overlay. Fires even
   * when no grab is held, so tests can check that the controller itself
   * drops a step outside `open`.
   */
  fireScroll(step: ScrollStep): void {
    this.scrollHandler?.(step);
  }

  /**
   * Test helper: simulate a pointer motion. Fires even when no grab is
   * held, so tests can check that the controller itself drops a motion
   * outside `open`.
   */
  fireMotion(point: Point): void {
    this.motionHandler?.(point);
  }
}

export class FakeWindowMirror implements WindowMirrorPort {
  mountCount = 0;
  unmountCount = 0;
  /** The options of every `unmount()` call, in order. */
  readonly unmountCalls: UnmountOptions[] = [];
  /**
   * When `true`, an animated `unmount()` keeps its `onDone` pending (an
   * ease in flight) until {@link finishUnmount} or an immediate unmount.
   */
  deferUnmountDone = false;
  /** Toggle to make the next `mount()` report "no eligible window". */
  mountShouldFindNoWindow = false;
  /**
   * How many clones the next `mount()` will report. Defaults to a single
   * clone so tests that don't care about the count keep working unchanged.
   */
  nextMountCount = 1;
  /** Wall-clock epoch ms recorded on a simulated clone click. */
  lastActivatedAt: number | null = null;
  /** Every `cycleAt()` call, in order. */
  readonly cycleCalls: { point: Point; direction: CycleDirection }[] = [];
  /** Epoch ms that `cycleAt()` records as `lastCycledAt`. */
  cycledAtStamp = 2_000;
  /** Every `hoverAt()` call's point, in order. */
  readonly hoverCalls: Point[] = [];
  /** What `snapshot()` reports as `stripCount`. */
  stripCount = 0;
  private lastCycledAt: number | null = null;
  private clonedCount = 0;
  private activatedHandler: (() => void) | null = null;
  private pendingDone: (() => void)[] = [];

  mount(onActivated: () => void): boolean {
    this.mountCount++;
    if (this.mountShouldFindNoWindow) {
      this.activatedHandler = null;
      this.clonedCount = 0;
      return false;
    }
    this.activatedHandler = onActivated;
    this.clonedCount = this.nextMountCount;
    return this.clonedCount > 0;
  }

  unmount(options: UnmountOptions = {}): void {
    this.unmountCount++;
    this.unmountCalls.push(options);
    this.activatedHandler = null;
    if (this.deferUnmountDone && options.immediate !== true) {
      if (options.onDone !== undefined) {
        this.pendingDone.push(options.onDone);
      }
      return;
    }
    // Like production, an immediate teardown also completes a close that
    // was still easing.
    this.finishUnmount();
    options.onDone?.();
  }

  /** Whether an animated unmount is still waiting to land. */
  hasPendingUnmount(): boolean {
    return this.pendingDone.length > 0;
  }

  /** Test helper: land the close ease(s) deferred by {@link deferUnmountDone}. */
  finishUnmount(): void {
    this.clonedCount = 0;
    const done = this.pendingDone;
    this.pendingDone = [];
    for (const onDone of done) {
      onDone();
    }
  }

  cycleAt(point: Point, direction: CycleDirection): boolean {
    this.cycleCalls.push({ point, direction });
    if (this.clonedCount === 0) {
      return false;
    }
    this.lastCycledAt = this.cycledAtStamp;
    return true;
  }

  hoverAt(point: Point): void {
    this.hoverCalls.push(point);
  }

  snapshot(): WindowMirrorSnapshot {
    return {
      clonedCount: this.clonedCount,
      lastActivatedAt: this.lastActivatedAt,
      lastCycledAt: this.lastCycledAt,
      stripCount: this.stripCount,
    };
  }

  /**
   * Test helper: simulate the user clicking a mounted clone. The fake
   * mirrors the production behavior of recording the activation timestamp
   * before invoking the controller-supplied callback so assertions can see
   * the same ordering the real implementation produces.
   */
  simulateActivate(at: number): void {
    if (this.activatedHandler === null) {
      return;
    }
    this.lastActivatedAt = at;
    this.activatedHandler();
  }
}

export type RealWindowsCall = 'hide' | 'show' | 'restore';

export class FakeRealWindows implements RealWindowsPort {
  /** Every call, in order. */
  readonly calls: RealWindowsCall[] = [];
  /** Epoch ms that the next `restore()` records as `lastRestoredAt`. */
  restoreAt = 1_000;
  /** Test helper: make `hide()` hide and then throw. */
  throwAfterHide: Error | null = null;
  /** Observer invoked on every call, after it is recorded. */
  onCall: ((call: RealWindowsCall) => void) | null = null;
  private hidden = false;
  private lastRestoredAt: number | null = null;

  hide(): void {
    this.record('hide');
    this.hidden = true;
    if (this.throwAfterHide !== null) {
      throw this.throwAfterHide;
    }
  }

  show(): void {
    this.record('show');
    this.hidden = false;
  }

  restore(): void {
    this.record('restore');
    this.hidden = false;
    this.lastRestoredAt = this.restoreAt;
  }

  snapshot(): RealWindowsSnapshot {
    return {
      hidden: this.hidden,
      lastRestoredAt: this.lastRestoredAt,
    };
  }

  private record(call: RealWindowsCall): void {
    this.calls.push(call);
    this.onCall?.(call);
  }
}

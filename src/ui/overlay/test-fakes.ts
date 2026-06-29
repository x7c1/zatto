/**
 * Test doubles for the overlay ports.
 *
 * These fakes are the entire reason the ports exist: they let `OverlayController`
 * be exercised end-to-end under vitest without bootstrapping GNOME Shell. Each
 * fake records the lifecycle calls the controller makes on it so tests can
 * assert "we called `acquire` then later `release`" rather than checking
 * implementation details.
 */

import type {
  HotCornerPort,
  ModalGrabPort,
  OverlayActorPort,
  RealWindowsVisibilityPort,
  RealWindowsVisibilitySnapshot,
  WindowMirrorByZone,
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

  /** Test helper: simulate a hover into the trigger zone. */
  fireEnter(): void {
    this.handler?.();
  }
}

export class FakeOverlayActor implements OverlayActorPort {
  mounted = false;
  destroyed = false;
  private visible = false;
  private cornerReenterHandler: (() => void) | null = null;

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

  onCornerReenter(handler: () => void): void {
    this.cornerReenterHandler = handler;
  }

  /**
   * Test helper: simulate the user hovering the in-overlay corner sensor
   * (i.e. re-entering the hot corner zone while the modal grab is held).
   */
  simulateCornerReenter(): void {
    this.cornerReenterHandler?.();
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
  /**
   * Toggle to make `acquire()` throw, simulating an unexpected runtime
   * failure deep inside the grab plumbing. Used by tests that exercise
   * the controller's catch-and-restore safety net around `handleOpen()`.
   */
  acquireShouldThrow = false;
  private held = false;
  private escHandler: (() => void) | null = null;

  onEsc(handler: () => void): void {
    this.escHandler = handler;
  }

  acquire(): boolean {
    this.acquireCount++;
    if (this.acquireShouldThrow) {
      throw new Error('FakeModalGrab.acquire forced failure');
    }
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
}

/**
 * Optional cross-fake event recorder. Tests that need to assert the
 * relative order of calls across multiple fakes (e.g. "the defensive
 * `realWindows.restore` on `disable()` must happen before the window
 * mirror's `unmount`") build a shared timeline and pass it into each
 * fake's constructor. Fakes that receive a recorder push a stable label
 * for every lifecycle method they expose; tests then assert on the
 * shared array.
 *
 * Kept entirely optional so the existing single-fake tests stay free of
 * timeline noise.
 */
export type CallRecorder = (label: string) => void;

export class FakeWindowMirror implements WindowMirrorPort {
  mountCount = 0;
  unmountCount = 0;
  /** Toggle to make the next `mount()` report "no eligible window". */
  mountShouldFindNoWindow = false;
  /**
   * Per-zone counts the next `mount()` will report. Defaults to a single
   * clone in `bottomRight` (the production fallback zone), so existing
   * tests that don't care about routing keep working unchanged. Tests
   * that exercise multi-zone behavior overwrite this before firing the
   * hot corner. The key set is open — tests are free to add zones the
   * production `ZoneConfig` would not define.
   */
  nextMountByZone: Record<string, number> = { bottomRight: 1 };
  /** Wall-clock epoch ms recorded on a simulated clone click. */
  lastActivatedAt: number | null = null;
  /**
   * Record of every `unmount()` call's `immediate` flag (defaulting to
   * `false` when omitted). Tests assert against this to verify the
   * controller routes `disable()` through the immediate path while
   * user-driven closes go through the animated one.
   */
  unmountCalls: Array<{ immediate: boolean }> = [];
  private byZone: WindowMirrorByZone = {};
  private activatedHandler: (() => void) | null = null;

  constructor(private readonly recorder?: CallRecorder) {}

  mount(onActivated: () => void): boolean {
    this.mountCount++;
    this.recorder?.('windowMirror.mount');
    if (this.mountShouldFindNoWindow) {
      this.activatedHandler = null;
      this.byZone = {};
      return false;
    }
    this.activatedHandler = onActivated;
    this.byZone = { ...this.nextMountByZone };
    return sumByZone(this.byZone) > 0;
  }

  unmount(options?: { readonly immediate?: boolean }): void {
    this.unmountCount++;
    this.unmountCalls.push({ immediate: options?.immediate ?? false });
    this.recorder?.('windowMirror.unmount');
    this.activatedHandler = null;
    this.byZone = {};
  }

  /**
   * Most recent `unmount()`'s `immediate` flag, or `undefined` if
   * `unmount` has not been called. Sugar over `unmountCalls.at(-1)?.immediate`.
   */
  get lastUnmountImmediate(): boolean | undefined {
    return this.unmountCalls.at(-1)?.immediate;
  }

  snapshot(): WindowMirrorSnapshot {
    return {
      clonedCount: sumByZone(this.byZone),
      byZone: { ...this.byZone },
      lastActivatedAt: this.lastActivatedAt,
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

function sumByZone(byZone: WindowMirrorByZone): number {
  return Object.values(byZone).reduce((a, b) => a + b, 0);
}

/**
 * Test double for the {@link RealWindowsVisibilityPort}.
 *
 * Records every lifecycle call into {@link callLog} so tests can assert
 * relative ordering — e.g. "the defensive `restore` on `disable()` must
 * happen before the window mirror's `unmount`". The per-method counters
 * are sugar over the same data for tests that only need totals.
 */
export class FakeRealWindowsVisibility implements RealWindowsVisibilityPort {
  hideCount = 0;
  showCount = 0;
  restoreCount = 0;
  /** Lifecycle log in observation order, per-fake. */
  callLog: Array<'hide' | 'show' | 'restore'> = [];
  /** Wall-clock epoch ms recorded on the most recent {@link restore} call. */
  private lastRestoredAt: number | null = null;
  private hidden = false;

  constructor(private readonly recorder?: CallRecorder) {}

  hide(): void {
    this.hideCount++;
    this.callLog.push('hide');
    this.recorder?.('realWindows.hide');
    this.hidden = true;
  }

  show(): void {
    this.showCount++;
    this.callLog.push('show');
    this.recorder?.('realWindows.show');
    this.hidden = false;
  }

  restore(): void {
    this.restoreCount++;
    this.callLog.push('restore');
    this.recorder?.('realWindows.restore');
    this.hidden = false;
    this.lastRestoredAt = Date.now();
  }

  snapshot(): RealWindowsVisibilitySnapshot {
    return {
      hidden: this.hidden,
      lastRestoredAt: this.lastRestoredAt,
    };
  }
}

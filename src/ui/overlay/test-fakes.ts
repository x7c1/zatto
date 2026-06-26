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
  WindowMirrorByZone,
  WindowMirrorPort,
  WindowMirrorSnapshot,
} from './ports.js';

const ZERO_BY_ZONE: WindowMirrorByZone = {
  topLeft: 0,
  topRight: 0,
  bottomLeft: 0,
  bottomRight: 0,
};

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
  private held = false;
  private escHandler: (() => void) | null = null;

  onEsc(handler: () => void): void {
    this.escHandler = handler;
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
}

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
   * hot corner.
   */
  nextMountByZone: WindowMirrorByZone = { ...ZERO_BY_ZONE, bottomRight: 1 };
  /** Wall-clock epoch ms recorded on a simulated clone click. */
  lastActivatedAt: number | null = null;
  private byZone: WindowMirrorByZone = ZERO_BY_ZONE;
  private activatedHandler: (() => void) | null = null;

  mount(onActivated: () => void): boolean {
    this.mountCount++;
    if (this.mountShouldFindNoWindow) {
      this.activatedHandler = null;
      this.byZone = ZERO_BY_ZONE;
      return false;
    }
    this.activatedHandler = onActivated;
    this.byZone = { ...this.nextMountByZone };
    return sumByZone(this.byZone) > 0;
  }

  unmount(): void {
    this.unmountCount++;
    this.activatedHandler = null;
    this.byZone = ZERO_BY_ZONE;
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
  return byZone.topLeft + byZone.topRight + byZone.bottomLeft + byZone.bottomRight;
}

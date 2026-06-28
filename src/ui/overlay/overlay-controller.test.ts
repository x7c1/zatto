/**
 * Integration tests for {@link OverlayController}.
 *
 * Unlike the pure FSM tests in `overlay-state-machine.test.ts`, these wire
 * the controller against fake hot-corner / overlay-actor / modal-grab
 * implementations and assert the cross-port behavior the controller is
 * responsible for: visibility, grab lifecycle, Esc handling, debounce.
 */

import { describe, expect, it } from 'vitest';
import { OverlayController } from './overlay-controller.js';
import { FakeHotCorner, FakeModalGrab, FakeOverlayActor, FakeWindowMirror } from './test-fakes.js';

function setup(options: { debounceMs?: number } = {}) {
  let now = 0;
  let epochNow = 1_000_000;
  const hotCorner = new FakeHotCorner();
  const actor = new FakeOverlayActor();
  const modalGrab = new FakeModalGrab();
  const windowMirror = new FakeWindowMirror();
  const controller = new OverlayController(hotCorner, actor, modalGrab, windowMirror, {
    debounceMs: options.debounceMs ?? 200,
    now: () => now,
    epochNow: () => epochNow,
  });
  controller.enable();
  return {
    controller,
    hotCorner,
    actor,
    modalGrab,
    windowMirror,
    advance(ms: number) {
      now += ms;
      epochNow += ms;
    },
    setEpoch(ms: number) {
      epochNow = ms;
    },
  };
}

describe('OverlayController', () => {
  it('opens the overlay and acquires the grab when the hot corner fires', () => {
    const { hotCorner, actor, modalGrab } = setup();

    hotCorner.fireEnter();

    expect(actor.isVisible()).toBe(true);
    expect(modalGrab.isHeld()).toBe(true);
    expect(modalGrab.acquireCount).toBe(1);
  });

  it('closes the overlay and releases the grab on a second hot-corner enter', () => {
    const { hotCorner, actor, modalGrab, advance } = setup({ debounceMs: 100 });

    hotCorner.fireEnter();
    advance(150); // clear the debounce window

    hotCorner.fireEnter();

    expect(actor.isVisible()).toBe(false);
    expect(modalGrab.isHeld()).toBe(false);
    expect(modalGrab.releaseCount).toBe(1);
  });

  it('closes the overlay via the in-overlay corner sensor while the modal grab is held', () => {
    // Regression: under the modal grab the chrome-level `HotCornerTrigger`
    // stops receiving pointer events (events are routed only to the grab
    // actor and its descendants), so the in-overlay corner sensor must own
    // the Open -> Closed path while open.
    const { controller, hotCorner, actor, modalGrab, advance } = setup({ debounceMs: 100 });

    hotCorner.fireEnter();
    advance(150); // clear the debounce window

    actor.simulateCornerReenter();

    expect(actor.isVisible()).toBe(false);
    expect(modalGrab.isHeld()).toBe(false);
    expect(modalGrab.releaseCount).toBe(1);
    expect(controller.snapshot().overlay.state).toBe('closed');
  });

  it('ignores a corner-reenter that arrives inside the debounce window', () => {
    const { actor, hotCorner, modalGrab, advance } = setup({ debounceMs: 200 });

    hotCorner.fireEnter(); // opens, starts the cooldown
    advance(50); // < 200ms
    actor.simulateCornerReenter();

    // Still open — the corner sensor shares the FSM's debounce contract with
    // the primary hot corner.
    expect(actor.isVisible()).toBe(true);
    expect(modalGrab.isHeld()).toBe(true);
    expect(modalGrab.releaseCount).toBe(0);
  });

  it('closes the overlay and releases the grab when Esc fires', () => {
    const { hotCorner, actor, modalGrab } = setup();

    hotCorner.fireEnter();
    modalGrab.fireEsc();

    expect(actor.isVisible()).toBe(false);
    expect(modalGrab.isHeld()).toBe(false);
    expect(modalGrab.releaseCount).toBe(1);
  });

  it('opens again cleanly after Esc closes the overlay', () => {
    const { hotCorner, actor, modalGrab, advance } = setup({ debounceMs: 50 });

    hotCorner.fireEnter();
    modalGrab.fireEsc();
    advance(100);

    hotCorner.fireEnter();

    expect(actor.isVisible()).toBe(true);
    expect(modalGrab.isHeld()).toBe(true);
    expect(modalGrab.acquireCount).toBe(2);
    expect(modalGrab.releaseCount).toBe(1);
  });

  it('ignores a rapid second hot-corner enter inside the debounce window', () => {
    const { hotCorner, actor, modalGrab, advance } = setup({ debounceMs: 200 });

    hotCorner.fireEnter();
    advance(50); // < 200ms
    hotCorner.fireEnter();

    // Still open from the first enter — the second one was swallowed.
    expect(actor.isVisible()).toBe(true);
    expect(modalGrab.isHeld()).toBe(true);
    expect(modalGrab.acquireCount).toBe(1);
    expect(modalGrab.releaseCount).toBe(0);
  });

  it('fires Esc even inside the hot-corner debounce window', () => {
    const { hotCorner, actor, modalGrab } = setup({ debounceMs: 10_000 });

    hotCorner.fireEnter();
    // No time advance — well inside the 10s cooldown.
    modalGrab.fireEsc();

    expect(actor.isVisible()).toBe(false);
    expect(modalGrab.isHeld()).toBe(false);
  });

  it('disable() releases the grab, destroys the actor, and stops the hot corner', () => {
    const { controller, hotCorner, actor, modalGrab, windowMirror } = setup();
    hotCorner.fireEnter(); // open so there's actually something to tear down

    controller.disable();

    expect(modalGrab.isHeld()).toBe(false);
    expect(actor.destroyed).toBe(true);
    expect(actor.isVisible()).toBe(false);
    expect(hotCorner.enabled).toBe(false);
    // The clone container is part of the actor that's about to be
    // destroyed — make sure we tore the clone down first so its click
    // handler is disconnected explicitly, not implicitly via parent
    // destruction.
    expect(windowMirror.unmountCount).toBeGreaterThanOrEqual(1);
  });

  it('ignores hot-corner enters that arrive after disable()', () => {
    const { controller, hotCorner, actor, modalGrab } = setup();

    controller.disable();
    hotCorner.fireEnter();

    expect(actor.isVisible()).toBe(false);
    expect(modalGrab.isHeld()).toBe(false);
    // Defensive: the FSM was reset on disable, so even if a stray event
    // sneaks in, no grab was acquired.
    expect(modalGrab.acquireCount).toBe(0);
  });

  describe('snapshot()', () => {
    it('reports closed state with no hot-corner history initially', () => {
      const { controller } = setup();

      // The fake mirror starts with an empty `byZone` (no clones
      // mounted yet); the production mirror would seed the configured
      // zone keys at zero, but the snapshot contract only guarantees
      // that the values sum to `clonedCount`, not which zones appear.
      expect(controller.snapshot()).toEqual({
        overlay: { state: 'closed', visible: false },
        hotCorner: { lastEnterAt: null },
        windowMirror: {
          clonedCount: 0,
          byZone: {},
          lastActivatedAt: null,
        },
      });
    });

    it('reports open state and visible=true after the overlay opens', () => {
      const { controller, hotCorner, setEpoch } = setup();
      setEpoch(1_700_000_000_000);

      hotCorner.fireEnter();

      expect(controller.snapshot()).toEqual({
        overlay: { state: 'open', visible: true },
        hotCorner: { lastEnterAt: 1_700_000_000_000 },
        windowMirror: {
          clonedCount: 1,
          byZone: { bottomRight: 1 },
          lastActivatedAt: null,
        },
      });
    });

    it('reports closed state and visible=false after Esc', () => {
      const { controller, hotCorner, modalGrab } = setup();
      hotCorner.fireEnter();
      modalGrab.fireEsc();

      const snap = controller.snapshot();
      expect(snap.overlay).toEqual({ state: 'closed', visible: false });
      expect(snap.hotCorner.lastEnterAt).not.toBeNull();
    });

    it('round-trips through JSON without losing fields (D-Bus contract)', () => {
      // The DBusInspector serializes this exact object with JSON.stringify,
      // so any Date / Map / undefined that sneaks into the snapshot would
      // silently corrupt the wire payload.
      const { controller, hotCorner, setEpoch } = setup();
      setEpoch(1_700_000_000_500);
      hotCorner.fireEnter();

      const snap = controller.snapshot();
      expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    });

    it('updates lastEnterAt on every hot-corner enter (even debounced)', () => {
      // Recording every observation (not just accepted toggles) makes the
      // snapshot a faithful "is the hot corner firing at all" signal, which
      // is what you want when debugging from the D-Bus inspector.
      const { controller, hotCorner, setEpoch } = setup({ debounceMs: 10_000 });
      setEpoch(1_000);
      hotCorner.fireEnter(); // accepted -> opens
      setEpoch(2_000);
      hotCorner.fireEnter(); // swallowed by debounce, but still observed

      expect(controller.snapshot().hotCorner.lastEnterAt).toBe(2_000);
    });
  });

  describe('window mirror wiring', () => {
    it('mounts a live window clone when the overlay opens', () => {
      const { hotCorner, windowMirror } = setup();

      hotCorner.fireEnter();

      expect(windowMirror.mountCount).toBe(1);
      expect(windowMirror.unmountCount).toBe(0);
    });

    it('unmounts the clones when the overlay closes via a second hot-corner enter', () => {
      const { hotCorner, windowMirror, advance } = setup({ debounceMs: 100 });

      hotCorner.fireEnter();
      advance(150);
      hotCorner.fireEnter();

      expect(windowMirror.mountCount).toBe(1);
      expect(windowMirror.unmountCount).toBe(1);
    });

    it('closes the overlay when the user clicks the mirrored clone', () => {
      // Core PoC-step-3 behavior: clicking a live clone has to both raise
      // the underlying window (the port handles that internally) AND
      // collapse the overlay so the user sees the result immediately.
      const { actor, hotCorner, modalGrab, windowMirror } = setup();
      hotCorner.fireEnter();

      windowMirror.simulateActivate(1_700_000_001_234);

      expect(actor.isVisible()).toBe(false);
      expect(modalGrab.isHeld()).toBe(false);
      expect(modalGrab.releaseCount).toBe(1);
      expect(windowMirror.unmountCount).toBe(1);
    });

    it('still opens the overlay even when no eligible window is available', () => {
      // A "no windows to mirror" mount() return value is not an error —
      // the dimmer should still appear so the user can dismiss the gesture
      // they just made.
      const { actor, hotCorner, modalGrab, windowMirror } = setup();
      windowMirror.mountShouldFindNoWindow = true;

      hotCorner.fireEnter();

      expect(actor.isVisible()).toBe(true);
      expect(modalGrab.isHeld()).toBe(true);
      expect(windowMirror.mountCount).toBe(1);
    });

    it('surfaces lastActivatedAt in the snapshot once a clone has been activated', () => {
      const { controller, hotCorner, windowMirror } = setup();
      hotCorner.fireEnter();
      windowMirror.simulateActivate(1_700_000_002_500);

      const snap = controller.snapshot();
      expect(snap.windowMirror.lastActivatedAt).toBe(1_700_000_002_500);
      // clonedCount goes back to 0 after the controller-driven unmount that
      // happens as part of closing in response to the click.
      expect(snap.windowMirror.clonedCount).toBe(0);
    });

    it('exposes per-zone clone counts in the snapshot after a multi-zone mount', () => {
      // The controller does not own the zone routing (the production
      // `GnomeWindowMirror` does), so this test just confirms that whatever
      // `byZone` shape the port reports lands intact in the snapshot — the
      // Inspect endpoint contract surface.
      const { controller, hotCorner, windowMirror } = setup();
      windowMirror.nextMountByZone = {
        topLeft: 2,
        topRight: 1,
        bottomLeft: 0,
        bottomRight: 3,
      };

      hotCorner.fireEnter();

      const snap = controller.snapshot();
      expect(snap.windowMirror.clonedCount).toBe(6);
      expect(snap.windowMirror.byZone).toEqual({
        topLeft: 2,
        topRight: 1,
        bottomLeft: 0,
        bottomRight: 3,
      });
    });
  });
});

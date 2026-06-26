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
import { FakeHotCorner, FakeModalGrab, FakeOverlayActor } from './test-fakes.js';

function setup(options: { debounceMs?: number } = {}) {
  let now = 0;
  let epochNow = 1_000_000;
  const hotCorner = new FakeHotCorner();
  const actor = new FakeOverlayActor();
  const modalGrab = new FakeModalGrab();
  const controller = new OverlayController(hotCorner, actor, modalGrab, {
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
    const { controller, hotCorner, actor, modalGrab } = setup();
    hotCorner.fireEnter(); // open so there's actually something to tear down

    controller.disable();

    expect(modalGrab.isHeld()).toBe(false);
    expect(actor.destroyed).toBe(true);
    expect(actor.isVisible()).toBe(false);
    expect(hotCorner.enabled).toBe(false);
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

      expect(controller.snapshot()).toEqual({
        overlay: { state: 'closed', visible: false },
        hotCorner: { lastEnterAt: null },
      });
    });

    it('reports open state and visible=true after the overlay opens', () => {
      const { controller, hotCorner, setEpoch } = setup();
      setEpoch(1_700_000_000_000);

      hotCorner.fireEnter();

      expect(controller.snapshot()).toEqual({
        overlay: { state: 'open', visible: true },
        hotCorner: { lastEnterAt: 1_700_000_000_000 },
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
});

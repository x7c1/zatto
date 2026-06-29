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
import {
  FakeHotCorner,
  FakeModalGrab,
  FakeOverlayActor,
  FakeRealWindowsVisibility,
  FakeWindowMirror,
} from './test-fakes.js';

function setup(options: { debounceMs?: number; autoEnable?: boolean } = {}) {
  let now = 0;
  let epochNow = 1_000_000;
  // Shared cross-fake timeline. Tests that need to assert "call A on
  // fake X happened before call B on fake Y" read this array; tests
  // that don't care can ignore it.
  const timeline: string[] = [];
  const record = (label: string) => {
    timeline.push(label);
  };
  const hotCorner = new FakeHotCorner();
  const actor = new FakeOverlayActor();
  const modalGrab = new FakeModalGrab();
  const windowMirror = new FakeWindowMirror(record);
  const realWindows = new FakeRealWindowsVisibility(record);
  const controller = new OverlayController(hotCorner, actor, modalGrab, windowMirror, realWindows, {
    debounceMs: options.debounceMs ?? 200,
    now: () => now,
    epochNow: () => epochNow,
  });
  if (options.autoEnable !== false) {
    controller.enable();
  }
  return {
    controller,
    hotCorner,
    actor,
    modalGrab,
    windowMirror,
    realWindows,
    timeline,
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
    // disable() must force the synchronous unmount path: easing into a
    // doomed parent is wasted work and risks fire-after-destroy
    // callbacks. Normal close paths (corner re-enter, Esc, clone click)
    // are covered separately below.
    expect(windowMirror.lastUnmountImmediate).toBe(true);
  });

  it('uses the animated unmount path for user-driven close paths', () => {
    // The opposite of the disable() invariant above: when the user
    // dismisses via Esc, the corner sensor, or a clone click, the
    // overlay's actor tree stays alive long enough for the unmount
    // ease to land on screen, so we must NOT force the immediate path.
    // Sample all three user-driven paths in one test rather than
    // duplicating the setup boilerplate per path.
    const samples = ['esc', 'corner', 'click'] as const;
    for (const path of samples) {
      const { actor, hotCorner, modalGrab, windowMirror, advance } = setup({ debounceMs: 100 });
      hotCorner.fireEnter();
      advance(150); // clear the debounce window for the corner-reenter case

      if (path === 'esc') {
        modalGrab.fireEsc();
      } else if (path === 'corner') {
        actor.simulateCornerReenter();
      } else {
        windowMirror.simulateActivate(1_700_000_000_000);
      }

      const lastImmediate = windowMirror.lastUnmountImmediate;
      // Either explicitly false or undefined (no options passed) is
      // acceptable — both leave the port free to play the unmount ease.
      expect(lastImmediate === true).toBe(false);
    }
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
      const { controller, realWindows } = setup();

      // The fake mirror starts with an empty `byZone` (no clones
      // mounted yet); the production mirror would seed the configured
      // zone keys at zero, but the snapshot contract only guarantees
      // that the values sum to `clonedCount`, not which zones appear.
      // The defensive `restore()` inside `enable()` populates
      // `realWindows.lastRestoredAt`, so we read it back rather than
      // hardcoding a wall-clock value.
      const snap = controller.snapshot();
      expect(snap).toEqual({
        overlay: { state: 'closed', visible: false },
        hotCorner: { lastEnterAt: null },
        windowMirror: {
          clonedCount: 0,
          byZone: {},
          lastActivatedAt: null,
        },
        realWindows: {
          hidden: false,
          lastRestoredAt: realWindows.snapshot().lastRestoredAt,
        },
      });
      expect(snap.realWindows.lastRestoredAt).not.toBeNull();
    });

    it('reports open state and visible=true after the overlay opens', () => {
      const { controller, hotCorner, realWindows, setEpoch } = setup();
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
        realWindows: {
          hidden: true,
          lastRestoredAt: realWindows.snapshot().lastRestoredAt,
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

  describe('real-windows visibility wiring', () => {
    it('restores real windows defensively as the very first step of enable()', () => {
      // Crash-safety: a previous instance may have died with the
      // desktop hidden (extension reload, exception during open). The
      // first thing a fresh controller does has to be `restore()` — it
      // is the only handle we have on getting the user's screen back.
      const { realWindows } = setup();

      expect(realWindows.restoreCount).toBe(1);
      expect(realWindows.callLog[0]).toBe('restore');
      expect(realWindows.snapshot().lastRestoredAt).not.toBeNull();
    });

    it('hides the real windows when the overlay opens', () => {
      const { hotCorner, realWindows } = setup();

      hotCorner.fireEnter();

      expect(realWindows.hideCount).toBe(1);
      expect(realWindows.snapshot().hidden).toBe(true);
    });

    it('shows the real windows again on a hot-corner-driven close', () => {
      const { hotCorner, realWindows, advance } = setup({ debounceMs: 100 });

      hotCorner.fireEnter();
      advance(150); // clear the debounce window
      hotCorner.fireEnter();

      expect(realWindows.showCount).toBe(1);
      expect(realWindows.snapshot().hidden).toBe(false);
    });

    it('shows the real windows again on an Esc-driven close', () => {
      const { hotCorner, modalGrab, realWindows } = setup();

      hotCorner.fireEnter();
      modalGrab.fireEsc();

      expect(realWindows.showCount).toBe(1);
      expect(realWindows.snapshot().hidden).toBe(false);
    });

    it('shows the real windows again on a clone-click close', () => {
      const { hotCorner, windowMirror, realWindows } = setup();

      hotCorner.fireEnter();
      windowMirror.simulateActivate(1_700_000_010_000);

      expect(realWindows.showCount).toBe(1);
      expect(realWindows.snapshot().hidden).toBe(false);
    });

    it('restores the real windows on disable() before unmounting the mirror', () => {
      // Two safety invariants in one test:
      //   1. `restoreCount` is 2 — once from the defensive call inside
      //      enable() (a freshly-constructed controller), once from
      //      disable() itself. If a future refactor drops either call
      //      the count flips and this test fails loudly.
      //   2. The disable() restore happens BEFORE the window mirror's
      //      unmount. The actor tree is about to be destroyed; the
      //      desktop must be visible the moment teardown starts so a
      //      throw from any subsequent step leaves the user with a
      //      usable screen.
      const { controller, realWindows, timeline } = setup();

      controller.disable();

      expect(realWindows.restoreCount).toBe(2);
      const restoreIndices = timeline
        .map((label, i) => (label === 'realWindows.restore' ? i : -1))
        .filter((i) => i !== -1);
      const unmountIndex = timeline.indexOf('windowMirror.unmount');
      expect(restoreIndices.length).toBe(2);
      expect(unmountIndex).toBeGreaterThan(-1);
      // The second (disable-driven) restore must precede the unmount.
      expect(restoreIndices[1]).toBeLessThan(unmountIndex);
    });

    it('restores the real windows if handleOpen() throws and re-raises the error', () => {
      // The catch around `handleOpen()` is the third safety net (after
      // `restore` on enable / disable). When something inside the open
      // path throws (here: a forced `acquire()` failure), the desktop
      // must come back and the exception must still propagate so the
      // FSM and any outer logging see the failure.
      const { hotCorner, modalGrab, realWindows } = setup();
      modalGrab.acquireShouldThrow = true;

      expect(() => hotCorner.fireEnter()).toThrow(/FakeModalGrab\.acquire/);
      // One restore from enable(), one from the catch. >= guards
      // against the unlikely future case where multiple defensive
      // restores fire on the same open path; the floor is what we
      // care about.
      expect(realWindows.restoreCount).toBeGreaterThanOrEqual(2);
      expect(realWindows.snapshot().hidden).toBe(false);
    });

    it('includes a JSON-stable realWindows block in the snapshot', () => {
      // The DBusInspector serializes the snapshot with JSON.stringify;
      // surfacing the realWindows block through the D-Bus contract is
      // the whole reason the port exists. Round-trip explicitly so a
      // future field that happens to be a Date / Map / undefined would
      // get caught instead of silently corrupting the wire payload.
      const { controller, hotCorner } = setup();
      hotCorner.fireEnter();

      const snap = controller.snapshot();
      const roundTripped = JSON.parse(JSON.stringify(snap));
      expect(roundTripped).toEqual(snap);
      expect(roundTripped.realWindows.hidden).toBe(true);
      expect(typeof roundTripped.realWindows.lastRestoredAt).toBe('number');
    });
  });
});

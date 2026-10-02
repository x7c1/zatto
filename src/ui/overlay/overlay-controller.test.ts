/**
 * Integration tests for {@link OverlayController}.
 *
 * Unlike the pure FSM tests in `overlay-state-machine.test.ts`, these wire
 * the controller against fake hot-corner / overlay-actor / modal-grab
 * implementations and assert the cross-port behavior the controller is
 * responsible for: visibility, grab lifecycle, Esc and outside-press
 * handling, debounce, and hiding / showing the real windows around the
 * clone transitions.
 */

import { describe, expect, it } from 'vitest';
import { OverlayController } from './overlay-controller.js';
import {
  FakeHotCorner,
  FakeModalGrab,
  FakeOverlayActor,
  FakeRealWindows,
  FakeWindowMirror,
} from './test-fakes.js';

function setup(options: { debounceMs?: number; enable?: boolean } = {}) {
  let now = 0;
  let epochNow = 1_000_000;
  const hotCorner = new FakeHotCorner();
  const actor = new FakeOverlayActor();
  const modalGrab = new FakeModalGrab();
  const windowMirror = new FakeWindowMirror();
  const realWindows = new FakeRealWindows();
  const controller = new OverlayController(hotCorner, actor, modalGrab, windowMirror, realWindows, {
    debounceMs: options.debounceMs ?? 200,
    now: () => now,
    epochNow: () => epochNow,
  });
  if (options.enable ?? true) {
    controller.enable();
  }
  return {
    controller,
    hotCorner,
    actor,
    modalGrab,
    windowMirror,
    realWindows,
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
    // The grab is on the stage, so the trigger keeps firing while open.
    const { hotCorner, actor, modalGrab, advance } = setup({ debounceMs: 100 });

    hotCorner.fireEnter();
    advance(150); // clear the debounce window

    hotCorner.fireEnter();

    expect(actor.isVisible()).toBe(false);
    expect(modalGrab.isHeld()).toBe(false);
    expect(modalGrab.releaseCount).toBe(1);
  });

  describe('outside press (onOutsidePress)', () => {
    it('closes the overlay and releases the grab while open', () => {
      const { controller, hotCorner, actor, modalGrab, windowMirror } = setup();
      hotCorner.fireEnter();

      modalGrab.fireOutsidePress();

      expect(actor.isVisible()).toBe(false);
      expect(modalGrab.isHeld()).toBe(false);
      expect(modalGrab.releaseCount).toBe(1);
      expect(windowMirror.unmountCount).toBe(1);
      expect(controller.snapshot().overlay.state).toBe('closed');
    });

    it('does nothing while closing', () => {
      const { controller, hotCorner, modalGrab, windowMirror } = setup();
      windowMirror.deferUnmountDone = true;
      hotCorner.fireEnter();
      modalGrab.fireEsc();

      modalGrab.fireOutsidePress();

      expect(controller.snapshot().overlay.state).toBe('closing');
      expect(windowMirror.unmountCount).toBe(1);
      expect(modalGrab.releaseCount).toBe(1);
    });

    it('does nothing while closed', () => {
      const { controller, actor, modalGrab, windowMirror } = setup();

      modalGrab.fireOutsidePress();

      expect(controller.snapshot().overlay.state).toBe('closed');
      expect(actor.isVisible()).toBe(false);
      expect(modalGrab.acquireCount).toBe(0);
      expect(windowMirror.mountCount).toBe(0);
    });
  });

  it('keeps the overlay closed when a hot-corner enter is synthesized right after the close lands', () => {
    // Hiding the dimmer and the clones makes Clutter repick and synthesize
    // an `enter-event` on the trigger if the pointer rests in the corner.
    // The close lands well after it was requested, so the window must
    // restart there, not at the request.
    const { controller, hotCorner, windowMirror, advance } = setup({ debounceMs: 100 });
    windowMirror.deferUnmountDone = true;
    hotCorner.fireEnter();
    advance(150);
    hotCorner.fireEnter(); // close requested
    advance(250); // the close ease
    windowMirror.finishUnmount();

    hotCorner.fireEnter(); // synthesized by the teardown

    expect(controller.snapshot().overlay.state).toBe('closed');
    expect(windowMirror.mountCount).toBe(1);

    advance(100);
    hotCorner.fireEnter(); // a deliberate re-entry

    expect(controller.snapshot().overlay.state).toBe('open');
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

      expect(controller.snapshot()).toEqual({
        overlay: { state: 'closed', visible: false },
        hotCorner: { lastEnterAt: null },
        windowMirror: {
          clonedCount: 0,
          lastActivatedAt: null,
        },
        realWindows: { hidden: false, lastRestoredAt: 1_000 },
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
          lastActivatedAt: null,
        },
        realWindows: { hidden: true, lastRestoredAt: 1_000 },
      });
    });

    it('reports closed state and visible=false after Esc', () => {
      const { controller, hotCorner, modalGrab } = setup();
      hotCorner.fireEnter();
      modalGrab.fireEsc();

      const snap = controller.snapshot();
      expect(snap.overlay).toEqual({ state: 'closed', visible: false });
      expect(snap.hotCorner.lastEnterAt).not.toBeNull();
      expect(snap.realWindows.hidden).toBe(false);
    });

    it('round-trips through JSON without losing fields (D-Bus contract)', () => {
      // The DBusInspector serializes this exact object with JSON.stringify,
      // so any Date / Map / undefined that sneaks into the snapshot would
      // silently corrupt the wire payload.
      const { controller, hotCorner, setEpoch } = setup();
      setEpoch(1_700_000_000_500);
      hotCorner.fireEnter();

      const snap = controller.snapshot();
      expect(snap.realWindows).toEqual({ hidden: true, lastRestoredAt: 1_000 });
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
      // Clicking a live clone has to both raise the underlying window (the
      // port handles that internally) AND collapse the overlay so the user
      // sees the result immediately.
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

    it('surfaces the mounted clone count in the snapshot while open', () => {
      const { controller, hotCorner, windowMirror } = setup();
      windowMirror.nextMountCount = 6;

      hotCorner.fireEnter();

      expect(controller.snapshot().windowMirror.clonedCount).toBe(6);
    });
  });
  describe('real windows and the clone transitions', () => {
    /** Open the overlay with close eases deferred, ready to exercise a close path. */
    function setupOpen() {
      const env = setup({ debounceMs: 100 });
      env.windowMirror.deferUnmountDone = true;
      env.hotCorner.fireEnter();
      env.advance(150); // clear the debounce window
      return env;
    }
    type OpenEnv = ReturnType<typeof setupOpen>;

    const closePaths = [
      {
        name: 'hot-corner re-entry',
        close: (env: OpenEnv) => env.hotCorner.fireEnter(),
      },
      {
        name: 'outside press',
        close: (env: OpenEnv) => env.modalGrab.fireOutsidePress(),
      },
      { name: 'Esc', close: (env: OpenEnv) => env.modalGrab.fireEsc() },
      {
        name: 'clone click',
        close: (env: OpenEnv) => env.windowMirror.simulateActivate(42),
      },
    ];

    it('enable() restores the real windows before anything else', () => {
      const { controller, hotCorner, actor, realWindows } = setup({ enable: false });
      const seen: { mounted: boolean; cornerEnabled: boolean }[] = [];
      realWindows.onCall = () =>
        seen.push({ mounted: actor.mounted, cornerEnabled: hotCorner.enabled });

      controller.enable();

      expect(realWindows.calls).toEqual(['restore']);
      expect(seen).toEqual([{ mounted: false, cornerEnabled: false }]);
    });

    it('opens from closed by mounting the clones, then hiding the real windows, then committing', () => {
      const { controller, hotCorner, windowMirror, realWindows } = setup();
      const atHide: { mountCount: number; state: string }[] = [];
      realWindows.onCall = (call) => {
        if (call === 'hide') {
          atHide.push({
            mountCount: windowMirror.mountCount,
            state: controller.snapshot().overlay.state,
          });
        }
      };

      hotCorner.fireEnter();

      expect(atHide).toEqual([{ mountCount: 1, state: 'opening' }]);
      expect(realWindows.calls).toEqual(['restore', 'hide']);
      expect(controller.snapshot().overlay.state).toBe('open');
    });

    for (const { name, close } of closePaths) {
      it(`closes by ${name}: releases the grab, eases the clones back, shows the real windows only once they land`, () => {
        const env = setupOpen();
        const { controller, modalGrab, windowMirror, realWindows } = env;

        close(env);

        expect(modalGrab.isHeld()).toBe(false);
        expect(windowMirror.unmountCalls).toHaveLength(1);
        expect(windowMirror.unmountCalls[0].immediate).toBeUndefined();
        expect(windowMirror.unmountCalls[0].onDone).toBeTypeOf('function');
        // The close ease is in flight: still closing, real windows still hidden.
        expect(controller.snapshot().overlay.state).toBe('closing');
        expect(realWindows.calls).toEqual(['restore', 'hide']);

        windowMirror.finishUnmount();

        expect(realWindows.calls).toEqual(['restore', 'hide', 'show']);
        expect(controller.snapshot().overlay.state).toBe('closed');
        expect(controller.snapshot().realWindows.hidden).toBe(false);
      });
    }

    it('ignores every toggle while the close ease is in flight', () => {
      const env = setupOpen();
      const { controller, hotCorner, modalGrab, windowMirror, realWindows, advance } = env;
      modalGrab.fireEsc();
      advance(500); // well past the debounce window

      hotCorner.fireEnter();
      modalGrab.fireOutsidePress();
      modalGrab.fireEsc();

      expect(controller.snapshot().overlay.state).toBe('closing');
      expect(windowMirror.mountCount).toBe(1);
      expect(windowMirror.unmountCount).toBe(1);
      expect(modalGrab.acquireCount).toBe(1);
      expect(realWindows.calls).toEqual(['restore', 'hide']);
    });

    it('opens normally again once the close ease has landed', () => {
      const env = setupOpen();
      const { controller, hotCorner, modalGrab, windowMirror, realWindows, advance } = env;
      modalGrab.fireEsc();
      windowMirror.finishUnmount();
      advance(150);

      hotCorner.fireEnter();

      expect(controller.snapshot().overlay.state).toBe('open');
      expect(windowMirror.mountCount).toBe(2);
      expect(realWindows.calls).toEqual(['restore', 'hide', 'show', 'hide']);
    });

    it('disable() from open restores the real windows first and unmounts immediately', () => {
      const { controller, hotCorner, modalGrab, windowMirror, realWindows } = setupOpen();
      const atRestore: { cornerEnabled: boolean; grabHeld: boolean; unmounts: number }[] = [];
      realWindows.onCall = (call) => {
        if (call === 'restore') {
          atRestore.push({
            cornerEnabled: hotCorner.enabled,
            grabHeld: modalGrab.isHeld(),
            unmounts: windowMirror.unmountCount,
          });
        }
      };

      controller.disable();

      expect(atRestore).toEqual([{ cornerEnabled: true, grabHeld: true, unmounts: 0 }]);
      expect(realWindows.calls).toEqual(['restore', 'hide', 'restore']);
      expect(windowMirror.unmountCalls).toEqual([{ immediate: true }]);
      expect(controller.snapshot().realWindows.hidden).toBe(false);
    });

    it('disable() during the close ease restores first, unmounts immediately, and completes the close', () => {
      const { controller, modalGrab, windowMirror, realWindows } = setupOpen();
      modalGrab.fireEsc();
      const before = realWindows.calls.length;

      controller.disable();

      expect(realWindows.calls.slice(before)[0]).toBe('restore');
      expect(windowMirror.unmountCalls.at(-1)).toEqual({ immediate: true });
      expect(windowMirror.hasPendingUnmount()).toBe(false);
      expect(controller.snapshot().overlay.state).toBe('closed');
      expect(controller.snapshot().realWindows.hidden).toBe(false);
    });

    it('restores the real windows and rethrows when opening fails after hide()', () => {
      const { controller, hotCorner, realWindows } = setup();
      const failure = new Error('boom');
      realWindows.throwAfterHide = failure;

      expect(() => hotCorner.fireEnter()).toThrow(failure);

      expect(realWindows.calls).toEqual(['restore', 'hide', 'restore']);
      expect(controller.snapshot().realWindows.hidden).toBe(false);
    });
  });
});

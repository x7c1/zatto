import { beforeEach, describe, expect, it } from 'vitest';
import {
  type OverlayEvent,
  OverlayStateMachine,
  type OverlayStateMachineOptions,
} from './overlay-state-machine.js';

/**
 * Test harness: deterministic monotonic clock + event recorder.
 */
function setup(overrides: Partial<OverlayStateMachineOptions> = {}) {
  let now = 0;
  const events: OverlayEvent[] = [];
  const fsm = new OverlayStateMachine({
    debounceMs: overrides.debounceMs ?? 200,
    now: overrides.now ?? (() => now),
  });
  fsm.onEvent((event) => events.push(event));
  return {
    fsm,
    events,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('OverlayStateMachine', () => {
  describe('toggle from closed', () => {
    it('transitions closed -> opening and emits open-requested', () => {
      const { fsm, events } = setup();
      expect(fsm.getState()).toBe('closed');

      const accepted = fsm.toggle();

      expect(accepted).toBe(true);
      expect(fsm.getState()).toBe('opening');
      expect(events).toEqual([{ type: 'open-requested' }]);
    });

    it('reaches open after the glue commits', () => {
      const { fsm, events } = setup();
      fsm.toggle();
      fsm.commitOpened();
      expect(fsm.getState()).toBe('open');
      expect(events).toEqual([{ type: 'open-requested' }, { type: 'opened' }]);
    });
  });

  describe('toggle from open', () => {
    it('transitions open -> closing and emits close-requested', () => {
      const { fsm, events, advance } = setup({ debounceMs: 100 });
      fsm.toggle();
      fsm.commitOpened();
      events.length = 0;

      advance(150); // clear the debounce window
      const accepted = fsm.toggle();

      expect(accepted).toBe(true);
      expect(fsm.getState()).toBe('closing');
      expect(events).toEqual([{ type: 'close-requested' }]);
    });

    it('reaches closed after the glue commits', () => {
      const { fsm, advance } = setup({ debounceMs: 100 });
      fsm.toggle();
      fsm.commitOpened();
      advance(150);
      fsm.toggle();
      fsm.commitClosed();
      expect(fsm.getState()).toBe('closed');
    });
  });

  describe('dismiss (Esc)', () => {
    it('only acts when open: ignored from closed', () => {
      const { fsm, events } = setup();
      const accepted = fsm.dismiss();
      expect(accepted).toBe(false);
      expect(fsm.getState()).toBe('closed');
      expect(events).toEqual([]);
    });

    it('only acts when open: ignored from opening', () => {
      const { fsm, events } = setup();
      fsm.toggle(); // -> opening
      events.length = 0;
      const accepted = fsm.dismiss();
      expect(accepted).toBe(false);
      expect(fsm.getState()).toBe('opening');
      expect(events).toEqual([]);
    });

    it('transitions open -> closing', () => {
      const { fsm, events } = setup();
      fsm.toggle();
      fsm.commitOpened();
      events.length = 0;

      const accepted = fsm.dismiss();

      expect(accepted).toBe(true);
      expect(fsm.getState()).toBe('closing');
      expect(events).toEqual([{ type: 'close-requested' }]);
    });

    it('is NOT subject to the debounce window', () => {
      // Esc should always fire even immediately after the toggle that opened
      // the overlay, since it expresses explicit user intent.
      const { fsm } = setup({ debounceMs: 10_000 });
      fsm.toggle();
      fsm.commitOpened();
      const accepted = fsm.dismiss();
      expect(accepted).toBe(true);
      expect(fsm.getState()).toBe('closing');
    });

    it('is idempotent while closing', () => {
      const { fsm, events } = setup();
      fsm.toggle();
      fsm.commitOpened();
      fsm.dismiss();
      events.length = 0;
      const accepted = fsm.dismiss();
      expect(accepted).toBe(false);
      expect(fsm.getState()).toBe('closing');
      expect(events).toEqual([]);
    });
  });

  describe('debounce', () => {
    it('ignores re-entry while opening', () => {
      const { fsm, events } = setup();
      fsm.toggle();
      events.length = 0;

      const accepted = fsm.toggle();
      expect(accepted).toBe(false);
      expect(fsm.getState()).toBe('opening');
      expect(events).toEqual([]);
    });

    it('ignores re-entry while closing', () => {
      const { fsm, events, advance } = setup({ debounceMs: 50 });
      fsm.toggle();
      fsm.commitOpened();
      advance(100);
      fsm.toggle();
      events.length = 0;

      const accepted = fsm.toggle();
      expect(accepted).toBe(false);
      expect(fsm.getState()).toBe('closing');
      expect(events).toEqual([]);
    });

    it('ignores rapid re-toggle within the debounce window', () => {
      const { fsm, events, advance } = setup({ debounceMs: 200 });
      fsm.toggle();
      fsm.commitOpened();
      events.length = 0;

      advance(50); // < 200ms
      const accepted = fsm.toggle();
      expect(accepted).toBe(false);
      expect(fsm.getState()).toBe('open');
      expect(events).toEqual([]);
    });

    it('accepts re-toggle once the debounce window has elapsed', () => {
      const { fsm, advance } = setup({ debounceMs: 200 });
      fsm.toggle();
      fsm.commitOpened();
      advance(250);
      const accepted = fsm.toggle();
      expect(accepted).toBe(true);
      expect(fsm.getState()).toBe('closing');
    });
  });

  describe('debounce restart on close', () => {
    function openPastDebounce(debounceMs: number) {
      const env = setup({ debounceMs });
      env.fsm.toggle();
      env.fsm.commitOpened();
      env.advance(debounceMs + 50);
      return env;
    }

    it('rejects a toggle right after commitClosed', () => {
      const { fsm, advance } = openPastDebounce(200);
      fsm.toggle();
      // The close ease lands later than the debounce window of the toggle.
      advance(300);
      fsm.commitClosed();

      advance(10); // < 200ms since the close landed
      expect(fsm.toggle()).toBe(false);
      expect(fsm.getState()).toBe('closed');
    });

    it('accepts a toggle debounceMs after commitClosed', () => {
      const { fsm, advance } = openPastDebounce(200);
      fsm.toggle();
      advance(300);
      fsm.commitClosed();

      advance(200);
      expect(fsm.toggle()).toBe(true);
      expect(fsm.getState()).toBe('opening');
    });

    it('rejects a toggle right after a dismissed close lands with commitClosed', () => {
      const { fsm, advance } = openPastDebounce(200);
      fsm.dismiss();
      advance(300); // the close ease
      fsm.commitClosed();

      advance(10); // < 200ms since the close landed
      expect(fsm.toggle()).toBe(false);
      expect(fsm.getState()).toBe('closed');
    });

    it('accepts a toggle debounceMs after a dismissed close lands with commitClosed', () => {
      const { fsm, advance } = openPastDebounce(200);
      fsm.dismiss();
      advance(300);
      fsm.commitClosed();

      advance(200);
      expect(fsm.toggle()).toBe(true);
      expect(fsm.getState()).toBe('opening');
    });
  });

  describe('abortOpen', () => {
    it('returns opening to closed without emitting an event', () => {
      const { fsm, events } = setup();
      fsm.toggle();
      events.length = 0;

      fsm.abortOpen();

      expect(fsm.getState()).toBe('closed');
      expect(events).toEqual([]);
    });

    it('restarts the debounce window', () => {
      const { fsm, advance } = setup({ debounceMs: 200 });
      fsm.toggle();
      advance(300); // past the window of the toggle that started the open
      fsm.abortOpen();

      advance(10);
      expect(fsm.toggle()).toBe(false);
      expect(fsm.getState()).toBe('closed');

      advance(200);
      expect(fsm.toggle()).toBe(true);
      expect(fsm.getState()).toBe('opening');
    });

    it('is a no-op when closed', () => {
      const { fsm, events } = setup({ debounceMs: 200 });

      fsm.abortOpen();

      expect(fsm.getState()).toBe('closed');
      expect(events).toEqual([]);
      // The debounce window was not started.
      expect(fsm.toggle()).toBe(true);
    });

    it('is a no-op when open', () => {
      const { fsm } = setup();
      fsm.toggle();
      fsm.commitOpened();

      fsm.abortOpen();

      expect(fsm.getState()).toBe('open');
    });

    it('is a no-op when closing', () => {
      const { fsm } = setup();
      fsm.toggle();
      fsm.commitOpened();
      fsm.dismiss();

      fsm.abortOpen();

      expect(fsm.getState()).toBe('closing');
    });
  });

  describe('commit calls', () => {
    it('commitOpened is a no-op outside opening', () => {
      const { fsm, events } = setup();
      fsm.commitOpened();
      expect(fsm.getState()).toBe('closed');
      expect(events).toEqual([]);
    });

    it('commitClosed is a no-op outside closing', () => {
      const { fsm, events } = setup();
      fsm.commitClosed();
      expect(fsm.getState()).toBe('closed');
      expect(events).toEqual([]);
    });
  });

  describe('reset', () => {
    it('forces state back to closed and clears the debounce', () => {
      const { fsm, advance } = setup({ debounceMs: 10_000 });
      fsm.toggle();
      fsm.commitOpened();
      fsm.reset();
      expect(fsm.getState()).toBe('closed');

      // Without reset, this toggle would be debounced; reset clears that.
      advance(1);
      const accepted = fsm.toggle();
      expect(accepted).toBe(true);
    });
  });
});

describe('OverlayStateMachine listener management', () => {
  let fsm: OverlayStateMachine;
  beforeEach(() => {
    fsm = new OverlayStateMachine({ debounceMs: 0, now: () => 0 });
  });

  it('unsubscribe stops further deliveries', () => {
    const received: OverlayEvent[] = [];
    const off = fsm.onEvent((e) => received.push(e));
    fsm.toggle();
    off();
    fsm.commitOpened();
    expect(received).toEqual([{ type: 'open-requested' }]);
  });
});

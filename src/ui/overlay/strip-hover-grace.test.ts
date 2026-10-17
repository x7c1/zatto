import { describe, expect, it } from 'vitest';
import { StripHoverGrace } from './strip-hover-grace.js';
import { FakeTimeout } from './test-fakes.js';

const GRACE_MS = 150;

/** A grace unit wired to a recorded strip, as the window mirror wires it. */
function setup() {
  const timeout = new FakeTimeout();
  const strip = {
    shown: null as readonly number[] | null,
    applied: [] as (readonly number[] | null)[],
  };
  const grace = new StripHoverGrace({
    graceMs: GRACE_MS,
    timeout,
    shown: () => strip.shown,
    apply: (group) => {
      strip.shown = group;
      strip.applied.push(group);
    },
  });
  return { timeout, strip, grace };
}

describe('StripHoverGrace', () => {
  it('shows the first group at once', () => {
    const { timeout, strip, grace } = setup();

    grace.pointerOver([0, 1]);

    expect(strip.shown).toEqual([0, 1]);
    expect(timeout.pendingCount).toBe(0);
  });

  it('does nothing over empty desktop while no strip is shown', () => {
    const { timeout, strip, grace } = setup();

    grace.pointerOver([]);

    expect(strip.applied).toEqual([]);
    expect(timeout.pendingCount).toBe(0);
  });

  it('does not replace the strip with a different group within the grace period', () => {
    const { timeout, strip, grace } = setup();
    grace.pointerOver([0, 1]);

    grace.pointerOver([2]);
    timeout.advance(GRACE_MS - 1);

    expect(strip.shown).toEqual([0, 1]);
    expect(timeout.pendingCount).toBe(1);
  });

  it('replaces the strip with a different group still under the pointer when the grace period ends', () => {
    const { timeout, strip, grace } = setup();
    grace.pointerOver([0, 1]);

    grace.pointerOver([2]);
    timeout.advance(GRACE_MS / 2);
    // Further motion within the same group lets the period run on.
    grace.pointerOver([2]);
    timeout.advance(GRACE_MS / 2);

    expect(strip.shown).toEqual([2]);
    expect(timeout.pendingCount).toBe(0);
  });

  it('hides the strip over empty desktop only after the grace period', () => {
    const { timeout, strip, grace } = setup();
    grace.pointerOver([0, 1]);

    grace.pointerOver([]);
    timeout.advance(GRACE_MS - 1);
    expect(strip.shown).toEqual([0, 1]);

    timeout.advance(1);
    expect(strip.shown).toBeNull();
  });

  it('keeps the current strip when the pointer reaches it within the grace period', () => {
    const { timeout, strip, grace } = setup();
    grace.pointerOver([0, 1]);

    grace.pointerOver([2]);
    timeout.advance(GRACE_MS / 2);
    grace.pointerOnStrip();
    timeout.advance(GRACE_MS);

    expect(strip.shown).toEqual([0, 1]);
    expect(strip.applied).toEqual([[0, 1]]);
    expect(timeout.pendingCount).toBe(0);
  });

  it('keeps the current strip when the pointer crosses a gap on its way to it', () => {
    const { timeout, strip, grace } = setup();
    grace.pointerOver([0, 1]);

    grace.pointerOver([]);
    timeout.advance(GRACE_MS / 2);
    grace.pointerOnStrip();
    timeout.advance(GRACE_MS);

    expect(strip.shown).toEqual([0, 1]);
  });

  it('restarts the grace period for each new target the pointer crosses', () => {
    const { timeout, strip, grace } = setup();
    grace.pointerOver([0, 1]);

    grace.pointerOver([2]);
    timeout.advance(GRACE_MS - 1);
    grace.pointerOver([3]);
    timeout.advance(GRACE_MS - 1);
    expect(strip.shown).toEqual([0, 1]);

    timeout.advance(1);
    expect(strip.applied).toEqual([[0, 1], [3]]);
  });

  it('cancels a pending change when the pointer returns to the group shown', () => {
    const { timeout, strip, grace } = setup();
    grace.pointerOver([0, 1]);

    grace.pointerOver([2]);
    grace.pointerOver([0, 1]);
    timeout.advance(GRACE_MS);

    expect(strip.applied).toEqual([[0, 1]]);
    expect(timeout.pendingCount).toBe(0);
  });

  it('drops a pending change when cancelled, as on closing the overlay', () => {
    const { timeout, strip, grace } = setup();
    grace.pointerOver([0, 1]);
    grace.pointerOver([]);

    grace.cancel();
    timeout.advance(GRACE_MS);

    expect(strip.applied).toEqual([[0, 1]]);
    expect(timeout.pendingCount).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { ScrollStepper } from './scroll-stepper.js';

describe('ScrollStepper', () => {
  it('emits one step per whole unit of accumulated delta', () => {
    const stepper = new ScrollStepper();

    expect(stepper.push(0.4)).toEqual([]);
    expect(stepper.push(0.4)).toEqual([]);
    expect(stepper.push(0.4)).toEqual(['down']);
    // 0.2 left over, so 0.8 more completes the next step.
    expect(stepper.push(0.8)).toEqual(['down']);
  });

  it('maps a negative delta to up', () => {
    const stepper = new ScrollStepper();

    expect(stepper.push(-1)).toEqual(['up']);
  });

  it('emits several steps for a delta spanning several units', () => {
    const stepper = new ScrollStepper();

    expect(stepper.push(2.5)).toEqual(['down', 'down']);
    expect(stepper.push(0.5)).toEqual(['down']);
  });

  it('resets the remainder when the sign changes', () => {
    const stepper = new ScrollStepper();

    expect(stepper.push(0.9)).toEqual([]);
    // Without the reset this would cancel out against the 0.9.
    expect(stepper.push(-0.5)).toEqual([]);
    expect(stepper.push(-0.5)).toEqual(['up']);
    // And back: the leftover upward motion does not delay the next down.
    expect(stepper.push(-0.9)).toEqual([]);
    expect(stepper.push(1)).toEqual(['down']);
  });

  it('ignores zero and non-finite deltas without losing the remainder', () => {
    const stepper = new ScrollStepper();

    expect(stepper.push(0.6)).toEqual([]);
    expect(stepper.push(0)).toEqual([]);
    expect(stepper.push(Number.NaN)).toEqual([]);
    expect(stepper.push(0.4)).toEqual(['down']);
  });

  it('reset() drops a partial step', () => {
    const stepper = new ScrollStepper();
    stepper.push(0.9);

    stepper.reset();

    expect(stepper.push(0.5)).toEqual([]);
  });

  it('finish() drops the remainder a finished gesture left over', () => {
    const stepper = new ScrollStepper();
    expect(stepper.push(1.7)).toEqual(['down']);

    stepper.finish();

    // Without the reset, 0.7 + 0.4 would complete a step.
    expect(stepper.push(0.4)).toEqual([]);
    expect(stepper.push(0.6)).toEqual(['down']);
  });
});

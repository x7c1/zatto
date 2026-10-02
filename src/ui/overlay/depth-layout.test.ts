import { describe, expect, it } from 'vitest';
import { computeDepthLayout } from './depth-layout.js';

const tuning = { zStepPx: 80, opacity: 0.85 };

describe('computeDepthLayout', () => {
  it('returns an empty layout for no clones', () => {
    expect(computeDepthLayout(0, tuning)).toEqual([]);
  });

  it('places a single clone at Z translation 0', () => {
    expect(computeDepthLayout(1, tuning).map((c) => c.translationZ)).toEqual([0]);
  });

  it('keeps the topmost (last) clone at Z 0 and pushes each deeper one zStepPx further back', () => {
    // toEqual distinguishes -0 from 0, so this also pins the topmost entry to +0.
    expect(computeDepthLayout(4, tuning).map((c) => c.translationZ)).toEqual([-240, -160, -80, 0]);
  });

  it('gives every clone the same integer opacity', () => {
    const expected = Math.round(0.85 * 255);
    expect(computeDepthLayout(5, tuning).map((c) => c.opacity)).toEqual(Array(5).fill(expected));
  });
});

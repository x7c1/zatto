/**
 * Pure geometry for the overlay's depth view.
 *
 * The depth view keeps every window at its own x, y and turns the
 * stacking order into depth: the topmost window sits at Z = 0 and each
 * window below it is pushed `zStepPx` further back (negative Z, away
 * from the viewer). The clone container is tilted once around its Y
 * axis by `tiltDegrees`, so these Z offsets become visible under the
 * stage's perspective projection.
 *
 * Opacity model: constant. Every clone gets the same opacity. Each
 * translucent layer in front of a window already attenuates it, so
 * deeper windows fade out naturally as more windows cover them; an
 * additional per-depth falloff would make the covered windows harder
 * to recognise, which is the opposite of what the depth view is for.
 * A single value is also one knob to tune instead of two.
 *
 * The values in {@link DEPTH_VIEW_TUNING} are starting points for the
 * first on-hardware check, not settled choices.
 *
 * No `gi://` imports: this module is unit-tested under vitest.
 */

export interface DepthViewTuning {
  /** Y-axis rotation applied once to the clone container, in degrees. */
  readonly tiltDegrees: number;
  /** Distance between adjacent stacking levels along Z, in px. */
  readonly zStepPx: number;
  /** Opacity of every clone, as a fraction in 0..1. */
  readonly opacity: number;
}

export const DEPTH_VIEW_TUNING: DepthViewTuning = {
  tiltDegrees: 15,
  zStepPx: 80,
  opacity: 0.85,
};

export interface CloneDepth {
  /** Clutter `translation_z`: 0 for the topmost clone, negative behind it. */
  readonly translationZ: number;
  /** Clutter actor opacity, an integer in 0..255. */
  readonly opacity: number;
}

/**
 * Compute the depth placement for `count` clones given in bottom-to-top
 * stacking order (the order `global.get_window_actors()` returns).
 * Entry `i` of the result belongs to stacking index `i`; the last entry
 * is the topmost window.
 */
export function computeDepthLayout(
  count: number,
  tuning: Pick<DepthViewTuning, 'zStepPx' | 'opacity'>
): CloneDepth[] {
  const opacity = Math.round(tuning.opacity * 255);
  const out: CloneDepth[] = [];
  for (let i = 0; i < count; i++) {
    const depth = count - 1 - i;
    out.push({
      // Special-case depth 0 so the topmost clone gets +0, not -0.
      translationZ: depth === 0 ? 0 : -depth * tuning.zStepPx,
      opacity,
    });
  }
  return out;
}

/**
 * Pure geometry for the overlay's depth view.
 *
 * The depth view keeps every window at its own x, y and turns the
 * stacking order into depth: the topmost window sits at Z = 0 and each
 * window below it is pushed `zStepPx` further back, away from the
 * viewer. The plane of windows is then viewed from a slight angle,
 * tilted by `tiltDegrees` around its vertical axis.
 *
 * Projection: orthographic, not perspective. The stage's own projection
 * is a perspective one, under which a rotated plane gets a near edge
 * that grows and a far edge that shrinks, and the near edge of a
 * full-width container ends up off-screen. Windows should keep a
 * constant size regardless of depth, so instead of rotating actors in
 * 3D this module projects the tilted plane itself and hands back a 2D
 * affine transform. For a rotation by `t` around the vertical axis, an
 * orthographic view maps a point `(x, z)` to `x·cos t + z·sin t`: the
 * plane is squashed horizontally by `cos t`, and each clone's depth
 * becomes a horizontal offset of `z·sin t`. The squash is applied once
 * as the container's horizontal scale, and the offset is applied to
 * each clone's position in container coordinates (hence `z·tan t`,
 * which the container's `cos t` scale turns back into `z·sin t`).
 *
 * Sign convention: a positive `tiltDegrees` makes the right side of the
 * plane recede, so deeper windows peek out on the left, next to the
 * bottom-left hot corner. Negate it to make the right side the near
 * side.
 *
 * Fit: the projected bounding box of all clones is scaled down
 * uniformly if it is larger than the monitor, then translated as little
 * as possible so it lies inside the monitor. The squash is centred on
 * the monitor, so a window that fills the screen stays centred. Nothing
 * is enlarged.
 *
 * Opacity model: constant. Every clone gets the same opacity. Each
 * translucent layer in front of a window already attenuates it, so
 * deeper windows fade out naturally as more windows cover them; an
 * additional per-depth falloff would make the covered windows harder
 * to recognise, which is the opposite of what the depth view is for.
 * A single value is also one knob to tune instead of two.
 *
 * The values in {@link DEPTH_VIEW_TUNING} are starting points for the
 * on-hardware checks, not settled choices.
 *
 * No `gi://` imports: this module is unit-tested under vitest.
 */

export interface DepthViewTuning {
  /** Rotation of the window plane around its vertical axis, in degrees. */
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

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface CloneDepth {
  /**
   * Horizontal offset to add to the clone's x in container coordinates:
   * 0 for the topmost clone, negative (towards the near side) behind it.
   */
  readonly offsetX: number;
  /** Clutter actor opacity, an integer in 0..255. */
  readonly opacity: number;
}

export interface ContainerTransform {
  /** Horizontal scale of the clone container: fit scale times `cos(tilt)`. */
  readonly scaleX: number;
  /** Vertical scale of the clone container: the fit scale alone. */
  readonly scaleY: number;
  /** Horizontal translation of the clone container, in monitor px. */
  readonly translationX: number;
  /** Vertical translation of the clone container, in monitor px. */
  readonly translationY: number;
}

export interface DepthViewLayout {
  /** One entry per input frame, in the same (bottom-to-top) order. */
  readonly clones: CloneDepth[];
  /** Transform to apply once to the container, with its pivot at (0, 0). */
  readonly container: ContainerTransform;
}

const IDENTITY: ContainerTransform = {
  scaleX: 1,
  scaleY: 1,
  translationX: 0,
  translationY: 0,
};

/** Turn -0 into 0 so callers and `toEqual` never see a negative zero. */
function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute the depth view for `frames`, the monitor-relative frame rects
 * of the clones in bottom-to-top stacking order (the order
 * `global.get_window_actors()` returns). Entry `i` of `clones` belongs to
 * frame `i`; the last entry is the topmost window.
 */
export function computeDepthLayout(
  frames: readonly Rect[],
  monitor: Size,
  tuning: DepthViewTuning
): DepthViewLayout {
  const opacity = Math.round(tuning.opacity * 255);
  const tilt = (tuning.tiltDegrees * Math.PI) / 180;
  const cos = Math.cos(tilt);
  const tan = Math.tan(tilt);
  const count = frames.length;

  const clones: CloneDepth[] = frames.map((_frame, i) => {
    const depth = count - 1 - i;
    return {
      offsetX: normalizeZero(-depth * tuning.zStepPx * tan),
      opacity,
    };
  });

  if (count === 0) {
    return { clones, container: IDENTITY };
  }

  // Bounding box of the projected clones before the fit scale and the
  // translation: x is already squashed by cos(tilt), y is untouched.
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  frames.forEach((frame, i) => {
    const left = (frame.x + clones[i].offsetX) * cos;
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, left + frame.width * cos);
    minY = Math.min(minY, frame.y);
    maxY = Math.max(maxY, frame.y + frame.height);
  });

  const fit = Math.min(1, monitor.width / (maxX - minX), monitor.height / (maxY - minY));

  // Preferred placement: squash and scale around the monitor centre, then
  // move only as far as needed to bring the bounding box on screen.
  const preferredX = (monitor.width / 2) * (1 - cos) * fit;
  const preferredY = (monitor.height / 2) * (1 - fit);
  const translationX = clamp(preferredX, -minX * fit, monitor.width - maxX * fit);
  const translationY = clamp(preferredY, -minY * fit, monitor.height - maxY * fit);

  return {
    clones,
    container: {
      scaleX: fit * cos,
      scaleY: fit,
      translationX: normalizeZero(translationX),
      translationY: normalizeZero(translationY),
    },
  };
}

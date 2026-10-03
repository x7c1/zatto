/**
 * Pure geometry for the overlay's depth view.
 *
 * The depth view keeps every window at its own x, y, size and shape and
 * turns the stacking order into depth: the topmost window sits at depth
 * 0 and each window below it is one level further from the viewer.
 *
 * Projection: oblique and parallel, like a drawing of a deck of cards
 * seen from above and to one side. The depth axis is drawn as a line on
 * the screen that points towards the viewer in the direction
 * `depthAxisDegrees`, measured clockwise from the positive x axis (screen
 * y grows downwards), so 45 means the bottom-right is the near side. The
 * topmost clone stays where its window is; every deeper clone is moved
 * `depthStepPx` per level in the opposite direction, away from the
 * viewer, so its edges peek out beside the windows in front of it.
 * Nothing is rotated or foreshortened: a parallel projection keeps every
 * window the size and shape it has on the desktop, and the stage's
 * perspective projection is not involved because no actor leaves the
 * z = 0 plane.
 *
 * Fit: the bounding box of all offset clones is scaled down uniformly
 * if it is larger than the area the clones must fit into (the work
 * area). Nothing is enlarged. It is then placed so that its centre
 * lands on the centre of the windows' own bounding box, and moved only
 * as far as needed to stay inside the area. The depth offsets all point
 * the same way, so without this the stack would drift towards the far
 * side; with it, a stack of maximised windows ends up centred.
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
  /**
   * Direction on screen in which the depth axis points towards the
   * viewer, in degrees clockwise from the positive x axis.
   */
  readonly depthAxisDegrees: number;
  /** On-screen distance between adjacent stacking levels, in px. */
  readonly depthStepPx: number;
  /** Opacity of every clone, as a fraction in 0..1. */
  readonly opacity: number;
  /**
   * Opacity of the clone the focus sits on while cycling, as a fraction
   * in 0..1. Above {@link opacity} so the focused window stands out, but
   * below 1 so what lies behind it still shows through a little. Not an
   * input to {@link computeDepthLayout}.
   */
  readonly focusedOpacity: number;
  /**
   * Duration of the ease between the desktop and the depth view, in ms.
   * Not an input to {@link computeDepthLayout}; it lives here so all the
   * depth view's knobs sit in one place. 250 ms matches gnome-shell's
   * Activities Overview.
   */
  readonly transitionMs: number;
  /**
   * Duration of the opacity ease when the scroll wheel moves the focus
   * through the windows under the cursor, in ms. Shorter than
   * {@link transitionMs} because only one or two clones fade. Not an
   * input to {@link computeDepthLayout} either.
   */
  readonly cycleMs: number;
}

export const DEPTH_VIEW_TUNING: DepthViewTuning = {
  depthAxisDegrees: 45,
  depthStepPx: 32,
  opacity: 0.8,
  focusedOpacity: 225 / 255,
  transitionMs: 250,
  cycleMs: 150,
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
  /** Offset to add to the clone's x in container coordinates; 0 for the topmost clone. */
  readonly offsetX: number;
  /** Offset to add to the clone's y in container coordinates; 0 for the topmost clone. */
  readonly offsetY: number;
  /** Clutter actor opacity, an integer in 0..255. */
  readonly opacity: number;
}

export interface ContainerTransform {
  /** Uniform scale of the clone container, 1 unless the clones do not fit. */
  readonly scale: number;
  /** Horizontal translation of the clone container, in area px. */
  readonly translationX: number;
  /** Vertical translation of the clone container, in area px. */
  readonly translationY: number;
}

export interface DepthViewLayout {
  /** One entry per input frame, in the same (bottom-to-top) order. */
  readonly clones: CloneDepth[];
  /** Transform to apply once to the container, with its pivot at (0, 0). */
  readonly container: ContainerTransform;
}

const IDENTITY: ContainerTransform = {
  scale: 1,
  translationX: 0,
  translationY: 0,
};

/** Turn -0 into 0 so callers and `toEqual` never see a negative zero. */
function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function boundsOf(rects: readonly Rect[]): Bounds {
  return {
    minX: Math.min(...rects.map((r) => r.x)),
    maxX: Math.max(...rects.map((r) => r.x + r.width)),
    minY: Math.min(...rects.map((r) => r.y)),
    maxY: Math.max(...rects.map((r) => r.y + r.height)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute the depth view for `frames`, the frame rects of the clones
 * relative to `area` (the area they must fit into, i.e. the work area),
 * in bottom-to-top stacking order (the order
 * `global.get_window_actors()` returns). Entry `i` of `clones` belongs to
 * frame `i`; the last entry is the topmost window.
 */
export function computeDepthLayout(
  frames: readonly Rect[],
  area: Size,
  tuning: DepthViewTuning
): DepthViewLayout {
  const opacity = Math.round(tuning.opacity * 255);
  const axis = (tuning.depthAxisDegrees * Math.PI) / 180;
  // Away from the viewer: the opposite of the depth axis direction.
  const stepX = -tuning.depthStepPx * Math.cos(axis);
  const stepY = -tuning.depthStepPx * Math.sin(axis);
  const count = frames.length;

  const clones: CloneDepth[] = frames.map((_frame, i) => {
    const depth = count - 1 - i;
    return {
      offsetX: normalizeZero(depth * stepX),
      offsetY: normalizeZero(depth * stepY),
      opacity,
    };
  });

  if (count === 0) {
    return { clones, container: IDENTITY };
  }

  // Bounding boxes of the windows as they are and of the offset clones,
  // before the fit scale and the translation.
  const windows = boundsOf(frames.map((frame) => frame));
  const { minX, maxX, minY, maxY } = boundsOf(
    frames.map((frame, i) => ({
      ...frame,
      x: frame.x + clones[i].offsetX,
      y: frame.y + clones[i].offsetY,
    }))
  );

  const scale = Math.min(1, area.width / (maxX - minX), area.height / (maxY - minY));

  // Preferred placement: the offset stack's centre on the windows' own
  // centre, then move only as far as needed to stay inside the area.
  const preferredX = (windows.minX + windows.maxX) / 2 - ((minX + maxX) / 2) * scale;
  const preferredY = (windows.minY + windows.maxY) / 2 - ((minY + maxY) / 2) * scale;
  const translationX = clamp(preferredX, -minX * scale, area.width - maxX * scale);
  const translationY = clamp(preferredY, -minY * scale, area.height - maxY * scale);

  return {
    clones,
    container: {
      scale,
      translationX: normalizeZero(translationX),
      translationY: normalizeZero(translationY),
    },
  };
}

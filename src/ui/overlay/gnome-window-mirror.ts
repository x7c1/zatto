/**
 * GNOME Shell production implementation of {@link WindowMirrorPort}.
 *
 * Enumerates every eligible top-level window and mirrors each one into
 * the overlay as a reactive clone. Each clone starts exactly on its
 * window actor's on-screen rect (the buffer rect, relative to the primary
 * monitor's work area), fully opaque, so it covers the real window the
 * controller hides right after mounting. It then eases into the depth
 * view: the stacking order is rendered as depth under a parallel oblique
 * projection, each clone offset along the depth axis by how many windows
 * sit above it and drawn translucent, and the whole set scaled down and
 * shifted only if needed to stay inside the work area, between the top
 * bar and the dock (see `depth-layout.ts` for the geometry and tuning).
 * Closing eases everything back onto the windows' rects, so the real
 * windows can reappear under clones that cover them exactly.
 * Clicking a clone activates its window.
 *
 * Cycling: while the depth view is up, {@link GnomeWindowMirror.cycleAt}
 * moves a single focus through the windows drawn under the cursor. The
 * layout computed at mount stays as it is for as long as the overlay is
 * open: no clone moves or resizes and the container transform does not
 * change. The focused clone eases to full opacity and is raised to the
 * top of the container's children (Clutter paints in child order, so an
 * opaque clone would otherwise still be covered by the translucent ones
 * in front of it); the previously focused clone eases back to the layout
 * opacity and returns to its mount position among the children. The real
 * stacking order is never touched: closing first puts the children back
 * in mount order (with an activated clone on top), so the real windows
 * reappear under clones stacked the way the windows are.
 *
 * Cycle strip: {@link GnomeWindowMirror.hoverAt} shows the windows drawn
 * under the pointer in a {@link CycleStrip} and keeps that group as the
 * hover group; scrolling on the strip cycles the hover group rather than
 * the clones beneath it, and a thumbnail click activates its window like a
 * click on its clone. When the strip appears and goes away is specified on
 * {@link WindowMirrorPort.hoverAt}.
 *
 * Three Mutter / Clutter API points this mirror sits on top of:
 *
 *   1. `global.get_window_actors()` — enumerate other apps' window actors.
 *   2. `new Clutter.Clone({ source: actor })` — mirror an actor live into
 *      our overlay's scene graph.
 *   3. `meta_window.activate(global.get_current_time())` — raise the
 *      mirrored window when its clone is clicked.
 *
 * Eligibility filter: `NORMAL && !minimized && meta_window != null`. The
 * dimmer and the `HotCornerTrigger` are `St.Widget`s and do not appear in
 * `global.get_window_actors()`, so the overlay never clones itself.
 */

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import type St from 'gi://St';
import type { ActorEaseParams } from '../../libs/shell/actor-ease.js';
import { shouldAnimate } from '../../libs/shell/animations.js';
import { primaryWorkArea } from '../../libs/shell/work-area.js';
import type { CycleStrip, CycleStripMember } from './cycle-strip.js';
import {
  type CycleDirection,
  cycleFocus,
  focusWithin,
  type Point,
  windowsUnder,
} from './depth-cycle.js';
import {
  computeDepthLayout,
  DEPTH_VIEW_TUNING,
  type DepthViewLayout,
  type Rect,
} from './depth-layout.js';
import type { UnmountOptions, WindowMirrorPort, WindowMirrorSnapshot } from './ports.js';

const EASE_MODE = Clutter.AnimationMode.EASE_OUT_QUAD;

/** A clone we mounted plus the bookkeeping we need to tear it down cleanly. */
interface MountedClone {
  readonly clone: Clutter.Clone;
  readonly win: Meta.Window;
  /** Work-area-relative buffer rect at mount time; the close target fallback. */
  readonly rect: Rect;
  /** Work-area-relative frame rect at mount time; what the layout and hit-testing use. */
  readonly frame: Rect;
  readonly clickHandlerId: number;
  /** The window actor the clone mirrors; the strip clones it too. */
  readonly source: Meta.WindowActor;
}

export class GnomeWindowMirror implements WindowMirrorPort {
  private clones: MountedClone[] = [];
  private lastActivatedAt: number | null = null;
  private lastCycledAt: number | null = null;
  /** Origin of the work area the clones were laid out in. */
  private workAreaOrigin = { x: 0, y: 0 };
  /**
   * The layout computed at mount, for the clones in mount (bottom-to-top)
   * order. It does not change while the overlay is open; cycling
   * hit-tests against it.
   */
  private layout: DepthViewLayout | null = null;
  /** Index into {@link clones} of the focused clone, or `null`. */
  private focused: number | null = null;
  /** The clone whose click activated its window, painted on top while closing. */
  private activatedClone: Clutter.Clone | null = null;
  /**
   * The group of windows the strip shows ({@link windowsUnder} order), or
   * `null` while it is hidden. Scrolling on the strip cycles this group.
   */
  private hoverGroup: number[] | null = null;
  /** The `onActivated` of the current mount, run by a thumbnail click too. */
  private onActivated: (() => void) | null = null;
  /** Whether a close ease has started; the focus no longer moves. */
  private closing = false;
  /** `onDone` callbacks of animated closes whose ease has not landed yet. */
  private pendingDone: (() => void)[] = [];
  /**
   * Bumped whenever a close ease starts or the clones are torn down, so
   * the callbacks of a superseded ease become no-ops.
   */
  private generation = 0;

  constructor(
    /**
     * Callback that returns the parent the clones should be attached to.
     * The overlay actor owns the container; passing a getter (rather than
     * the actor itself) lets the overlay defer creating its scene graph
     * until `mount()` time and avoids holding a stale reference across
     * teardown.
     */
    private readonly getContainer: () => St.Widget | null,
    /** The strip of thumbnails of the windows under the pointer. */
    private readonly strip: CycleStrip
  ) {}

  mount(onActivated: () => void): boolean {
    if (this.clones.length > 0 || this.pendingDone.length > 0) {
      // Defensive: a previous mount() left clones attached, or its close
      // ease is still in flight. Tear them down now so no window is
      // mirrored twice and the pending close completes.
      this.unmount({ immediate: true });
    }

    const container = this.getContainer();
    if (container === null) {
      console.warn('[Zatto] GnomeWindowMirror.mount: no clone container available');
      return false;
    }

    const workArea = primaryWorkArea();
    if (workArea === null) {
      console.warn('[Zatto] GnomeWindowMirror.mount: no primary monitor available');
      return false;
    }
    this.workAreaOrigin = { x: workArea.x, y: workArea.y };
    this.activatedClone = null;
    this.closing = false;
    this.focused = null;
    this.hoverGroup = null;
    this.strip.destroy();
    this.onActivated = onActivated;

    // Bottom-to-top, as `global.get_window_actors()` returns them. Clutter
    // paints children in insertion order and does not depth-sort, so the
    // topmost window must be added last.
    // The layout works on frame rects (the visible window), but each clone
    // is placed on the buffer rect: a `Clutter.Clone` scales its source to
    // its own size, and the window actor spans the buffer rect, which
    // includes client-side shadows and invisible borders. Sizing a clone
    // to the frame rect would squash it and make the swap with the real
    // window visible. A window may extend outside the work area (e.g.
    // under an auto-hidden dock); its clone then starts outside the
    // container, which does not clip, and eases in.
    const entries = this.collectEligible()
      .map(({ actor, win }) => ({
        actor,
        win,
        frame: this.frameRectOf(win),
        rect: this.bufferRectOf(win),
      }))
      // Mutter occasionally hands back 0x0 mid-resize. Skip rather than
      // mount an invisible-but-reactive clone.
      .filter(({ frame, rect }) => isNonEmpty(frame) && isNonEmpty(rect));
    const layout = computeDepthLayout(
      entries.map(({ frame }) => frame),
      { width: workArea.width, height: workArea.height },
      DEPTH_VIEW_TUNING
    );
    this.layout = layout;
    const animate = shouldAnimate();

    // Start from the desktop: an untransformed container, every clone on
    // its window actor's rect and fully opaque.
    container.remove_all_transitions();
    container.set_pivot_point(0, 0);
    container.set_scale(1, 1);
    container.set_translation(0, 0, 0);

    entries.forEach(({ actor, win, rect, frame }, index) => {
      const clone = new Clutter.Clone({
        source: actor,
        reactive: true,
      });
      clone.set_position(rect.x, rect.y);
      clone.set_size(rect.width, rect.height);
      clone.opacity = 255;

      const clickHandlerId = clone.connect('button-press-event', () => {
        this.activateClone(clone, win);
        return Clutter.EVENT_STOP;
      });

      container.add_child(clone);
      this.clones.push({ clone, win, rect, frame, clickHandlerId, source: actor });

      const placement = layout.clones[index];
      const target = {
        x: rect.x + (placement?.offsetX ?? 0),
        y: rect.y + (placement?.offsetY ?? 0),
        opacity: placement?.opacity ?? 255,
      };
      if (animate) {
        clone.ease({ ...target, duration: DEPTH_VIEW_TUNING.transitionMs, mode: EASE_MODE });
      } else {
        clone.set_position(target.x, target.y);
        clone.opacity = target.opacity;
      }
    });

    // Fit once, on the container, so every window keeps its x, y
    // relationship: the scale and shift are identity unless the offset
    // clones would leave the work area.
    const { scale, translationX, translationY } = layout.container;
    if (animate) {
      container.ease({
        scale_x: scale,
        scale_y: scale,
        translation_x: translationX,
        translation_y: translationY,
        duration: DEPTH_VIEW_TUNING.transitionMs,
        mode: EASE_MODE,
      });
    } else {
      container.set_scale(scale, scale);
      container.set_translation(translationX, translationY, 0);
    }

    return this.clones.length > 0;
  }

  cycleAt(point: Point, direction: CycleDirection): boolean {
    const container = this.getContainer();
    const layout = this.layout;
    if (container === null || layout === null || this.clones.length === 0 || this.closing) {
      return false;
    }

    // The strip is drawn over the clones, so scrolling on it cycles the
    // group it shows, not the windows beneath it.
    const onStrip = this.strip.covers(this.toWorkArea(point));
    const group = onStrip ? this.hoverGroup : this.groupAt(point, layout);
    if (group === null || group.length < 2) {
      return false;
    }
    const next = cycleFocus(group, this.focused, direction);
    if (next === this.focused) {
      return false;
    }

    const animate = shouldAnimate();
    const setOpacity = (clone: Clutter.Clone, opacity: number) => {
      if (animate) {
        clone.ease({ opacity, duration: DEPTH_VIEW_TUNING.cycleMs, mode: EASE_MODE });
      } else {
        clone.remove_all_transitions();
        clone.opacity = opacity;
      }
    };

    const previous = this.focused;
    if (previous !== null) {
      const { clone } = this.clones[previous];
      this.restoreMountPosition(container, previous);
      setOpacity(clone, layout.clones[previous]?.opacity ?? 255);
    }
    const { clone } = this.clones[next];
    container.set_child_above_sibling(clone, null);
    setOpacity(clone, 255);

    this.focused = next;
    this.lastCycledAt = Date.now();
    // Normally the strip already shows this group, since the pointer had
    // to move here (or is on the strip); if no motion was reported yet,
    // show it now. The highlight is computed against the hover group
    // itself, the array the strip was built from, so it cannot drift.
    const shown = this.hoverGroup;
    if (shown !== null && sameMembers(shown, group)) {
      this.strip.setHighlight(focusWithin(shown, next));
    } else {
      this.showStrip(group);
    }
    return true;
  }

  hoverAt(point: Point): void {
    const layout = this.layout;
    if (layout === null || this.clones.length === 0 || this.closing) {
      return;
    }
    // The strip is drawn over the clones, so a pointer on it is not on the
    // windows beneath it: keep the strip as it is, or it would be rebuilt
    // for those windows as the pointer reaches a thumbnail.
    if (this.strip.covers(this.toWorkArea(point))) {
      return;
    }
    // Hovering never hides the strip: on its way down to the strip the
    // pointer crosses empty spots, and the strip must still be there when
    // it arrives. Any window under the pointer, alone or in an overlap,
    // replaces what the strip shows, so the strip always names what a
    // click or Enter would pick here.
    const group = this.groupAt(point, layout);
    if (group.length === 0) {
      return;
    }
    if (this.hoverGroup !== null && sameMembers(this.hoverGroup, group)) {
      return;
    }
    this.showStrip(group);
  }

  unmount(options: UnmountOptions = {}): void {
    const container = this.getContainer();
    if (options.immediate === true || container === null || !shouldAnimate()) {
      this.teardown();
      options.onDone?.();
      return;
    }

    if (options.onDone !== undefined) {
      this.pendingDone.push(options.onDone);
    }
    // Supersede any ease in flight: its callbacks fire (unfinished) when
    // the transitions are removed below and must not tear anything down.
    const generation = ++this.generation;
    this.closing = true;
    this.hoverGroup = null;
    this.strip.hide();
    container.remove_all_transitions();
    for (const { clone } of this.clones) {
      clone.remove_all_transitions();
    }

    // Undo the focus's raise before the clones land: paint them in the
    // real stacking order, with the activated clone on top, so the real
    // windows reappear under clones stacked the way the windows are and any
    // overlapping region changes owner while the clones are still moving.
    // The ease below takes every clone to full opacity, so the focus's
    // opacity needs no separate undo.
    this.focused = null;
    for (const { clone } of this.clones) {
      container.set_child_above_sibling(clone, null);
    }
    if (this.activatedClone !== null && this.activatedClone.get_parent() === container) {
      container.set_child_above_sibling(this.activatedClone, null);
    }

    // One count per ease plus one for this loop, so a callback that runs
    // synchronously (gnome-shell calls it at once when no transition was
    // needed) cannot land the close before every ease has started.
    let pending = 1;
    const settle = () => {
      pending--;
      if (pending === 0 && generation === this.generation) {
        this.teardown();
      }
    };
    const ease = (actor: Clutter.Actor, props: ActorEaseParams) => {
      pending++;
      actor.ease({
        ...props,
        duration: DEPTH_VIEW_TUNING.transitionMs,
        mode: EASE_MODE,
        onStopped: settle,
      });
    };

    // Ease back from wherever the open ease (or a previous close) left
    // everything: the container to identity, each clone onto its window.
    ease(container, { scale_x: 1, scale_y: 1, translation_x: 0, translation_y: 0 });
    for (const mounted of this.clones) {
      // A click during the close must not activate another window.
      mounted.clone.reactive = false;
      const target = this.closeTargetOf(mounted);
      ease(mounted.clone, { x: target.x, y: target.y, opacity: 255 });
    }
    settle();
  }

  snapshot(): WindowMirrorSnapshot {
    return {
      clonedCount: this.clones.length,
      lastActivatedAt: this.lastActivatedAt,
      lastCycledAt: this.lastCycledAt,
      stripCount: this.strip.count,
    };
  }

  /** The indices of the clones drawn under `point` (stage coordinates), bottom to top. */
  activateAt(point: Point): boolean {
    const layout = this.layout;
    if (layout === null || this.clones.length === 0 || this.closing) {
      return false;
    }
    let index = this.focused;
    if (index === null) {
      // No focus yet: the window a click here would raise, the frontmost
      // one drawn under the point (or shown frontmost by the strip).
      const onStrip = this.strip.covers(this.toWorkArea(point));
      const group = onStrip ? this.hoverGroup : this.groupAt(point, layout);
      if (group === null || group.length === 0) {
        return false;
      }
      index = group[group.length - 1];
    }
    const mounted = this.clones[index];
    if (mounted === undefined) {
      return false;
    }
    this.activateClone(mounted.clone, mounted.win);
    return true;
  }

  private groupAt(point: Point, layout: DepthViewLayout): number[] {
    return windowsUnder(
      this.toWorkArea(point),
      this.clones.map(({ frame }) => frame),
      layout
    );
  }

  /** `point` (stage coordinates) relative to the mounted work area. */
  private toWorkArea(point: Point): Point {
    return { x: point.x - this.workAreaOrigin.x, y: point.y - this.workAreaOrigin.y };
  }

  /**
   * Show `group` ({@link windowsUnder} order) in the strip, front to back,
   * highlighting the focused member, and remember it as the hover group.
   */
  private showStrip(group: number[]): void {
    this.hoverGroup = group;
    const members: CycleStripMember[] = [...group].reverse().map((index) => {
      const { clone, win, rect, source } = this.clones[index];
      return {
        actor: source,
        size: { width: rect.width, height: rect.height },
        win,
        onActivate: () => this.activateClone(clone, win),
      };
    });
    this.strip.show(members, focusWithin(group, this.focused));
  }

  /**
   * Raise `win` and close the overlay; `clone` is painted on top while the
   * clones ease back, matching the stacking the real windows will have
   * when they reappear.
   */
  private activateClone(clone: Clutter.Clone, win: Meta.Window): void {
    if (this.closing) {
      return;
    }
    this.activatedClone = clone;
    this.activateWindow(win);
    this.onActivated?.();
  }

  /**
   * Put the clone at `index` back at its mount position among the
   * container's children: directly above the nearest clone below it in
   * mount order, or at the bottom if there is none. Every other clone is
   * at its mount position, since at most one clone is ever raised.
   */
  private restoreMountPosition(container: St.Widget, index: number): void {
    const { clone } = this.clones[index];
    const below = index > 0 ? this.clones[index - 1].clone : null;
    if (below === null) {
      container.set_child_below_sibling(clone, null);
    } else {
      container.set_child_above_sibling(clone, below);
    }
  }

  /**
   * Synchronously remove every clone, reset the container to identity,
   * and complete every close still waiting for its ease.
   */
  private teardown(): void {
    this.generation++;
    const container = this.getContainer();
    if (container !== null) {
      container.remove_all_transitions();
      container.set_scale(1, 1);
      container.set_translation(0, 0, 0);
    }
    for (const mounted of this.clones) {
      this.disposeClone(mounted);
    }
    this.clones = [];
    this.layout = null;
    this.focused = null;
    this.activatedClone = null;
    this.closing = false;
    this.hoverGroup = null;
    this.onActivated = null;
    this.strip.destroy();

    const done = this.pendingDone;
    this.pendingDone = [];
    for (const onDone of done) {
      onDone();
    }
  }

  /** Work-area-relative frame rect of `win`: the visible window. */
  private frameRectOf(win: Meta.Window): Rect {
    return this.toWorkAreaRect(win.get_frame_rect());
  }

  /**
   * Work-area-relative buffer rect of `win`: the rect its window actor
   * spans, shadows and invisible borders included.
   */
  private bufferRectOf(win: Meta.Window): Rect {
    return this.toWorkAreaRect(win.get_buffer_rect());
  }

  private toWorkAreaRect(rect: Rect): Rect {
    return {
      x: rect.x - this.workAreaOrigin.x,
      y: rect.y - this.workAreaOrigin.y,
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * Where a clone lands on close: its window's current buffer rect, so the
   * real window reappears exactly under it even if it moved while the
   * overlay was open. Falls back to the rect from mount time if the window
   * is gone or reports a degenerate rect. Only the position eases; the
   * clone keeps the size it was mounted with.
   */
  private closeTargetOf(mounted: MountedClone): Rect {
    try {
      const rect = this.bufferRectOf(mounted.win);
      if (isNonEmpty(rect)) {
        return rect;
      }
    } catch (e) {
      console.warn(`[Zatto] GnomeWindowMirror: buffer rect unavailable on close: ${e}`);
    }
    return mounted.rect;
  }

  /** Walk `global.get_window_actors()` and keep only mirror-worthy entries. */
  private collectEligible(): { actor: Meta.WindowActor; win: Meta.Window }[] {
    const out: { actor: Meta.WindowActor; win: Meta.Window }[] = [];
    for (const actor of global.get_window_actors()) {
      const win = actor.get_meta_window();
      if (win === null) {
        continue;
      }
      if (win.get_window_type() !== Meta.WindowType.NORMAL) {
        continue;
      }
      if (win.minimized) {
        continue;
      }
      out.push({ actor, win });
    }
    return out;
  }

  /**
   * Synchronous tear-down for a single mounted clone: disconnects the
   * click handler, removes the actor from its parent, and destroys it.
   */
  private disposeClone(mounted: MountedClone): void {
    mounted.clone.remove_all_transitions();
    mounted.clone.disconnect(mounted.clickHandlerId);
    const parent = mounted.clone.get_parent();
    if (parent !== null) {
      parent.remove_child(mounted.clone);
    }
    mounted.clone.destroy();
  }

  private activateWindow(win: Meta.Window): void {
    try {
      win.activate(global.get_current_time());
      this.lastActivatedAt = Date.now();
    } catch (e) {
      console.warn(`[Zatto] GnomeWindowMirror.activate failed: ${e}`);
    }
  }
}

function sameMembers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((index, i) => index === b[i]);
}

function isNonEmpty(rect: Rect): boolean {
  return rect.width > 0 && rect.height > 0;
}

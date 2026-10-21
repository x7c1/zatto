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
 * Transient windows: a window's dialogs, modal dialogs and utility windows
 * (see `transient-attachment.ts` for which windows are attached to which
 * parent) are drawn with it, as the Activities Overview does. Each drawn
 * window is a group actor holding its own clone and the clones of its
 * attached transients at their real offsets from it; the group, not the
 * clone, is what moves, fades and is raised, so the transients follow
 * their parent through every ease and the focus. A group with transients
 * is flattened offscreen while translucent, so a dialog does not show its
 * parent through it. Only the parents take depth slots and are hit-tested;
 * a click on a transient's clone acts like a click on its parent's, and
 * activating a parent that has a modal transient activates that one.
 *
 * Cycling: while the depth view is up, {@link GnomeWindowMirror.cycleAt}
 * moves a single focus through the windows drawn under the cursor. The
 * layout computed at mount stays as it is for as long as the overlay is
 * open: no clone moves or resizes and the container transform does not
 * change. The focused clone eases to `focusedOpacity` and is raised to the
 * top of the container's children (Clutter paints in child order, so an
 * raised clone would otherwise still be covered by the ones
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
 * Close button: a {@link DepthCloseButton} sits on the clone of the
 * frontmost window, the one `depth-close.ts` picks from the focus and the
 * pointer. Releasing it after a press on it asks the window (and its
 * attached transients) to close, as the Activities Overview does, and
 * leaves the depth view open. While it is held, it stays on its window;
 * released, it follows the pointer again.
 *
 * Windows that come and go: the mirror watches every window it draws.
 * When one goes, its clone is dropped (a root's group with every transient
 * in it); the other clones stay where they are, the layout is not run
 * again, and the focus moves on as `depth-close.ts` decides. A window
 * created while the depth view is up (a "Save changes?" dialog the close
 * button brought up, for one) is drawn on its parent's clone when
 * `attachLateWindow()` attaches it, by the rule the mount uses. A window
 * that would be a root of its own is not added.
 *
 * Mutter / Clutter API points this mirror sits on top of:
 *
 *   1. `global.get_window_actors()` — enumerate other apps' window actors.
 *   2. `meta_window.get_transient_for()` — the transient relation that
 *      attaches dialogs to their parent.
 *   3. `new Clutter.Clone({ source: actor })` — mirror an actor live into
 *      our overlay's scene graph.
 *   4. `meta_window.activate(global.get_current_time())` — raise the
 *      mirrored window when its clone is clicked.
 *   5. `meta_window.delete(global.get_current_time())` — ask a window to
 *      close from the close button.
 *   6. `display::window-created`, `meta_window::shown` and
 *      `meta_window::unmanaged` — follow the windows that come and go.
 *
 * Eligibility: decided by `attachTransients()` over every window actor
 * with a meta window. The dimmer and the `HotCornerTrigger` are
 * `St.Widget`s and do not appear in `global.get_window_actors()`, so the
 * overlay never clones itself.
 */

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import type St from 'gi://St';
import type { ActorEaseParams } from '../../libs/shell/actor-ease.js';
import { shouldAnimate } from '../../libs/shell/animations.js';
import { primaryWorkArea } from '../../libs/shell/work-area.js';
import type { CycleStrip, CycleStripMember } from './cycle-strip.js';
import {
  type ButtonPointer,
  closeButtonCarrier,
  closeButtonProbe,
  focusAfterClose,
  withoutIndex,
} from './depth-close.js';
import { DepthCloseButton } from './depth-close-button.js';
import {
  type CycleDirection,
  cycleFocus,
  drawnFrame,
  focusWithin,
  type Point,
  sameMembers,
  windowsUnder,
} from './depth-cycle.js';
import {
  computeDepthLayout,
  DEPTH_VIEW_TUNING,
  type DepthViewLayout,
  type Rect,
} from './depth-layout.js';
import type {
  ConsideredWindow,
  TimeoutPort,
  UnmountOptions,
  WindowMirrorPort,
  WindowMirrorSnapshot,
} from './ports.js';
import { StripHoverGrace } from './strip-hover-grace.js';
import {
  type AttachmentOutcome,
  attachLateWindow,
  attachTransients,
  explainAttachment,
  removalOf,
  topmostModal,
  type WindowDescription,
  type WindowKind,
} from './transient-attachment.js';

const EASE_MODE = Clutter.AnimationMode.EASE_OUT_QUAD;

/** A transient window's clone, drawn inside its parent's group. */
interface MountedTransient {
  readonly clone: Clutter.Clone;
  readonly win: Meta.Window;
  readonly desc: WindowDescription;
  readonly clickHandlerId: number;
}

/**
 * A drawn window we mounted plus the bookkeeping we need to tear it down
 * cleanly: its group, its own clone and its attached transients' clones.
 */
interface MountedClone {
  /**
   * The actor that moves, fades and is raised: a group placed on the
   * window's buffer rect, holding the window's clone at its origin and
   * the transients' clones at their offsets from it.
   */
  readonly group: Clutter.Actor;
  readonly clone: Clutter.Clone;
  readonly win: Meta.Window;
  readonly desc: WindowDescription;
  /**
   * The window to activate when this one is picked: its topmost modal
   * transient, if any. Follows the transients as they come and go.
   */
  activateWin: Meta.Window;
  /** Work-area-relative buffer rect at mount time; the close target fallback. */
  readonly rect: Rect;
  /** Work-area-relative frame rect at mount time; what the layout and hit-testing use. */
  readonly frame: Rect;
  readonly clickHandlerId: number;
  /** The window actor the clone mirrors; the strip clones it too. */
  readonly source: Meta.WindowActor;
  /** Bottom to top; a transient created while the overlay is open joins at the top. */
  readonly transients: MountedTransient[];
}

export class GnomeWindowMirror implements WindowMirrorPort {
  private clones: MountedClone[] = [];
  private lastActivatedAt: number | null = null;
  private lastCycledAt: number | null = null;
  /** The windows the last mount considered, for the Inspect snapshot (development builds). */
  private considered: readonly ConsideredWindow[] = [];
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
  /** The group whose click activated its window, painted on top while closing. */
  private activatedGroup: Clutter.Actor | null = null;
  /**
   * The group of windows the strip shows ({@link windowsUnder} order), or
   * `null` while it is hidden. Scrolling on the strip cycles this group.
   */
  private hoverGroup: readonly number[] | null = null;
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
  /** Delays the strip's changes while it is shown; see {@link hoverAt}. */
  private readonly stripGrace: StripHoverGrace;
  /** The close button on the frontmost window's clone. */
  private readonly closeButton: DepthCloseButton;
  /** Index into {@link clones} of the clone carrying the close button, or `null`. */
  private buttonOn: number | null = null;
  /** The last pointer position reported (stage coordinates), or `null` if unknown. */
  private pointer: Point | null = null;
  /** The `display::window-created` handler while clones are mounted. */
  private windowCreatedId: number | null = null;
  /** `shown` handlers of windows created while open that were not drawable yet. */
  private pendingShown = new Map<Meta.Window, number>();
  /** `unmanaged` handlers of the drawn windows, roots and transients. */
  private goneHandlers = new Map<Meta.Window, number>();

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
    private readonly strip: CycleStrip,
    timeout: TimeoutPort
  ) {
    this.closeButton = new DepthCloseButton({
      onClick: () => this.closeCarrier(),
      onRelease: () => this.onCloseButtonReleased(),
    });
    this.stripGrace = new StripHoverGrace({
      graceMs: DEPTH_VIEW_TUNING.stripHoverGraceMs,
      timeout,
      shown: () => this.hoverGroup,
      apply: (group) => {
        if (group === null) {
          this.hideStrip();
        } else {
          this.showStrip(group);
        }
      },
    });
  }

  mount(onActivated: () => void): boolean {
    if (this.clones.length > 0 || this.pendingDone.length > 0) {
      // Defensive: a previous mount() left clones attached, or its close
      // ease is still in flight. Tear them down now so no window is
      // mirrored twice and the pending close completes.
      this.unmount({ immediate: true });
    }
    // A mount that bails out below considers no window; do not leave the
    // previous mount's list in the snapshot as if it were this one's.
    this.considered = [];

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
    this.activatedGroup = null;
    this.closing = false;
    this.focused = null;
    this.stripGrace.cancel();
    this.hoverGroup = null;
    this.strip.destroy();
    this.onActivated = onActivated;

    // Bottom-to-top, as `global.get_window_actors()` returns them. Clutter
    // paints children in insertion order and does not depth-sort, so the
    // topmost window must be added last. Transient windows are folded into
    // their parent's entry and take no depth slot.
    // The layout works on frame rects (the visible window), but each clone
    // is placed on the buffer rect: a `Clutter.Clone` scales its source to
    // its own size, and the window actor spans the buffer rect, which
    // includes client-side shadows and invisible borders. Sizing a clone
    // to the frame rect would squash it and make the swap with the real
    // window visible. A window may extend outside the work area (e.g.
    // under a fixed dock); its clone then starts outside the
    // container, which does not clip, and eases in.
    const all = this.collectWindows();
    const descriptions = all.map(({ desc }) => desc);
    const entries = attachTransients(descriptions)
      .map(({ parent, transients, activate }) => {
        const { actor, win } = all[parent];
        return {
          parent,
          activate,
          actor,
          win,
          desc: all[parent].desc,
          activateWin: all[activate].win,
          frame: this.frameRectOf(win),
          rect: this.bufferRectOf(win),
          transients: transients
            .map((t) => ({
              index: t,
              actor: all[t].actor,
              win: all[t].win,
              desc: all[t].desc,
              rect: this.bufferRectOf(all[t].win),
            }))
            .filter(({ rect }) => isNonEmpty(rect)),
        };
      })
      // Mutter occasionally hands back 0x0 mid-resize. Skip rather than
      // mount an invisible-but-reactive clone.
      .filter(({ frame, rect }) => isNonEmpty(frame) && isNonEmpty(rect));
    this.considered = __DEV__
      ? describeConsidered(
          all,
          explainAttachment(
            descriptions,
            entries.map(({ parent, activate, transients }) => ({
              parent,
              activate,
              transients: transients.map(({ index }) => index),
            }))
          )
        )
      : [];
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

    entries.forEach(({ actor, win, desc, activateWin, rect, frame, transients }, index) => {
      // Clicks on the window's clone or on any of its transients' clones
      // pick this entry; the entry is looked up when the click arrives.
      let mounted: MountedClone | null = null;
      const connectClick = (target: Clutter.Clone) => this.connectClick(target, () => mounted);

      // Until the entry is in `this.clones`, unmount cannot reach the group,
      // so a throw while building it must destroy the group here. Each clone
      // joins the group as soon as it exists, so destroying the group takes
      // every clone (and the click handlers connected on it) with it.
      const group = new Clutter.Actor();
      try {
        group.set_position(rect.x, rect.y);
        group.opacity = 255;
        if (transients.length > 0) {
          // Paint the window and its transients into one buffer while the
          // group is translucent, so a dialog covers its parent instead of
          // letting it show through.
          group.offscreen_redirect = Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY;
        }

        const clone = new Clutter.Clone({ source: actor, reactive: true });
        group.add_child(clone);
        clone.set_position(0, 0);
        clone.set_size(rect.width, rect.height);
        const clickHandlerId = connectClick(clone);

        // Above the window's clone, in stacking order, at their real offset.
        const mountedTransients = transients.map((transient) => {
          const transientClone = new Clutter.Clone({ source: transient.actor, reactive: true });
          group.add_child(transientClone);
          transientClone.set_position(transient.rect.x - rect.x, transient.rect.y - rect.y);
          transientClone.set_size(transient.rect.width, transient.rect.height);
          const transientHandlerId = connectClick(transientClone);
          return {
            clone: transientClone,
            win: transient.win,
            desc: transient.desc,
            clickHandlerId: transientHandlerId,
          };
        });

        container.add_child(group);
        mounted = {
          group,
          clone,
          win,
          desc,
          activateWin,
          rect,
          frame,
          clickHandlerId,
          source: actor,
          transients: mountedTransients,
        };
      } catch (e) {
        group.destroy();
        throw e;
      }
      this.clones.push(mounted);
      this.watchGone(mounted.win, mounted.desc.id);
      for (const transient of mounted.transients) {
        this.watchGone(transient.win, transient.desc.id);
      }

      const placement = layout.clones[index];
      const target = {
        x: rect.x + (placement?.offsetX ?? 0),
        y: rect.y + (placement?.offsetY ?? 0),
        opacity: placement?.opacity ?? 255,
      };
      if (animate) {
        group.ease({ ...target, duration: DEPTH_VIEW_TUNING.transitionMs, mode: EASE_MODE });
      } else {
        group.set_position(target.x, target.y);
        group.opacity = target.opacity;
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

    // A mount that found no window is not torn down before the next one.
    this.disconnectWindowCreated();
    this.windowCreatedId = global.display.connect('window-created', (_display, win) =>
      this.onWindowCreated(win)
    );
    // The button shows on the window under the pointer before it moves.
    const [x, y] = global.get_pointer();
    this.pointer = { x, y };
    this.updateCloseButton();

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
    this.focusOn(next, group, container, layout);
    return true;
  }

  /**
   * Move the focus to the clone at `index`: raise it and ease it to the
   * focused opacity, ease the previously focused clone back and return it
   * to its mount position, and point the strip's highlight at it. `group`
   * is the group the move happened in, so the strip can be shown for it if
   * no motion has reached the strip yet.
   */
  private focusOn(
    index: number,
    group: readonly number[],
    container: St.Widget,
    layout: DepthViewLayout
  ): void {
    const animate = shouldAnimate();
    const setOpacity = (group: Clutter.Actor, opacity: number) => {
      if (animate) {
        group.ease({ opacity, duration: DEPTH_VIEW_TUNING.cycleMs, mode: EASE_MODE });
      } else {
        group.remove_all_transitions();
        group.opacity = opacity;
      }
    };

    const previous = this.focused;
    if (previous !== null) {
      this.restoreMountPosition(container, previous);
      setOpacity(this.clones[previous].group, layout.clones[previous]?.opacity ?? 255);
    }
    const focusedGroup = this.clones[index].group;
    container.set_child_above_sibling(focusedGroup, null);
    setOpacity(focusedGroup, Math.round(DEPTH_VIEW_TUNING.focusedOpacity * 255));

    this.focused = index;
    this.lastCycledAt = Date.now();
    // Normally the strip already shows this group, since the pointer had
    // to move here (or is on the strip); if no motion was reported yet,
    // show it now. The highlight is computed against the hover group
    // itself, the array the strip was built from, so it cannot drift.
    const shown = this.hoverGroup;
    if (shown !== null && sameMembers(shown, group)) {
      this.strip.setHighlight(focusWithin(shown, index));
    } else {
      this.showStrip(group);
    }
    this.updateCloseButton();
  }

  hoverAt(point: Point): void {
    const layout = this.layout;
    if (layout === null || this.clones.length === 0 || this.closing) {
      return;
    }
    this.pointer = point;
    this.updateCloseButton();
    // The strip is drawn over the clones, so a pointer on it is not on the
    // windows beneath it: keep the strip as it is, or it would be rebuilt
    // for those windows as the pointer reaches a thumbnail.
    if (this.strip.covers(this.toWorkArea(point))) {
      this.stripGrace.pointerOnStrip();
      // Pointing at a thumbnail focuses its window, so the pointer can pick
      // along the strip as the wheel does; the background, the gaps and
      // the title band leave the focus alone.
      const position = this.strip.thumbAt(this.toWorkArea(point));
      const shown = this.hoverGroup;
      if (position !== null && shown !== null) {
        const index = shown[shown.length - 1 - position];
        if (index !== undefined && index !== this.focused) {
          const container = this.getContainer();
          if (container !== null) {
            this.focusOn(index, shown, container, layout);
          }
        }
      }
      return;
    }
    // The strip names what a click or Enter would pick here: any window
    // under the pointer, alone or in an overlap, replaces what it shows,
    // and empty desktop under the pointer takes it down, once the pointer
    // has stayed there for the grace period. Until then the strip still
    // shows the previous group, while a click or Enter acts on what is
    // under the pointer.
    this.stripGrace.pointerOver(this.groupAt(point, layout));
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
    this.hideStrip();
    this.hideCloseButton();
    container.remove_all_transitions();
    for (const { group, transients } of this.clones) {
      group.remove_all_transitions();
      for (const { clone } of transients) {
        clone.remove_all_transitions();
      }
    }

    // Undo the focus's raise before the clones land: paint them in the
    // real stacking order, with the activated clone on top, so the real
    // windows reappear under clones stacked the way the windows are and any
    // overlapping region changes owner while the clones are still moving.
    // The ease below takes every clone to full opacity, so the focus's
    // opacity needs no separate undo.
    this.focused = null;
    for (const { group } of this.clones) {
      container.set_child_above_sibling(group, null);
    }
    if (this.activatedGroup !== null && this.activatedGroup.get_parent() === container) {
      container.set_child_above_sibling(this.activatedGroup, null);
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
      ease(mounted.group, { x: target.x, y: target.y, opacity: 255 });
      // Each transient lands on its own window too, in case it moved
      // relative to its parent while the overlay was open.
      for (const transient of mounted.transients) {
        transient.clone.reactive = false;
        const offset = this.transientOffsetOf(transient, target);
        if (offset !== null) {
          ease(transient.clone, offset);
        }
      }
    }
    settle();
  }

  snapshot(): WindowMirrorSnapshot {
    return {
      clonedCount: this.clones.length,
      lastActivatedAt: this.lastActivatedAt,
      lastCycledAt: this.lastCycledAt,
      stripCount: this.strip.count,
      closeButtonOn: this.buttonOn === null ? null : (this.clones[this.buttonOn]?.desc.id ?? null),
      windows: this.considered,
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
    this.activateMounted(mounted);
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
  private showStrip(group: readonly number[]): void {
    // A scroll may show a group before its grace period ends.
    this.stripGrace.cancel();
    this.hoverGroup = group;
    const members: CycleStripMember[] = [...group].reverse().map((index) => {
      const mounted = this.clones[index];
      const { win, rect, source } = mounted;
      return {
        actor: source,
        size: { width: rect.width, height: rect.height },
        win,
        onActivate: () => this.activateMounted(mounted),
      };
    });
    this.strip.show(members, focusWithin(group, this.focused));
  }

  /** Hide the strip, dropping the hover group and any pending change. */
  private hideStrip(): void {
    this.stripGrace.cancel();
    this.hoverGroup = null;
    this.strip.hide();
  }

  /**
   * Raise `mounted`'s window (or its modal transient, which holds the
   * keyboard) and close the overlay; its group is painted on top while the
   * clones ease back, matching the stacking the real windows will have
   * when they reappear.
   */
  private activateMounted(mounted: MountedClone): void {
    if (this.closing) {
      return;
    }
    this.activatedGroup = mounted.group;
    this.activateWindow(mounted.activateWin);
    this.onActivated?.();
  }

  /**
   * Put the group at `index` back at its mount position among the
   * container's children: directly above the nearest group below it in
   * mount order, or at the bottom if there is none. Every other group is
   * at its mount position, since at most one group is ever raised.
   */
  private restoreMountPosition(container: St.Widget, index: number): void {
    const { group } = this.clones[index];
    const below = index > 0 ? this.clones[index - 1].group : null;
    if (below === null) {
      container.set_child_below_sibling(group, null);
    } else {
      container.set_child_above_sibling(group, below);
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
    this.disconnectWindowCreated();
    for (const mounted of this.clones) {
      this.disposeClone(mounted);
    }
    this.clones = [];
    this.layout = null;
    this.focused = null;
    this.buttonOn = null;
    this.pointer = null;
    this.closeButton.destroy();
    this.activatedGroup = null;
    this.closing = false;
    this.stripGrace.cancel();
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

  /**
   * Where a transient's clone lands on close, relative to its parent's
   * group landing on `parentTarget`: its window's current offset from
   * there, so the real dialog reappears exactly under it. `null` (stay
   * put) if the window is gone or reports a degenerate rect.
   */
  private transientOffsetOf(transient: MountedTransient, parentTarget: Rect): Point | null {
    try {
      const rect = this.bufferRectOf(transient.win);
      if (isNonEmpty(rect)) {
        return { x: rect.x - parentTarget.x, y: rect.y - parentTarget.y };
      }
    } catch (e) {
      console.warn(`[Zatto] GnomeWindowMirror: transient buffer rect unavailable on close: ${e}`);
    }
    return null;
  }

  /**
   * Walk `global.get_window_actors()` (bottom to top) and describe every
   * window for {@link attachTransients}, which decides what is drawn.
   */
  private collectWindows(): {
    actor: Meta.WindowActor;
    win: Meta.Window;
    desc: WindowDescription;
  }[] {
    const workspace = global.workspace_manager.get_active_workspace();
    const out: { actor: Meta.WindowActor; win: Meta.Window; desc: WindowDescription }[] = [];
    for (const actor of global.get_window_actors()) {
      const win = actor.get_meta_window();
      if (win === null) {
        continue;
      }
      out.push({ actor, win, desc: describeWindow(win, workspace) });
    }
    return out;
  }

  /**
   * Synchronous tear-down for a single mounted window: disconnects the
   * click handlers, removes its group from its parent, and destroys the
   * group with the clones in it.
   */
  private disposeClone(mounted: MountedClone): void {
    mounted.group.remove_all_transitions();
    mounted.clone.disconnect(mounted.clickHandlerId);
    this.unwatchGone(mounted.win);
    for (const transient of mounted.transients) {
      this.disposeTransient(transient);
    }
    const parent = mounted.group.get_parent();
    if (parent !== null) {
      parent.remove_child(mounted.group);
    }
    mounted.group.destroy();
  }

  /**
   * Connect a press on `target`, a clone in a group, to activating the
   * group `mounted()` returns; the group is looked up when the press
   * arrives.
   */
  private connectClick(target: Clutter.Clone, mounted: () => MountedClone | null): number {
    return target.connect('button-press-event', () => {
      const picked = mounted();
      if (picked !== null) {
        this.activateMounted(picked);
      }
      return Clutter.EVENT_STOP;
    });
  }

  /** The windows drawn under the last pointer position: none on the strip, or before any. */
  private windowsUnderPointer(layout: DepthViewLayout): number[] {
    const pointer = this.pointer;
    if (pointer === null || this.strip.covers(this.toWorkArea(pointer))) {
      return [];
    }
    return this.groupAt(pointer, layout);
  }

  /** Put the close button on the window `closeButtonCarrier()` picks, or hide it. */
  private updateCloseButton(): void {
    const layout = this.layout;
    const container = this.getContainer();
    if (layout === null || container === null || this.closing || this.clones.length === 0) {
      this.hideCloseButton();
      return;
    }
    const pointer = this.pointer;
    let button: ButtonPointer = 'elsewhere';
    if (this.closeButton.isHeld()) {
      button = 'holding';
    } else if (pointer !== null && this.closeButton.covers(this.toWorkArea(pointer))) {
      button = 'over';
    }
    const carrier = closeButtonCarrier(
      this.focused,
      this.windowsUnderPointer(layout),
      this.buttonOn,
      button
    );
    if (carrier === this.buttonOn) {
      // A focus change may have restacked the groups around the carrier.
      this.closeButton.restack();
      return;
    }
    const mounted = carrier === null ? undefined : this.clones[carrier];
    if (mounted === undefined) {
      this.hideCloseButton();
      return;
    }
    this.buttonOn = carrier;
    const { frame, rect } = mounted;
    this.closeButton.showOn({
      group: mounted.group,
      container,
      frameInGroup: {
        x: frame.x - rect.x,
        y: frame.y - rect.y,
        width: frame.width,
        height: frame.height,
      },
    });
  }

  private hideCloseButton(): void {
    this.buttonOn = null;
    this.closeButton.hide();
  }

  /**
   * A hold on the close button ended: put the button where the pointer
   * now says, read again for where it was released. This runs after a
   * click's {@link closeCarrier} (see `DepthCloseButton`), so the click
   * acts on the window the press was made on before the button can move.
   */
  private onCloseButtonReleased(): void {
    if (this.layout === null || this.closing) {
      return;
    }
    const [x, y] = global.get_pointer();
    this.pointer = { x, y };
    this.updateCloseButton();
  }

  /**
   * The close button was clicked: ask the window it was pressed on, which
   * still carries it, to close, as the Activities Overview does, its
   * attached transients first, topmost first. A window that asks before
   * closing brings up a dialog instead, which {@link onWindowCreated} draws
   * on its clone. The depth view stays open; {@link onWindowGone} drops the
   * clone once the window goes.
   */
  private closeCarrier(): void {
    const mounted = this.buttonOn === null ? undefined : this.clones[this.buttonOn];
    if (this.closing || mounted === undefined) {
      return;
    }
    const time = global.get_current_time();
    for (const win of [...mounted.transients.map((t) => t.win).reverse(), mounted.win]) {
      try {
        win.delete(time);
      } catch (e) {
        console.warn(`[Zatto] GnomeWindowMirror: closing a window failed: ${e}`);
      }
    }
  }

  /** Call {@link onWindowGone} with `id` when `win` is unmanaged. */
  private watchGone(win: Meta.Window, id: number): void {
    this.unwatchGone(win);
    this.goneHandlers.set(
      win,
      win.connect('unmanaged', () => this.onWindowGone(id))
    );
  }

  private unwatchGone(win: Meta.Window): void {
    const id = this.goneHandlers.get(win);
    if (id !== undefined) {
      win.disconnect(id);
      this.goneHandlers.delete(win);
    }
  }

  /** A drawn window went: drop what `removalOf()` says. */
  private onWindowGone(id: number): void {
    if (this.closing) {
      // The clones are easing back; a clone whose source went paints
      // nothing, and the teardown takes it.
      return;
    }
    const removal = removalOf(
      this.clones.map(({ desc, transients }) => ({
        root: desc.id,
        transients: transients.map((t) => t.desc.id),
      })),
      id
    );
    if (removal === null) {
      return;
    }
    const mounted = this.clones[removal.group];
    if (removal.kind === 'transient') {
      const [transient] = mounted.transients.splice(removal.transient, 1);
      this.disposeTransient(transient);
      transient.clone.destroy();
      mounted.activateWin = activationOf(mounted);
      return;
    }
    this.removeGroup(removal.group);
  }

  /**
   * Drop the group at `index`, its window gone: destroy it, keep every
   * other clone where it is (the layout is not computed again), take the
   * window out of the strip, and move the focus as `focusAfterClose()`
   * decides.
   */
  private removeGroup(index: number): void {
    const mounted = this.clones[index];
    const layout = this.layout;
    const container = this.getContainer();
    if (mounted === undefined || layout === null) {
      return;
    }
    const overlap = this.overlapOf(index, layout);
    const nextFocus = focusAfterClose(index, this.focused, overlap);

    // A button held on another window stays there, so its release still
    // acts on the window it was pressed on.
    const keptOn = this.buttonOn;
    if (this.closeButton.isHeld() && keptOn !== null && keptOn !== index) {
      this.buttonOn = withoutIndex([keptOn], index)[0] ?? null;
    } else {
      this.hideCloseButton();
    }
    this.stripGrace.cancel();
    if (this.activatedGroup === mounted.group) {
      this.activatedGroup = null;
    }
    this.disposeClone(mounted);
    this.clones.splice(index, 1);
    const remaining: DepthViewLayout = {
      clones: layout.clones.filter((_, i) => i !== index),
      container: layout.container,
    };
    this.layout = remaining;
    // The focus as it stands without the window; a focused clone that went
    // was destroyed raised, so nothing needs to be put back.
    this.focused = this.focused === null ? null : (withoutIndex([this.focused], index)[0] ?? null);

    const shown = this.hoverGroup;
    if (shown !== null) {
      const kept = withoutIndex(shown, index);
      if (kept.length === 0) {
        this.hideStrip();
      } else if (kept.length !== shown.length) {
        // Rebuild without the window's thumbnail.
        this.showStrip(kept);
      } else {
        this.hoverGroup = kept;
      }
    }

    if (nextFocus !== null && nextFocus !== this.focused && container !== null) {
      this.focusOn(nextFocus, withoutIndex(overlap, index), container, remaining);
    }
    this.updateCloseButton();
  }

  /**
   * The windows drawn where the window at `index` was picked, before it
   * goes: under the pointer when it is over that window, else under its
   * close button's spot, moved into the window's frame by
   * `closeButtonProbe()` (a focused window may be closed while the pointer
   * is elsewhere, and on a frame smaller than the button its centre lies
   * outside the frame).
   */
  private overlapOf(index: number, layout: DepthViewLayout): number[] {
    const underPointer = this.windowsUnderPointer(layout);
    if (underPointer.includes(index) || this.focused !== index) {
      return underPointer;
    }
    const frames = this.clones.map(({ frame }) => frame);
    const drawn = drawnFrame(frames[index], index, layout);
    // Without a button (none was ever created), the frame's centre.
    const button = this.closeButton.rectOn(drawn) ?? drawn;
    return windowsUnder(closeButtonProbe(button, drawn), frames, layout);
  }

  /**
   * A window was created while the overlay is open: draw it on its
   * parent's clone if `attachLateWindow()` attaches it there. One that
   * has no window actor or no size yet is tried again once it is shown.
   */
  private onWindowCreated(win: Meta.Window): void {
    if (this.closing || this.clones.length === 0) {
      return;
    }
    const actor = win.get_compositor_private<Meta.WindowActor | null>();
    const rect = this.bufferRectOf(win);
    if (actor === null || !isNonEmpty(rect)) {
      if (!this.pendingShown.has(win)) {
        this.pendingShown.set(
          win,
          win.connect('shown', () => {
            const id = this.pendingShown.get(win);
            if (id !== undefined) {
              win.disconnect(id);
              this.pendingShown.delete(win);
            }
            this.onWindowCreated(win);
          })
        );
      }
      return;
    }

    const desc = describeWindow(win, global.workspace_manager.get_active_workspace());
    const drawn = this.clones.flatMap((mounted) => [
      mounted.desc,
      ...mounted.transients.map((t) => t.desc),
    ]);
    const rootId = attachLateWindow(drawn, desc);
    const mounted = this.clones.find((m) => m.desc.id === rootId);
    if (rootId === null || mounted === undefined) {
      return;
    }

    // Above the window's clone and its other transients, at its real
    // offset from the window, as the mount places the ones present then.
    const clone = new Clutter.Clone({ source: actor, reactive: true });
    mounted.group.add_child(clone);
    clone.set_position(rect.x - mounted.rect.x, rect.y - mounted.rect.y);
    clone.set_size(rect.width, rect.height);
    mounted.group.offscreen_redirect = Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY;
    mounted.transients.push({
      clone,
      win,
      desc,
      clickHandlerId: this.connectClick(clone, () => mounted),
    });
    this.watchGone(win, desc.id);
    mounted.activateWin = activationOf(mounted);
  }

  /** Stop following the windows created while open, pending ones included. */
  private disconnectWindowCreated(): void {
    if (this.windowCreatedId !== null) {
      global.display.disconnect(this.windowCreatedId);
      this.windowCreatedId = null;
    }
    for (const [win, id] of this.pendingShown) {
      win.disconnect(id);
    }
    this.pendingShown.clear();
  }

  /** Disconnect a transient's handlers; its clone goes with its group, or is destroyed by the caller. */
  private disposeTransient(transient: MountedTransient): void {
    transient.clone.remove_all_transitions();
    transient.clone.disconnect(transient.clickHandlerId);
    this.unwatchGone(transient.win);
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

/** The window to activate when `mounted` is picked: its topmost modal transient, else itself. */
function activationOf(mounted: MountedClone): Meta.Window {
  const modal = topmostModal(mounted.transients.map(({ desc }) => desc));
  return modal === null ? mounted.win : mounted.transients[modal].win;
}

/** `win` described for `attachTransients()`, against the active `workspace`. */
function describeWindow(win: Meta.Window, workspace: Meta.Workspace): WindowDescription {
  return {
    id: win.get_stable_sequence(),
    type: kindOf(win.get_window_type()),
    transientFor: win.get_transient_for()?.get_stable_sequence() ?? null,
    minimized: win.minimized,
    onCurrentWorkspace: win.located_on_workspace(workspace),
  };
}

function kindOf(type: Meta.WindowType): WindowKind {
  switch (type) {
    case Meta.WindowType.NORMAL:
      return 'normal';
    case Meta.WindowType.DIALOG:
      return 'dialog';
    case Meta.WindowType.MODAL_DIALOG:
      return 'modal-dialog';
    case Meta.WindowType.UTILITY:
      return 'utility';
    default:
      return 'other';
  }
}

/** The considered windows with their outcomes, titles and WM classes, for the snapshot. */
function describeConsidered(
  all: readonly { win: Meta.Window; desc: WindowDescription }[],
  outcomes: readonly AttachmentOutcome[]
): ConsideredWindow[] {
  return all.map(({ win, desc }, index) => ({
    ...desc,
    ...outcomes[index],
    title: win.get_title() ?? null,
    wmClass: win.get_wm_class() ?? null,
  }));
}

function isNonEmpty(rect: Rect): boolean {
  return rect.width > 0 && rect.height > 0;
}

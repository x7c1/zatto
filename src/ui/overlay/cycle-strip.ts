/**
 * The cycle strip: a row of live thumbnails along the bottom of the depth
 * view showing the windows under the cursor, frontmost on the left, with
 * an accent frame around the focused one and its title under the strip.
 *
 * Owned by `GnomeWindowMirror`, which decides when to show, highlight and
 * hide it. The strip is parented to the overlay's chrome container (see
 * `OverlayActor.getChromeContainer`), above the large clones and outside
 * their container transform. Geometry comes from `cycle-strip-layout.ts`.
 *
 * Each thumbnail is a reactive `Clutter.Clone` of the whole window actor,
 * so client-side shadows are included. A press on a thumbnail runs its
 * member's callback and stops the event; a press elsewhere on the strip
 * does nothing.
 */

import Clutter from 'gi://Clutter';
import type Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';
import { shouldAnimate } from '../../libs/shell/animations.js';
import { CYCLE_STRIP_TUNING, computeStripLayout } from './cycle-strip-layout.js';
import type { Point } from './depth-cycle.js';
import type { Rect, Size } from './depth-layout.js';

const EASE_MODE = Clutter.AnimationMode.EASE_OUT_QUAD;

const BACKGROUND_STYLE = 'background-color: rgba(30, 30, 30, 0.85); border-radius: 12px;';
const FRAME_STYLE = 'border: 2px solid rgba(255, 255, 255, 0.9); border-radius: 6px;';
const LABEL_STYLE = 'color: white; font-weight: bold; text-align: center;';
/** How far the frame sits outside the highlighted thumbnail, in px. */
const FRAME_OUTSET_PX = 4;
/** Gap between the strip's bottom edge and the title, in px. */
const LABEL_GAP_PX = 4;

/** One window shown in the strip. */
export interface CycleStripMember {
  /** The window actor the thumbnail clones. */
  readonly actor: Clutter.Actor;
  /** Size of the window's buffer rect, the rect the actor spans. */
  readonly size: Size;
  readonly win: Meta.Window;
  /** Run when the thumbnail is pressed. */
  readonly onActivate: () => void;
}

/** The actors of one shown strip. */
interface Shown {
  readonly root: St.Widget;
  /** The background rect, relative to the container. */
  readonly strip: Rect;
  readonly thumbs: Clutter.Clone[];
  readonly thumbRects: Rect[];
  readonly members: readonly CycleStripMember[];
  readonly frame: St.Widget;
  readonly label: St.Label;
}

export class CycleStrip {
  private shown: Shown | null = null;
  /** Roots of strips that are fading out, destroyed when the fade lands. */
  private fading: St.Widget[] = [];

  constructor(
    /**
     * Returns the container to parent the strip to, the overlay's chrome
     * container. A getter, so the strip never holds a container across the
     * overlay's teardown.
     */
    private readonly getContainer: () => St.Widget | null
  ) {}

  /** How many thumbnails are shown, 0 when hidden. */
  get count(): number {
    return this.shown?.thumbs.length ?? 0;
  }

  /**
   * Whether `point` (relative to the container) lies on the shown strip's
   * background. False while hidden or fading out.
   */
  covers(point: Point): boolean {
    const strip = this.shown?.strip;
    return (
      strip !== undefined &&
      point.x >= strip.x &&
      point.x < strip.x + strip.width &&
      point.y >= strip.y &&
      point.y < strip.y + strip.height
    );
  }

  /**
   * Replace whatever is shown with thumbnails of `members` (front to back),
   * framing the one at position `highlighted`, and fade the strip in. A
   * strip that replaces one already shown starts at that one's opacity, so
   * moving to another overlap swaps the thumbnails without the strip
   * blinking out and back.
   */
  show(members: readonly CycleStripMember[], highlighted: number): void {
    const startOpacity = this.shown?.root.opacity ?? 0;
    this.destroy();
    const container = this.getContainer();
    if (container === null || members.length === 0) {
      return;
    }

    const area = { width: container.width, height: container.height };
    const layout = computeStripLayout(
      members.map(({ size }) => size),
      area,
      CYCLE_STRIP_TUNING
    );

    const root = new St.Widget({
      reactive: false,
      layout_manager: new Clutter.FixedLayout(),
      opacity: startOpacity,
    });
    root.set_position(0, 0);
    root.set_size(area.width, area.height);

    // Reactive so a press that misses a thumbnail (a gap, the padding)
    // lands on the strip, where nothing handles it, instead of on the
    // large clone drawn beneath, which would raise a window the user
    // cannot see.
    const background = new St.Widget({ style: BACKGROUND_STYLE, reactive: true });
    setRect(background, layout.strip);
    root.add_child(background);

    const thumbs = members.map((member, i) => {
      const thumb = new Clutter.Clone({ source: member.actor, reactive: true });
      setRect(thumb, layout.thumbs[i]);
      thumb.connect('button-press-event', () => {
        member.onActivate();
        return Clutter.EVENT_STOP;
      });
      root.add_child(thumb);
      return thumb;
    });

    const frame = new St.Widget({ style: FRAME_STYLE, reactive: false });
    root.add_child(frame);

    const label = new St.Label({ style: LABEL_STYLE, reactive: false });
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    label.clutter_text.single_line_mode = true;
    label.set_position(layout.strip.x, layout.strip.y + layout.strip.height + LABEL_GAP_PX);
    label.set_width(layout.strip.width);
    root.add_child(label);

    container.add_child(root);
    this.shown = {
      root,
      strip: layout.strip,
      thumbs,
      thumbRects: layout.thumbs,
      members,
      frame,
      label,
    };
    this.setHighlight(highlighted);

    if (shouldAnimate()) {
      root.ease({ opacity: 255, duration: CYCLE_STRIP_TUNING.fadeMs, mode: EASE_MODE });
    } else {
      root.opacity = 255;
    }
  }

  /** Move the frame to the thumbnail at `position` and show its title. */
  setHighlight(position: number): void {
    const shown = this.shown;
    if (shown === null) {
      return;
    }
    const rect = shown.thumbRects[position];
    const member = shown.members[position];
    if (rect === undefined || member === undefined) {
      return;
    }
    setRect(shown.frame, {
      x: rect.x - FRAME_OUTSET_PX,
      y: rect.y - FRAME_OUTSET_PX,
      width: rect.width + 2 * FRAME_OUTSET_PX,
      height: rect.height + 2 * FRAME_OUTSET_PX,
    });
    shown.label.text = titleOf(member.win);
  }

  /** Fade the strip out and destroy it. Idempotent. */
  hide(): void {
    const shown = this.shown;
    if (shown === null) {
      return;
    }
    this.shown = null;
    for (const thumb of shown.thumbs) {
      thumb.reactive = false;
    }
    const { root } = shown;
    if (!shouldAnimate()) {
      destroyRoot(root);
      return;
    }
    this.fading.push(root);
    root.remove_all_transitions();
    root.ease({
      opacity: 0,
      duration: CYCLE_STRIP_TUNING.fadeMs,
      mode: EASE_MODE,
      // Only a finished fade; a cancelled one is destroyed by whoever cancelled it.
      onComplete: () => {
        this.fading = this.fading.filter((r) => r !== root);
        destroyRoot(root);
      },
    });
  }

  /** Destroy the strip at once, a fade in flight included. Idempotent. */
  destroy(): void {
    const roots = this.fading;
    this.fading = [];
    if (this.shown !== null) {
      roots.push(this.shown.root);
      this.shown = null;
    }
    for (const root of roots) {
      destroyRoot(root);
    }
  }
}

function setRect(actor: Clutter.Actor, rect: Rect): void {
  actor.set_position(Math.round(rect.x), Math.round(rect.y));
  actor.set_size(Math.round(rect.width), Math.round(rect.height));
}

function destroyRoot(root: St.Widget): void {
  root.remove_all_transitions();
  root.destroy();
}

function titleOf(win: Meta.Window): string {
  try {
    return win.get_title() ?? '';
  } catch (e) {
    console.warn(`[Zatto] CycleStrip: window title unavailable: ${e}`);
    return '';
  }
}

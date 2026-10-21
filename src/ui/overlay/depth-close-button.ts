/**
 * The depth view's close button: the Activities Overview's close button
 * for a window preview (the shell theme's `window-close` style class and
 * the `preview-close-symbolic` icon), at a top corner of one clone as
 * `closeButtonRect()` places it. The theme supplies its size, colours
 * and hover and active states, so it follows the user's colour scheme;
 * only the shadow is zatto's (see `BUTTON_STYLE`).
 *
 * Owned by `GnomeWindowMirror`, which decides which clone carries it (see
 * `depth-close.ts`) and what a click does. It is parented to the clone
 * container, stacked directly above its clone's group, so a clone drawn
 * in front of that one covers it as it covers the clone; as a sibling of
 * the group, not its child, it keeps its own opacity, and it is scaled by
 * the inverse of the container's scale, so it keeps its size. It follows
 * the clone through its eases: every change of the clone group's position
 * or of the clone container's scale or translation moves it.
 *
 * It closes on release, as the Overview's does: St.Button's click gesture
 * takes a primary press itself (it shows the theme's `:active` background
 * while the held button is under the pointer, and follows the press
 * wherever the pointer goes), and runs `onClick` on `clicked`, emitted
 * when the button is released over it; released elsewhere, nothing runs.
 * A press of another mouse button is stopped on the button and does
 * nothing. Either way the press does not reach the clone beneath (whose
 * press activates the window): the button is a sibling of the clone's
 * group, not inside it, so the press does not pass through the clone. It
 * does not count as a press on nothing for the modal grab either: the
 * button is the press's event actor, not the overlay.
 *
 * While a primary press is held, {@link isHeld} is true, also while the
 * pointer is off the button (where St.Button's `pressed` is false). The
 * hold ends when the click gesture completes or is cancelled; `onRelease`
 * then runs, after `onClick` when the release is a click, unless
 * {@link hide} or {@link destroy} dropped the hold.
 */

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';
import { closeButtonRect } from './depth-close.js';
import type { Point } from './depth-cycle.js';
import { DEPTH_VIEW_TUNING, type Rect } from './depth-layout.js';

/**
 * A stronger shadow than the theme's, which is too faint to set the
 * button apart from the window content it sits on.
 */
const BUTTON_STYLE = 'box-shadow: 0 2px 8px 0 rgba(0, 0, 0, 0.6);';

/** The clone the button sits on. */
export interface CloseButtonTarget {
  /** The clone's group, whose position eases. */
  readonly group: Clutter.Actor;
  /** The clone container, whose scale and translation ease. */
  readonly container: Clutter.Actor;
  /** The window's frame rect relative to the group's origin. */
  readonly frameInGroup: Rect;
}

interface Attached {
  readonly target: CloseButtonTarget;
  readonly handlers: readonly { readonly actor: Clutter.Actor; readonly id: number }[];
}

export class DepthCloseButton {
  private button: St.Button | null = null;
  private attached: Attached | null = null;
  /** Where the button is drawn, relative to the work area. */
  private rect: Rect | null = null;
  /** Whether a primary press on the button is held; see {@link isHeld}. */
  private held = false;

  constructor(
    private readonly callbacks: {
      /** Run when the button is clicked: released over it after a primary press. */
      readonly onClick: () => void;
      /**
       * Run when a hold on the button ends, wherever the pointer was
       * released; after `onClick` when that release is a click.
       */
      readonly onRelease: () => void;
    }
  ) {}

  /**
   * Whether the button is held down: a primary press on it not yet
   * released, wherever the pointer has moved since.
   */
  isHeld(): boolean {
    return this.held;
  }

  /** Whether `point` (relative to the work area) lies on the shown button. */
  covers(point: Point): boolean {
    const rect = this.rect;
    return (
      rect !== null &&
      point.x >= rect.x &&
      point.x < rect.x + rect.width &&
      point.y >= rect.y &&
      point.y < rect.y + rect.height
    );
  }

  /** Show the button on `target`, moving it from wherever it was. */
  showOn(target: CloseButtonTarget): void {
    this.detach();
    const button = this.ensureButton();
    const parent = button.get_parent();
    if (parent !== target.container) {
      parent?.remove_child(button);
      target.container.add_child(button);
    }
    const reposition = () => this.reposition();
    const handlers = [
      ...['notify::x', 'notify::y'].map((signal) => ({
        actor: target.group,
        id: target.group.connect(signal, reposition),
      })),
      ...['notify::scale-x', 'notify::translation-x', 'notify::translation-y'].map((signal) => ({
        actor: target.container,
        id: target.container.connect(signal, reposition),
      })),
    ];
    this.attached = { target, handlers };
    this.restack();
    this.reposition();
    button.reactive = true;
    button.show();
  }

  /**
   * Stack the button directly above its clone's group again. The mirror
   * calls this whenever it restacks the groups, which would otherwise
   * leave the button under a group raised above it or above one lowered.
   */
  restack(): void {
    const button = this.button;
    const target = this.attached?.target;
    if (button !== null && target !== undefined && button.get_parent() === target.container) {
      target.container.set_child_above_sibling(button, target.group);
    }
  }

  /**
   * Hide the button. Idempotent. A hold on it is dropped without a click
   * and without `onRelease`.
   */
  hide(): void {
    this.detach();
    this.held = false;
    if (this.button !== null) {
      this.button.fake_release();
      this.button.reactive = false;
      this.button.hide();
    }
  }

  /** Destroy the button. Idempotent; it is created again on the next {@link showOn}. */
  destroy(): void {
    this.detach();
    this.held = false;
    this.button?.fake_release();
    this.button?.destroy();
    this.button = null;
  }

  private detach(): void {
    const attached = this.attached;
    this.attached = null;
    this.rect = null;
    for (const { actor, id } of attached?.handlers ?? []) {
      actor.disconnect(id);
    }
  }

  /**
   * Where the button would be drawn on a clone whose frame is drawn at
   * `frame` (relative to the work area), or `null` while there is
   * no button.
   */
  rectOn(frame: Rect): Rect | null {
    const button = this.button;
    if (button === null) {
      return null;
    }
    // The theme sizes the button; its natural size is that once styled.
    const [, , width, height] = button.get_preferred_size();
    return closeButtonRect(frame, {
      size: { width, height },
      // Read on every placement, so a layout changed while zatto runs
      // applies from the next depth view.
      onLeft: Meta.prefs_get_button_layout().left_buttons.includes(Meta.ButtonFunction.CLOSE),
      inset: DEPTH_VIEW_TUNING.closeButtonInsetPx,
    });
  }

  /** Put the button on the frame as the clone and its container are drawn now. */
  private reposition(): void {
    const button = this.button;
    const target = this.attached?.target;
    if (button === null || target === undefined) {
      return;
    }
    const { group, container, frameInGroup } = target;
    const scale = container.scale_x;
    const frame = {
      x: (group.x + frameInGroup.x) * scale + container.translation_x,
      y: (group.y + frameInGroup.y) * scale + container.translation_y,
      width: frameInGroup.width * scale,
      height: frameInGroup.height * scale,
    };
    const rect = this.rectOn(frame);
    if (rect === null) {
      return;
    }
    this.rect = rect;
    // Into the container's coordinates, and scaled back to its natural size.
    button.set_position(
      Math.round((rect.x - container.translation_x) / scale),
      Math.round((rect.y - container.translation_y) / scale)
    );
    button.set_scale(1 / scale, 1 / scale);
  }

  /**
   * The button, created on first use and parented by {@link showOn}. The
   * mirror destroys it on every teardown, before the container can go, so
   * a new mount creates a new one.
   */
  private ensureButton(): St.Button {
    if (this.button !== null) {
      return this.button;
    }
    const button = new St.Button({
      style_class: 'window-close',
      style: BUTTON_STYLE,
      icon_name: 'preview-close-symbolic',
      reactive: true,
      track_hover: true,
      can_focus: false,
      accessible_name: 'Close window',
      visible: false,
    });
    button.cursor_type = Clutter.CursorType.POINTER;
    // St.Button's `pressed` turns false while the held button is off the
    // pointer, and a release there does not notify it, so the hold is read
    // from its click gesture instead. The gesture sees an event before the
    // button's own handlers do, and on a click it emits `clicked` before it
    // notifies its state, so `onClick` runs before `onRelease`.
    const gesture = button.get_actions().find((a) => a instanceof Clutter.ClickGesture) as
      | Clutter.ClickGesture
      | undefined;
    if (gesture === undefined) {
      console.warn('[Zatto] DepthCloseButton: St.Button has no click gesture');
    }
    button.connect('button-press-event', (_actor, event: Clutter.Event) => {
      if (event.get_button() !== Clutter.BUTTON_PRIMARY) {
        return Clutter.EVENT_STOP;
      }
      // The gesture may have turned the press down (another gesture is
      // running); then nothing is held.
      this.held = gesture !== undefined && isActive(gesture.state);
      return Clutter.EVENT_PROPAGATE;
    });
    gesture?.connect('notify::state', () => {
      // hide() and destroy() drop the hold before they cancel the gesture.
      if (this.held && !isActive(gesture.state)) {
        this.held = false;
        this.callbacks.onRelease();
      }
    });
    button.connect('clicked', () => this.callbacks.onClick());
    this.button = button;
    return button;
  }
}

/** Whether a gesture in `state` is still following its press. */
function isActive(state: Clutter.GestureState): boolean {
  return state === Clutter.GestureState.POSSIBLE || state === Clutter.GestureState.RECOGNIZING;
}

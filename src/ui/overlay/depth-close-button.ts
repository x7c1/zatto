/**
 * The depth view's close button: the Activities Overview's close button
 * for a window preview (the shell theme's `window-close` style class and
 * the `preview-close-symbolic` icon), at a top corner of one clone as
 * `closeButtonRect()` places it. The theme supplies its size, colours
 * and hover and active states, so it follows the user's colour scheme;
 * only the shadow is zatto's (see `BUTTON_STYLE`).
 *
 * Owned by `GnomeWindowMirror`, which decides which clone carries it (see
 * `depth-close.ts`) and what a press does. It is parented to the clone
 * container, stacked directly above its clone's group, so a clone drawn
 * in front of that one covers it as it covers the clone; as a sibling of
 * the group, not its child, it keeps its own opacity, and it is scaled by
 * the inverse of the container's scale, so it keeps its size. It follows
 * the clone through its eases: every change of the clone group's position
 * or of the clone container's scale or translation moves it.
 *
 * A press on it runs `onPress` and stops the event, so it neither reaches
 * the clone beneath nor counts as a press on nothing for the modal grab
 * (it is the press's target, not the overlay).
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

  constructor(
    /** Run when the button is pressed. */
    private readonly onPress: () => void
  ) {}

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

  /** Hide the button. Idempotent. */
  hide(): void {
    this.detach();
    if (this.button !== null) {
      this.button.reactive = false;
      this.button.hide();
    }
  }

  /** Destroy the button. Idempotent; it is created again on the next {@link showOn}. */
  destroy(): void {
    this.detach();
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
    button.connect('button-press-event', () => {
      this.onPress();
      return Clutter.EVENT_STOP;
    });
    this.button = button;
    return button;
  }
}

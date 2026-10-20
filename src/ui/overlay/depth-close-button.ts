/**
 * The depth view's close button: a round button with the stock
 * `window-close-symbolic` icon at the top-right corner of one clone, like
 * the one the Activities Overview shows on a window preview.
 *
 * Owned by `GnomeWindowMirror`, which decides which clone carries it (see
 * `depth-close.ts`) and what a press does. It is parented to the overlay's
 * chrome container, above the clones and outside their container
 * transform, so it keeps its size and opacity whatever the clone's. It
 * follows the clone through its eases: every change of the clone group's
 * position or of the clone container's scale or translation moves it.
 *
 * A press on it runs `onPress` and stops the event, so it neither reaches
 * the clone beneath nor counts as a press on nothing for the modal grab
 * (it is the press's target, not the overlay).
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import { closeButtonRect } from './depth-close.js';
import type { Point } from './depth-cycle.js';
import { DEPTH_VIEW_TUNING, type Rect } from './depth-layout.js';

const BUTTON_STYLE_BASE = 'border-radius: 9999px; padding: 0;';
const BUTTON_STYLE = `${BUTTON_STYLE_BASE} background-color: rgba(60, 60, 60, 0.9);`;
const BUTTON_HOVER_STYLE = `${BUTTON_STYLE_BASE} background-color: rgba(90, 90, 90, 0.95);`;
const ICON_STYLE = 'color: white;';

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
  /** Where the button is drawn, relative to the chrome container. */
  private rect: Rect | null = null;

  constructor(
    /** Returns the overlay's chrome container, or `null` while there is none. */
    private readonly getContainer: () => St.Widget | null,
    /** Run when the button is pressed. */
    private readonly onPress: () => void
  ) {}

  /** Whether `point` (relative to the chrome container) lies on the shown button. */
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
    if (button === null) {
      return;
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
    this.reposition();
    button.reactive = true;
    button.show();
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
    const rect = closeButtonRect(frame, DEPTH_VIEW_TUNING);
    this.rect = rect;
    button.set_position(Math.round(rect.x), Math.round(rect.y));
  }

  /**
   * The button, created in the chrome container on first use, or `null`
   * while there is no container. The mirror destroys it on every teardown,
   * before the container can go, so a new mount creates a new one.
   */
  private ensureButton(): St.Button | null {
    if (this.button !== null) {
      return this.button;
    }
    const container = this.getContainer();
    if (container === null) {
      return null;
    }
    const size = DEPTH_VIEW_TUNING.closeButtonSizePx;
    const button = new St.Button({
      style: BUTTON_STYLE,
      reactive: true,
      track_hover: true,
      can_focus: false,
      accessible_name: 'Close window',
      visible: false,
      child: new St.Icon({
        icon_name: 'window-close-symbolic',
        icon_size: DEPTH_VIEW_TUNING.closeButtonIconSizePx,
        style: ICON_STYLE,
      }),
    });
    button.set_size(size, size);
    button.cursor_type = Clutter.CursorType.POINTER;
    // Inline styles have no :hover, so the hover background is swapped in.
    button.connect('notify::hover', () => {
      button.style = button.hover ? BUTTON_HOVER_STYLE : BUTTON_STYLE;
    });
    button.connect('button-press-event', () => {
      this.onPress();
      return Clutter.EVENT_STOP;
    });
    // At the bottom of the chrome container, so the cycle strip, when it
    // is shown over the same spot, takes the press.
    container.insert_child_at_index(button, 0);
    this.button = button;
    return button;
  }
}

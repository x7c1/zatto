/**
 * Overlay actor: full-monitor dimmer that hosts live window clones.
 *
 * The dimmer itself is reactive so it absorbs background clicks, and it
 * is the modal grab actor. It stays transparent: the dim colour lives on a
 * separate full-monitor shade child below the clone container, so fading
 * the shade in on `show()` and out on `hide()` does not fade the clones
 * with it (they ease on their own, see `gnome-window-mirror.ts`). The
 * "what does the user see" content is supplied by the
 * {@link WindowMirrorPort} production implementation, which adds live
 * `Clutter.Clone` actors as children of the dedicated clone container
 * returned by {@link OverlayActor.getCloneContainer}. The clone container
 * uses `Clutter.FixedLayout` so the window mirror can position each clone
 * by absolute monitor-relative coordinates (see `gnome-window-mirror.ts`).
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { shouldAnimate } from '../../libs/shell/animations.js';
import { safeAddChrome } from '../../libs/shell/safe-add-chrome.js';
import { DEPTH_VIEW_TUNING } from './depth-layout.js';
import { HOT_CORNER_SIZE } from './hot-corner-trigger.js';
import type { OverlayActorPort } from './ports.js';

const EASE_MODE = Clutter.AnimationMode.EASE_OUT_QUAD;

const SHADE_STYLE = 'background-color: rgba(0, 0, 0, 0.5);';

export class OverlayActor implements OverlayActorPort {
  private dimmer: St.Widget | null = null;
  private shade: St.Widget | null = null;
  private cloneContainer: St.Widget | null = null;
  private dimmerMotionId: number | null = null;
  private cornerLatched = false;
  private cornerReenterHandler: (() => void) | null = null;
  private mounted = false;
  private visible = false;

  onCornerReenter(handler: () => void): void {
    this.cornerReenterHandler = handler;
  }

  /** Mount the dimmer to the Shell chrome (hidden until `show()` is called). */
  mount(): void {
    if (this.mounted) {
      return;
    }

    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) {
      // Cannot meaningfully position the overlay without a primary monitor;
      // bail without throwing — `show()` will become a no-op until next mount.
      console.warn('[Zatto] OverlayActor.mount: no primary monitor available');
      return;
    }

    const dimmer = new St.Widget({
      reactive: true,
      visible: false,
      x: monitor.x,
      y: monitor.y,
      width: monitor.width,
      height: monitor.height,
      // FixedLayout lets the clone container (and the window mirror that
      // populates it) place children by absolute monitor-relative
      // coordinates. BinLayout would force-center every child, breaking
      // in-place positioning.
      layout_manager: new Clutter.FixedLayout(),
    });
    dimmer.add_style_class_name('zatto-overlay-dimmer');

    // The dim colour, below the clones. Its opacity is what fades.
    const shade = new St.Widget({
      style: SHADE_STYLE,
      x: 0,
      y: 0,
      width: monitor.width,
      height: monitor.height,
      reactive: false,
      opacity: 0,
    });
    shade.add_style_class_name('zatto-overlay-shade');
    dimmer.add_child(shade);

    // Dedicated child container for clones. Keeping clones in their own
    // container (rather than attaching them directly to the dimmer) keeps
    // the dimmer free to host other chrome later (e.g. outlines or
    // labels) without those decorations sharing the clones' input routing.
    const cloneContainer = new St.Widget({
      x: 0,
      y: 0,
      width: monitor.width,
      height: monitor.height,
      reactive: false,
      layout_manager: new Clutter.FixedLayout(),
    });
    cloneContainer.add_style_class_name('zatto-overlay-clones');
    dimmer.add_child(cloneContainer);

    // Re-entry detection: the chrome-level `HotCornerTrigger` is a sibling of
    // the dimmer, not a descendant, so it stops receiving pointer events the
    // moment `pushModal(dimmer)` routes everything to the grab actor. A child
    // sensor with `enter-event` doesn't work either — under the modal grab,
    // Clutter binds pointer focus to the grab actor and does not re-evaluate
    // the hit-actor inside the grab region except when an implicit pointer
    // grab (e.g. mouse-button-hold) ends, so plain hovers never fire child
    // `enter-event`s. The grab actor itself, however, receives `motion-event`
    // reliably; combine a coordinate check with an edge-detection latch so
    // the handler fires exactly once per physical corner re-entry.
    this.dimmerMotionId = dimmer.connect('motion-event', (_actor, event) => {
      const [stageX, stageY] = event.get_coords();
      const localX = stageX - monitor.x;
      const localY = stageY - monitor.y;
      const insideCorner =
        localX >= 0 &&
        localX < HOT_CORNER_SIZE &&
        localY >= monitor.height - HOT_CORNER_SIZE &&
        localY < monitor.height;
      if (insideCorner) {
        if (!this.cornerLatched) {
          this.cornerLatched = true;
          this.cornerReenterHandler?.();
        }
      } else {
        this.cornerLatched = false;
      }
      return Clutter.EVENT_PROPAGATE;
    });

    safeAddChrome(dimmer);
    this.dimmer = dimmer;
    this.shade = shade;
    this.cloneContainer = cloneContainer;
    this.mounted = true;
  }

  show(): void {
    const { dimmer, shade } = this;
    if (dimmer === null || shade === null) {
      return;
    }
    // Cancel a fade-out in flight so its completion does not hide the
    // dimmer we are showing again; the fade-in starts from where it was.
    shade.remove_all_transitions();
    dimmer.reactive = true;
    dimmer.show();
    if (shouldAnimate()) {
      shade.ease({ opacity: 255, duration: DEPTH_VIEW_TUNING.transitionMs, mode: EASE_MODE });
    } else {
      shade.opacity = 255;
    }
    this.visible = true;
  }

  hide(): void {
    const { dimmer, shade } = this;
    if (dimmer === null || shade === null) {
      return;
    }
    this.visible = false;
    this.cornerLatched = false;
    shade.remove_all_transitions();
    // The dimmer stays on stage while the shade fades and the clones it
    // hosts ease back; stop it from swallowing clicks meanwhile.
    dimmer.reactive = false;
    if (shouldAnimate()) {
      shade.ease({
        opacity: 0,
        duration: DEPTH_VIEW_TUNING.transitionMs,
        mode: EASE_MODE,
        // Only on a finished fade: a `show()` cancelling it keeps the dimmer.
        onComplete: () => dimmer.hide(),
      });
    } else {
      shade.opacity = 0;
      dimmer.hide();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** The reactive actor used as the modal grab target. */
  getGrabActor(): Clutter.Actor | null {
    return this.dimmer;
  }

  /**
   * The dedicated child container clones are parented to. It uses
   * `Clutter.FixedLayout` so the {@link WindowMirrorPort} production
   * implementation can position each clone at an absolute monitor-relative
   * coordinate (see `gnome-window-mirror.ts`).
   */
  getCloneContainer(): St.Widget | null {
    return this.cloneContainer;
  }

  /** Unmount and destroy. Idempotent. */
  destroy(): void {
    if (this.dimmer !== null && this.dimmerMotionId !== null) {
      this.dimmer.disconnect(this.dimmerMotionId);
      this.dimmerMotionId = null;
    }
    // A pending fade's completion must not touch a destroyed dimmer.
    this.shade?.remove_all_transitions();
    this.shade = null;
    if (this.dimmer !== null) {
      Main.layoutManager.removeChrome(this.dimmer);
      // The clone container is a child of the dimmer and gets destroyed
      // implicitly when the parent is destroyed; null the reference so
      // `getCloneContainer()` does not hand out a dangling widget.
      this.dimmer.destroy();
      this.dimmer = null;
    }
    this.cloneContainer = null;
    this.mounted = false;
    this.visible = false;
    this.cornerLatched = false;
  }
}

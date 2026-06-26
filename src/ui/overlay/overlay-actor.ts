/**
 * Overlay actor: full-monitor dimmer that hosts live window clones in its
 * center.
 *
 * The dimmer itself is reactive so it absorbs background clicks; the actual
 * "what does the user see in the middle" content is no longer owned by this
 * file. Starting from PoC step 3 it is supplied by the
 * {@link WindowMirrorPort} production implementation, which adds a live
 * `Clutter.Clone` as a child of the dimmer via {@link OverlayActor.getCloneContainer}.
 * The dimmer keeps using `Clutter.BinLayout` so any single clone child is
 * naturally centered without manual positioning.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { safeAddChrome } from '../../libs/shell/safe-add-chrome.js';
import { HOT_CORNER_SIZE } from './hot-corner-trigger.js';
import type { OverlayActorPort } from './ports.js';

const DIMMER_STYLE = 'background-color: rgba(0, 0, 0, 0.5);';

export class OverlayActor implements OverlayActorPort {
  private dimmer: St.Widget | null = null;
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
      style: DIMMER_STYLE,
      reactive: true,
      visible: false,
      x: monitor.x,
      y: monitor.y,
      width: monitor.width,
      height: monitor.height,
      layout_manager: new Clutter.BinLayout(),
    });
    dimmer.add_style_class_name('zatto-overlay-dimmer');

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
    this.mounted = true;
  }

  show(): void {
    if (this.dimmer === null) {
      return;
    }
    this.dimmer.show();
    this.visible = true;
  }

  hide(): void {
    if (this.dimmer === null) {
      return;
    }
    this.dimmer.hide();
    this.visible = false;
    this.cornerLatched = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** The reactive actor used as the modal grab target. */
  getGrabActor(): Clutter.Actor | null {
    return this.dimmer;
  }

  /**
   * The container child clones should be parented to. Today this is the
   * dimmer itself (whose `Clutter.BinLayout` naturally centers a single
   * child); kept as a dedicated method so future layouts (multi-clone grid)
   * can swap in a sibling container without touching the
   * {@link WindowMirrorPort} production code that calls this.
   */
  getCloneContainer(): St.Widget | null {
    return this.dimmer;
  }

  /** Unmount and destroy. Idempotent. */
  destroy(): void {
    if (this.dimmer !== null && this.dimmerMotionId !== null) {
      this.dimmer.disconnect(this.dimmerMotionId);
      this.dimmerMotionId = null;
    }
    if (this.dimmer !== null) {
      Main.layoutManager.removeChrome(this.dimmer);
      this.dimmer.destroy();
      this.dimmer = null;
    }
    this.mounted = false;
    this.visible = false;
    this.cornerLatched = false;
  }
}

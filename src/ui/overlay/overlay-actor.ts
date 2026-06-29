/**
 * Overlay actor: full-monitor dimmer that hosts live window clones routed
 * into quadrant zones, on top of an opaque wallpaper backdrop.
 *
 * Stack from bottom to top (all parented inside `dimmer`):
 *
 *   1. `backdropContainer`  — hosts a `Background.BackgroundManager`
 *      (same primitive the Activities Overview uses per-workspace) so
 *      the bottom of the overlay is the user's actual wallpaper,
 *      painted opaquely. This is the architectural fix for the
 *      step 5d "background jitter" complaint: with `window_group` and
 *      `top_window_group` hidden, the dimmer alone is a translucent
 *      layer whose backdrop is... nothing. Live motion in the clones
 *      above is then read by the user as "stuff leaking through the
 *      dim". Mounting the wallpaper as an opaque base removes the
 *      translucency illusion at its root — there is no longer
 *      anything mysterious behind the dim.
 *   2. The `dimmer` `St.Widget`'s own `background-color` (50% black) —
 *      now serves as a darkening tint on top of the wallpaper rather
 *      than a translucent layer over the live desktop. Doubles as the
 *      visual mode indicator.
 *   3. `cloneContainer` — `Clutter.FixedLayout` host for the live
 *      `Clutter.Clone` actors the window mirror positions by absolute
 *      monitor-relative coordinates (zone routing + auto-grid happens
 *      in `gnome-window-mirror.ts` / `zone-layout.ts`).
 *
 * The dimmer itself is reactive so it absorbs background clicks.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { safeAddChrome } from '../../libs/shell/safe-add-chrome.js';
import { HOT_CORNER_SIZE } from './hot-corner-trigger.js';
import type { OverlayActorPort } from './ports.js';

const DIMMER_STYLE = 'background-color: rgba(0, 0, 0, 0.5);';

export class OverlayActor implements OverlayActorPort {
  private dimmer: St.Widget | null = null;
  private bgManager: Background.BackgroundManager | null = null;
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
      style: DIMMER_STYLE,
      reactive: true,
      visible: false,
      x: monitor.x,
      y: monitor.y,
      width: monitor.width,
      height: monitor.height,
      // FixedLayout lets the clone container (and the window mirror that
      // populates it) place children by absolute monitor-relative
      // coordinates. BinLayout would force-center every child, breaking
      // zone routing.
      layout_manager: new Clutter.FixedLayout(),
    });
    dimmer.add_style_class_name('zatto-overlay-dimmer');

    // Wallpaper backdrop. Mounted FIRST as a dimmer child so it sits
    // beneath every later sibling (the dimmer's own `background-color`
    // is painted on top of children, then the cloneContainer above that).
    // Sized to the monitor and pinned at (0, 0) inside the dimmer (whose
    // own origin is `monitor.x` / `monitor.y` on the stage).
    //
    // `Background.BackgroundManager` is the same primitive `Workspace`
    // uses to paint the wallpaper behind each per-workspace view in the
    // Activities Overview. `controlPosition: false` keeps the manager
    // from moving the actor — we control the container's coordinates
    // ourselves. `useContentSize: false` makes the background actor
    // resize to fill the container instead of trying to use its own
    // content size.
    const backdropContainer = new Clutter.Actor({
      name: 'zatto-backdrop',
      x: 0,
      y: 0,
      width: monitor.width,
      height: monitor.height,
      reactive: false,
    });
    dimmer.add_child(backdropContainer);
    const bgManager = new Background.BackgroundManager({
      container: backdropContainer,
      monitorIndex: Main.layoutManager.primaryIndex,
      controlPosition: false,
      useContentSize: false,
    });

    // Dedicated child container for clones. Keeping clones in their own
    // container (rather than attaching them directly to the dimmer) keeps
    // the dimmer free to host other chrome later (e.g. zone outlines,
    // labels) without those decorations sharing the clones' input routing.
    // Added AFTER the backdropContainer so it renders on top of the
    // wallpaper + dimmer tint.
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
    this.bgManager = bgManager;
    this.cloneContainer = cloneContainer;
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
   * The dedicated child container clones are parented to. It uses
   * `Clutter.FixedLayout` so the {@link WindowMirrorPort} production
   * implementation can position each clone at an absolute monitor-relative
   * coordinate (zone routing + auto-grid lives in `gnome-window-mirror.ts`
   * and `zone-layout.ts`).
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
    // Destroy the BackgroundManager BEFORE the dimmer (and therefore the
    // backdropContainer) goes away. `BackgroundManager.destroy()`
    // disconnects its internal signal handlers and releases its
    // `BackgroundSource` reference; skipping it leaks a wallpaper
    // texture and a couple of GSettings signal handlers per overlay
    // teardown / reload cycle.
    if (this.bgManager !== null) {
      this.bgManager.destroy();
      this.bgManager = null;
    }
    if (this.dimmer !== null) {
      Main.layoutManager.removeChrome(this.dimmer);
      // The clone container and the backdrop container are children of
      // the dimmer and get destroyed implicitly when the parent is
      // destroyed; null the references so the accessors do not hand out
      // a dangling widget.
      this.dimmer.destroy();
      this.dimmer = null;
    }
    this.cloneContainer = null;
    this.mounted = false;
    this.visible = false;
    this.cornerLatched = false;
  }
}

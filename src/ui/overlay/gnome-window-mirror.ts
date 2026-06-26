/**
 * GNOME Shell production implementation of {@link WindowMirrorPort}.
 *
 * Wraps the three Mutter / Clutter API points this PoC needs to validate:
 *
 *   1. `global.get_window_actors()` — enumerate other apps' window actors.
 *   2. `new Clutter.Clone({ source: actor })` — mirror an actor live into
 *      our overlay's scene graph.
 *   3. `meta_window.activate(global.get_current_time())` — raise the
 *      mirrored window when its clone is clicked.
 *
 * PoC step 3 deliberately keeps the surface small: at most one clone, no
 * `wm_class` filtering, no zone routing, primary monitor only. Filtering
 * is limited to the bare minimum needed to avoid mirroring obvious
 * non-application surfaces (non-`NORMAL` window types, minimized windows,
 * the dimmer's own chrome) — anything richer waits for PoC step 4.
 *
 * Sizing keeps the clone's aspect ratio and caps it at 40% of monitor
 * height / 70% of monitor width; the `Clutter.BinLayout` on the container
 * (the `OverlayActor` dimmer) centers it automatically, so no manual
 * positioning is needed here.
 */

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import type St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type { WindowMirrorPort, WindowMirrorSnapshot } from './ports.js';

/** Maximum fraction of the primary monitor's height the clone may occupy. */
const MAX_HEIGHT_FRACTION = 0.4;
/** Maximum fraction of the primary monitor's width the clone may occupy. */
const MAX_WIDTH_FRACTION = 0.7;

/** Source of window actors. Indirected so tests of this module can stub it. */
export type WindowActorSource = () => Meta.WindowActor[];
/** Source of the GNOME-Shell current event time, used by `activate`. */
export type CurrentTimeSource = () => number;

export class GnomeWindowMirror implements WindowMirrorPort {
  private clone: Clutter.Clone | null = null;
  private cloneClickId: number | null = null;
  private mirroredWindow: Meta.Window | null = null;
  private lastActivatedAt: number | null = null;

  constructor(
    /**
     * Callback that returns the parent the clone should be attached to. The
     * overlay actor owns the container; passing a getter (rather than the
     * actor itself) lets the overlay defer creating its scene graph until
     * `mount()` time and avoids holding a stale reference across teardown.
     */
    private readonly getContainer: () => St.Widget | null,
    /**
     * Source of window actors. Defaults to `global.get_window_actors()`; the
     * indirection exists so future PoC steps can wrap or filter the source
     * without touching this class.
     */
    private readonly getActors: WindowActorSource = () => global.get_window_actors(),
    /**
     * Source of the current event time for `MetaWindow.activate`. Defaults
     * to `global.get_current_time()`. Injectable for the same reason as
     * `getActors`.
     */
    private readonly getCurrentTime: CurrentTimeSource = () => global.get_current_time()
  ) {}

  mount(onActivated: () => void): boolean {
    if (this.clone !== null) {
      // Defensive: a previous mount() call left a clone attached. Tear it
      // down before mounting a fresh one so we never end up with two.
      this.unmount();
    }

    const container = this.getContainer();
    if (container === null) {
      console.warn('[Zatto] GnomeWindowMirror.mount: no clone container available');
      return false;
    }

    const actor = this.pickEligibleActor();
    if (actor === null) {
      // No eligible window today; let the controller open the dimmer
      // anyway so the user still sees the toggle worked.
      return false;
    }
    const win = actor.get_meta_window();
    if (win === null) {
      // Shouldn't happen — `pickEligibleActor` already filtered this — but
      // guard so the cast below is safe.
      return false;
    }

    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) {
      console.warn('[Zatto] GnomeWindowMirror.mount: no primary monitor available');
      return false;
    }

    const frame = win.get_frame_rect();
    const { width, height } = this.computeCloneSize(frame.width, frame.height, monitor);

    const clone = new Clutter.Clone({
      source: actor,
      reactive: true,
      width,
      height,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this.cloneClickId = clone.connect('button-press-event', () => {
      this.activateMirroredWindow();
      onActivated();
      return Clutter.EVENT_STOP;
    });

    container.add_child(clone);
    this.clone = clone;
    this.mirroredWindow = win;
    return true;
  }

  unmount(): void {
    if (this.clone !== null && this.cloneClickId !== null) {
      this.clone.disconnect(this.cloneClickId);
      this.cloneClickId = null;
    }
    if (this.clone !== null) {
      const parent = this.clone.get_parent();
      if (parent !== null) {
        parent.remove_child(this.clone);
      }
      this.clone.destroy();
      this.clone = null;
    }
    this.mirroredWindow = null;
  }

  snapshot(): WindowMirrorSnapshot {
    return {
      clonedCount: this.clone === null ? 0 : 1,
      lastActivatedAt: this.lastActivatedAt,
    };
  }

  private activateMirroredWindow(): void {
    const win = this.mirroredWindow;
    if (win === null) {
      return;
    }
    try {
      win.activate(this.getCurrentTime());
      this.lastActivatedAt = Date.now();
    } catch (e) {
      console.warn(`[Zatto] GnomeWindowMirror.activate failed: ${e}`);
    }
  }

  /**
   * Pick the first window actor worth mirroring for the PoC. Eligibility
   * is intentionally permissive — anything that is a normal, non-minimized
   * top-level window with an attached `MetaWindow` qualifies.
   */
  private pickEligibleActor(): Meta.WindowActor | null {
    for (const actor of this.getActors()) {
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
      return actor;
    }
    return null;
  }

  private computeCloneSize(
    sourceWidth: number,
    sourceHeight: number,
    monitor: { width: number; height: number }
  ): { width: number; height: number } {
    // Guard against degenerate source sizes (a window created mid-resize
    // can briefly report 0 dimensions).
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      const fallbackHeight = monitor.height * MAX_HEIGHT_FRACTION;
      return { width: fallbackHeight * (16 / 9), height: fallbackHeight };
    }
    const aspect = sourceWidth / sourceHeight;
    const maxH = monitor.height * MAX_HEIGHT_FRACTION;
    const maxW = monitor.width * MAX_WIDTH_FRACTION;
    let h = maxH;
    let w = h * aspect;
    if (w > maxW) {
      w = maxW;
      h = w / aspect;
    }
    return { width: w, height: h };
  }
}

/**
 * GNOME Shell production implementation of {@link WindowMirrorPort}.
 *
 * Enumerates every eligible top-level window and mirrors each one into
 * the overlay as a reactive clone placed at the source window's own
 * on-screen frame rect (relative to the primary monitor). Nothing is
 * moved or resized in x, y. Instead the stacking order is rendered as
 * depth: the plane of windows is viewed from a slight angle under an
 * orthographic projection, so each clone is offset sideways by how many
 * windows sit above it and drawn translucent, and the whole plane is
 * squashed and, if needed, scaled and shifted to stay on the monitor (see
 * `depth-layout.ts` for the geometry and tuning). Clicking a clone
 * activates its window.
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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { computeDepthLayout, DEPTH_VIEW_TUNING, type Rect } from './depth-layout.js';
import type { WindowMirrorPort, WindowMirrorSnapshot } from './ports.js';

/** A clone we mounted plus the bookkeeping we need to tear it down cleanly. */
interface MountedClone {
  readonly clone: Clutter.Clone;
  readonly clickHandlerId: number;
}

export class GnomeWindowMirror implements WindowMirrorPort {
  private clones: MountedClone[] = [];
  private lastActivatedAt: number | null = null;

  constructor(
    /**
     * Callback that returns the parent the clones should be attached to.
     * The overlay actor owns the container; passing a getter (rather than
     * the actor itself) lets the overlay defer creating its scene graph
     * until `mount()` time and avoids holding a stale reference across
     * teardown.
     */
    private readonly getContainer: () => St.Widget | null
  ) {}

  mount(onActivated: () => void): boolean {
    if (this.clones.length > 0) {
      // Defensive: a previous mount() call left clones attached. Tear
      // them down before mounting fresh ones so no window is mirrored
      // twice.
      this.unmount();
    }

    const container = this.getContainer();
    if (container === null) {
      console.warn('[Zatto] GnomeWindowMirror.mount: no clone container available');
      return false;
    }

    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) {
      console.warn('[Zatto] GnomeWindowMirror.mount: no primary monitor available');
      return false;
    }

    // Bottom-to-top, as `global.get_window_actors()` returns them. Clutter
    // paints children in insertion order and does not depth-sort, so the
    // topmost window must be added last.
    const entries = this.collectEligible()
      .map(({ actor, win }) => {
        const frame = win.get_frame_rect();
        const rect: Rect = {
          x: frame.x - monitor.x,
          y: frame.y - monitor.y,
          width: frame.width,
          height: frame.height,
        };
        return { actor, win, rect };
      })
      // Mutter occasionally hands back 0x0 mid-resize. Skip rather than
      // mount an invisible-but-reactive clone.
      .filter(({ rect }) => rect.width > 0 && rect.height > 0);
    const layout = computeDepthLayout(
      entries.map(({ rect }) => rect),
      { width: monitor.width, height: monitor.height },
      DEPTH_VIEW_TUNING
    );

    entries.forEach(({ actor, win, rect }, index) => {
      const clone = new Clutter.Clone({
        source: actor,
        reactive: true,
      });
      const placement = layout.clones[index];
      clone.set_position(rect.x + (placement?.offsetX ?? 0), rect.y);
      clone.set_size(rect.width, rect.height);
      if (placement !== undefined) {
        clone.opacity = placement.opacity;
      }

      const clickHandlerId = clone.connect('button-press-event', () => {
        this.activateWindow(win);
        onActivated();
        return Clutter.EVENT_STOP;
      });

      container.add_child(clone);
      this.clones.push({ clone, clickHandlerId });
    });

    // Project the tilted plane once, on the container, so every window
    // keeps its x, y relationship: the horizontal squash is the container's
    // x scale, and the fit scale and shift keep the whole plane on screen.
    const { scaleX, scaleY, translationX, translationY } = layout.container;
    container.set_pivot_point(0, 0);
    container.set_scale(scaleX, scaleY);
    container.set_translation(translationX, translationY, 0);

    return this.clones.length > 0;
  }

  unmount(): void {
    // Restore an untransformed container so the next mount starts flat.
    const container = this.getContainer();
    if (container !== null) {
      container.set_scale(1, 1);
      container.set_translation(0, 0, 0);
    }
    for (const mounted of this.clones) {
      this.disposeClone(mounted);
    }
    this.clones = [];
  }

  snapshot(): WindowMirrorSnapshot {
    return {
      clonedCount: this.clones.length,
      lastActivatedAt: this.lastActivatedAt,
    };
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

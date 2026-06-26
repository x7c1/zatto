/**
 * GNOME Shell production implementation of {@link WindowMirrorPort} for
 * PoC step 4.
 *
 * Step 3 mirrored a single window into the center of the dimmer. Step 4
 * enumerates every eligible top-level window, routes each to one of four
 * quadrant zones by its `wm_class`, and auto-grids same-zone windows
 * inside the zone rect with aspect-preserving cells. The layout math
 * itself lives in `zone-layout.ts` and the routing table in
 * `app-zone-map.ts` — both pure so they get covered by their own
 * vitest suites without a GJS shim.
 *
 * Three Mutter / Clutter API points this mirror sits on top of:
 *
 *   1. `global.get_window_actors()` — enumerate other apps' window actors.
 *   2. `new Clutter.Clone({ source: actor })` — mirror an actor live into
 *      our overlay's scene graph.
 *   3. `meta_window.activate(global.get_current_time())` — raise the
 *      mirrored window when its clone is clicked.
 *
 * Eligibility filter stays the same minimal set introduced in step 3:
 * `NORMAL && !minimized && meta_window != null`. The dimmer and the
 * `HotCornerTrigger` are `St.Widget`s and do not appear in
 * `global.get_window_actors()`, so the self-clone hazard from step 3's
 * notes still does not apply.
 */

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import type St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { resolveZone } from './app-zone-map.js';
import type { WindowMirrorByZone, WindowMirrorPort, WindowMirrorSnapshot } from './ports.js';
import {
  computeGrid,
  fitContentToCell,
  rectToPixels,
  ZONE_KEYS,
  ZONE_RECTS,
  type ZoneKey,
} from './zone-layout.js';

/** Padding inside each grid cell so adjacent clones don't visually touch. */
const CELL_PADDING_PX = 8;

/** Source of window actors. Indirected so tests of this module can stub it. */
export type WindowActorSource = () => Meta.WindowActor[];
/** Source of the GNOME-Shell current event time, used by `activate`. */
export type CurrentTimeSource = () => number;

/** A clone we mounted plus the bookkeeping we need to tear it down cleanly. */
interface MountedClone {
  readonly clone: Clutter.Clone;
  readonly clickHandlerId: number;
  readonly metaWindow: Meta.Window;
  readonly zone: ZoneKey;
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
    private readonly getContainer: () => St.Widget | null,
    /**
     * Source of window actors. Defaults to `global.get_window_actors()`;
     * the indirection exists so future PoC steps can wrap or filter the
     * source without touching this class.
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
    if (this.clones.length > 0) {
      // Defensive: a previous mount() call left clones attached. Tear them
      // down before mounting fresh ones so we never accumulate duplicates.
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

    const eligible = this.collectEligible();
    if (eligible.length === 0) {
      return false;
    }

    const grouped = this.groupByZone(eligible);
    for (const zone of ZONE_KEYS) {
      const entries = grouped[zone];
      if (entries.length === 0) {
        continue;
      }
      this.layoutZone(container, monitor, zone, entries, onActivated);
    }

    return this.clones.length > 0;
  }

  unmount(): void {
    for (const mounted of this.clones) {
      mounted.clone.disconnect(mounted.clickHandlerId);
      const parent = mounted.clone.get_parent();
      if (parent !== null) {
        parent.remove_child(mounted.clone);
      }
      mounted.clone.destroy();
    }
    this.clones = [];
  }

  snapshot(): WindowMirrorSnapshot {
    // Accumulate into a mutable counter map first; `WindowMirrorByZone`
    // is readonly so we build it via a single object literal at the end.
    const counters: Record<ZoneKey, number> = {
      topLeft: 0,
      topRight: 0,
      bottomLeft: 0,
      bottomRight: 0,
    };
    for (const mounted of this.clones) {
      counters[mounted.zone]++;
    }
    const byZone: WindowMirrorByZone = {
      topLeft: counters.topLeft,
      topRight: counters.topRight,
      bottomLeft: counters.bottomLeft,
      bottomRight: counters.bottomRight,
    };
    return {
      clonedCount: this.clones.length,
      byZone,
      lastActivatedAt: this.lastActivatedAt,
    };
  }

  /** Walk `global.get_window_actors()` and keep only mirror-worthy entries. */
  private collectEligible(): { actor: Meta.WindowActor; win: Meta.Window }[] {
    const out: { actor: Meta.WindowActor; win: Meta.Window }[] = [];
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
      out.push({ actor, win });
    }
    return out;
  }

  /** Bucket eligible windows by their resolved zone. */
  private groupByZone(
    eligible: { actor: Meta.WindowActor; win: Meta.Window }[]
  ): Record<ZoneKey, { actor: Meta.WindowActor; win: Meta.Window }[]> {
    const grouped: Record<ZoneKey, { actor: Meta.WindowActor; win: Meta.Window }[]> = {
      topLeft: [],
      topRight: [],
      bottomLeft: [],
      bottomRight: [],
    };
    for (const entry of eligible) {
      const zone = resolveZone(entry.win.get_wm_class());
      grouped[zone].push(entry);
    }
    return grouped;
  }

  /**
   * Place every entry of one zone into the dimmer container. Uses
   * {@link computeGrid} for cell partitioning and
   * {@link fitContentToCell} to honor aspect ratio inside each cell.
   */
  private layoutZone(
    container: St.Widget,
    monitor: { width: number; height: number },
    zone: ZoneKey,
    entries: { actor: Meta.WindowActor; win: Meta.Window }[],
    onActivated: () => void
  ): void {
    const zoneRect = rectToPixels(ZONE_RECTS[zone], monitor);
    const cells = computeGrid(zoneRect, entries.length);
    for (let i = 0; i < entries.length; i++) {
      const { actor, win } = entries[i];
      const cell = cells[i];
      const frame = win.get_frame_rect();
      const placed = fitContentToCell(cell, frame.width, frame.height, {
        padding: CELL_PADDING_PX,
      });
      if (placed.w <= 0 || placed.h <= 0) {
        // Cell too small after padding — skip rather than mount an
        // invisible-but-reactive clone the user could accidentally click.
        continue;
      }

      const clone = new Clutter.Clone({
        source: actor,
        reactive: true,
        x: placed.x,
        y: placed.y,
        width: placed.w,
        height: placed.h,
      });

      const clickHandlerId = clone.connect('button-press-event', () => {
        this.activateWindow(win);
        onActivated();
        return Clutter.EVENT_STOP;
      });

      container.add_child(clone);
      this.clones.push({ clone, clickHandlerId, metaWindow: win, zone });
    }
  }

  private activateWindow(win: Meta.Window): void {
    try {
      win.activate(this.getCurrentTime());
      this.lastActivatedAt = Date.now();
    } catch (e) {
      console.warn(`[Zatto] GnomeWindowMirror.activate failed: ${e}`);
    }
  }
}

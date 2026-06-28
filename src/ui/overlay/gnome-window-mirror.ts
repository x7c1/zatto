/**
 * GNOME Shell production implementation of {@link WindowMirrorPort}.
 *
 * Enumerates every eligible top-level window, routes each to a zone by
 * its `wm_class` using the injected {@link ZoneConfig}, and auto-grids
 * same-zone windows inside the zone rect with aspect-preserving cells.
 * The layout math itself lives in `zone-layout.ts`, the routing in
 * `app-zone-map.ts`, and the config data in `zone-config.ts` — all
 * pure so they get covered by their own vitest suites without a GJS
 * shim.
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
 *
 * A `null` resolved zone (when {@link ZoneConfig.fallbackZone} is
 * `null` and the window's `wm_class` is unrouted) drops the window
 * entirely: it is not mirrored, not counted in the snapshot, not
 * placed anywhere on screen.
 */

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import type St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { resolveZone } from './app-zone-map.js';
import type { WindowMirrorPort, WindowMirrorSnapshot } from './ports.js';
import type { ZoneConfig } from './zone-config.js';
import { computeGrid, fitContentToCell, rectToPixels, type ZoneKey } from './zone-layout.js';

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
     * Zone definitions, routing table, fallback zone, and cell padding —
     * everything that decides where and how clones land. Injected so
     * future PoC steps can swap the config source (file / GSettings /
     * prefs UI) without touching this class.
     */
    private readonly config: ZoneConfig,
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
    for (const zone of Object.keys(this.config.zones) as ZoneKey[]) {
      const entries = grouped[zone];
      if (entries === undefined || entries.length === 0) {
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
    // Seed counts at zero for every configured zone so the snapshot
    // exposes a stable key set even when some zones are empty. Walk
    // `Object.keys(this.config.zones)` (not a hardcoded list) so future
    // configs with extra zones surface in the snapshot automatically.
    const byZone: Record<string, number> = {};
    for (const zone of Object.keys(this.config.zones)) {
      byZone[zone] = 0;
    }
    for (const mounted of this.clones) {
      byZone[mounted.zone] = (byZone[mounted.zone] ?? 0) + 1;
    }
    return {
      clonedCount: this.clones.length,
      byZone,
      lastActivatedAt: this.lastActivatedAt,
      zoneConfig: this.config,
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

  /**
   * Bucket eligible windows by their resolved zone. Windows whose
   * `wm_class` is unrouted and whose config has `fallbackZone: null`
   * are skipped entirely — they don't appear in the result, so the
   * caller never mounts or counts them. That's how the "drop unrouted
   * windows" mode materializes at the GJS layer.
   */
  private groupByZone(
    eligible: { actor: Meta.WindowActor; win: Meta.Window }[]
  ): Record<string, { actor: Meta.WindowActor; win: Meta.Window }[]> {
    const grouped: Record<string, { actor: Meta.WindowActor; win: Meta.Window }[]> = {};
    for (const entry of eligible) {
      const zone = resolveZone(this.config, entry.win.get_wm_class());
      if (zone === null) {
        continue;
      }
      let bucket = grouped[zone];
      if (bucket === undefined) {
        bucket = [];
        grouped[zone] = bucket;
      }
      bucket.push(entry);
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
    const zoneRect = rectToPixels(this.config.zones[zone], monitor);
    const cells = computeGrid(zoneRect, entries.length);
    for (let i = 0; i < entries.length; i++) {
      const { actor, win } = entries[i];
      const cell = cells[i];
      const frame = win.get_frame_rect();
      const placed = fitContentToCell(cell, frame.width, frame.height, {
        padding: this.config.cellPaddingPx,
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

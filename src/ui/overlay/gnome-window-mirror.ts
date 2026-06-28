/**
 * GNOME Shell production implementation of {@link WindowMirrorPort}.
 *
 * Enumerates every eligible top-level window, routes each to a zone by
 * its `wm_class` using the injected {@link ZoneConfig}, packs them with
 * the justified-row {@link packIntoZone} algorithm, and (optionally)
 * eases every clone from its source window's on-screen rect to its
 * packed slot — and back again on unmount. The layout math itself lives
 * in `zone-layout.ts`, the routing in `app-zone-map.ts`, and the config
 * data in `zone-config.ts` — all pure so they get covered by their own
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
 *
 * A `null` resolved zone (when {@link ZoneConfig.fallbackZone} is
 * `null` and the window's `wm_class` is unrouted) drops the window
 * entirely: it is not mirrored, not counted in the snapshot, not
 * placed anywhere on screen.
 *
 * Easing semantics:
 *
 *   - Mount: clones are constructed at the source window's current
 *     on-screen rect and eased to their packed target rect.
 *   - Unmount (animated path): clones are eased back to the source
 *     window's *current* rect (re-read in case the user moved it
 *     during the overview) and destroyed in `onComplete`. If the
 *     underlying window vanished while the overview was open
 *     (`get_compositor_private() === null`), the clone fades in place
 *     instead — easing into a now-meaningless geometry would be a
 *     visible jank.
 *   - Unmount (immediate path): synchronous tear-down, no ease.
 *     Triggered when the caller asks for `{ immediate: true }` (the
 *     `disable()` path is the canonical user; the actor tree is about
 *     to be destroyed and an in-flight ease would risk firing
 *     callbacks against a doomed parent) OR when easing is otherwise
 *     disabled (per-config kill switch, or the system's reduced-motion
 *     preference).
 */

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { resolveZone } from './app-zone-map.js';
import type { WindowMirrorPort, WindowMirrorSnapshot } from './ports.js';
import type { EasingKey, ZoneConfig } from './zone-config.js';
import { packIntoZone, rectToPixels, type Sized, type ZoneKey } from './zone-layout.js';

/** Source of window actors. Indirected so tests of this module can stub it. */
export type WindowActorSource = () => Meta.WindowActor[];
/** Source of the GNOME-Shell current event time, used by `activate`. */
export type CurrentTimeSource = () => number;

/** A clone we mounted plus the bookkeeping we need to tear it down cleanly. */
interface MountedClone {
  readonly clone: Clutter.Clone;
  clickHandlerId: number;
  readonly metaWindow: Meta.Window;
  readonly zone: ZoneKey;
  /**
   * `true` while an unmount ease is in flight against this clone.
   * Lets a follow-up synchronous destroy (mount-during-unmount race or
   * extension disable) cancel the transition and free the actor without
   * waiting for `onComplete` — and lets the eventual `onComplete`
   * short-circuit if a synchronous destroy already happened.
   */
  transitionPending: boolean;
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
     * Zone definitions, routing table, fallback zone, gap, and animation
     * settings — everything that decides where and how clones land.
     * Injected so future PoC steps can swap the config source (file /
     * GSettings / prefs UI) without touching this class.
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
      // Defensive: a previous mount() call left clones attached, possibly
      // mid-ease. Synchronously tear them down before mounting fresh ones
      // — easing both directions at once would have the new mount's
      // forward ease fight the old unmount's reverse ease on the same
      // actors.
      this.unmount({ immediate: true });
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

  unmount(options?: { readonly immediate?: boolean }): void {
    const immediate = options?.immediate === true || !this.isAnimationEnabled();
    if (immediate) {
      for (const mounted of this.clones) {
        this.disposeCloneSync(mounted);
      }
      this.clones = [];
      return;
    }

    // Animated tear-down. Keep `this.clones` populated until each ease
    // completes so the snapshot reflects in-flight reality and so a
    // re-entry into mount() during the ease can correctly detect "there
    // are still clones attached" and route through the synchronous
    // unmount path.
    const easingMode = resolveEasingMode(this.config.animation.easing);
    const duration = this.config.animation.durationMs;
    const monitor = Main.layoutManager.primaryMonitor;
    for (const mounted of this.clones) {
      if (mounted.transitionPending) {
        // Already easing from a prior unmount call — leave it alone.
        continue;
      }
      mounted.transitionPending = true;
      // Disconnect click immediately so a mid-ease click can't fire a
      // second activation against a dying clone.
      if (mounted.clickHandlerId !== 0) {
        mounted.clone.disconnect(mounted.clickHandlerId);
        mounted.clickHandlerId = 0;
      }

      const compositorPrivate = mounted.metaWindow.get_compositor_private();
      if (compositorPrivate === null) {
        // The underlying window was destroyed while we held the overview.
        // Easing toward `get_frame_rect()` here would either snap to a
        // stale rect or crash on a dangling reference — fade in place
        // instead so the clone disappears gracefully without motion.
        mounted.clone.ease({
          opacity: 0,
          duration,
          mode: easingMode,
          onComplete: () => this.finalizeUnmount(mounted),
        });
      } else {
        const frame = mounted.metaWindow.get_frame_rect();
        const targetX = frame.x - (monitor?.x ?? 0);
        const targetY = frame.y - (monitor?.y ?? 0);
        mounted.clone.ease({
          x: targetX,
          y: targetY,
          width: frame.width,
          height: frame.height,
          duration,
          mode: easingMode,
          onComplete: () => this.finalizeUnmount(mounted),
        });
      }
    }
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
      const zone = resolveZone(
        this.config,
        entry.win.get_wm_class(),
        entry.win.get_wm_class_instance()
      );
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
   * Place every entry of one zone into the dimmer container using the
   * justified-row {@link packIntoZone} algorithm, then either ease each
   * clone from its source window's on-screen rect to its packed slot
   * (when animations are enabled) or snap directly to the target.
   */
  private layoutZone(
    container: St.Widget,
    monitor: { x: number; y: number; width: number; height: number },
    zone: ZoneKey,
    entries: { actor: Meta.WindowActor; win: Meta.Window }[],
    onActivated: () => void
  ): void {
    const zoneRect = rectToPixels(this.config.zones[zone], monitor);
    const sized: Sized[] = entries.map(({ win }) => {
      const frame = win.get_frame_rect();
      if (frame.width <= 0 || frame.height <= 0) {
        // Mutter occasionally hands back 0x0 mid-resize; the packer
        // treats degenerate sources as aspect 1 internally, but
        // returning a sentinel here documents the intent at the call
        // site instead of relying on the packer's silent fallback.
        return { w: 1, h: 1 };
      }
      return { w: frame.width, h: frame.height };
    });

    const targets = packIntoZone(zoneRect, sized, { gap: this.config.windowGapPx });

    const animationEnabled = this.isAnimationEnabled();
    const easingMode = resolveEasingMode(this.config.animation.easing);
    const duration = this.config.animation.durationMs;

    for (let i = 0; i < entries.length; i++) {
      const { actor, win } = entries[i];
      const target = targets[i];
      if (target.w <= 0 || target.h <= 0) {
        // Packed slot collapsed to nothing — skip rather than mount an
        // invisible-but-reactive clone the user could accidentally click.
        continue;
      }

      const frame = win.get_frame_rect();
      const initialX = frame.x - monitor.x;
      const initialY = frame.y - monitor.y;
      const initialW = frame.width > 0 ? frame.width : target.w;
      const initialH = frame.height > 0 ? frame.height : target.h;

      const clone = new Clutter.Clone({
        source: actor,
        reactive: true,
      });
      // Start at the source window's on-screen geometry so the ease
      // produces a "flying from real position into the zone" motion
      // analogous to the Activities Overview.
      clone.set_position(initialX, initialY);
      clone.set_size(initialW, initialH);

      const clickHandlerId = clone.connect('button-press-event', () => {
        this.activateWindow(win);
        onActivated();
        return Clutter.EVENT_STOP;
      });

      container.add_child(clone);

      if (animationEnabled) {
        clone.ease({
          x: target.x,
          y: target.y,
          width: target.w,
          height: target.h,
          duration,
          mode: easingMode,
        });
      } else {
        clone.set_position(target.x, target.y);
        clone.set_size(target.w, target.h);
      }

      this.clones.push({
        clone,
        clickHandlerId,
        metaWindow: win,
        zone,
        transitionPending: false,
      });
    }
  }

  /**
   * Whether mount / unmount eases should run. Both the per-config kill
   * switch and the user's system-wide reduced-motion preference can
   * disable easing; the config can never override the system pref in
   * the "on" direction.
   */
  private isAnimationEnabled(): boolean {
    if (!this.config.animation.enabled) {
      return false;
    }
    return St.Settings.get().enable_animations;
  }

  /**
   * Synchronous tear-down for a single mounted clone. Cancels any
   * in-flight transition, disconnects the click handler if still
   * connected, removes the actor from its parent, and destroys it.
   */
  private disposeCloneSync(mounted: MountedClone): void {
    if (mounted.transitionPending) {
      mounted.clone.remove_all_transitions();
      mounted.transitionPending = false;
    }
    if (mounted.clickHandlerId !== 0) {
      mounted.clone.disconnect(mounted.clickHandlerId);
      mounted.clickHandlerId = 0;
    }
    const parent = mounted.clone.get_parent();
    if (parent !== null) {
      parent.remove_child(mounted.clone);
    }
    mounted.clone.destroy();
  }

  /**
   * `onComplete` continuation for an animated unmount. Short-circuits if
   * a synchronous destroy already cleared `transitionPending` so we do
   * not double-destroy or touch a dangling actor.
   */
  private finalizeUnmount(mounted: MountedClone): void {
    if (!mounted.transitionPending) {
      return;
    }
    mounted.transitionPending = false;
    const idx = this.clones.indexOf(mounted);
    if (idx !== -1) {
      this.clones.splice(idx, 1);
    }
    const parent = mounted.clone.get_parent();
    if (parent !== null) {
      parent.remove_child(mounted.clone);
    }
    mounted.clone.destroy();
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

/**
 * Map the JSON-friendly {@link EasingKey} to the Clutter integer
 * constant `actor.ease()` expects. Centralized so the rest of the
 * mirror never imports a `Clutter.AnimationMode` value directly.
 */
function resolveEasingMode(key: EasingKey): Clutter.AnimationMode {
  switch (key) {
    case 'easeOutQuad':
      return Clutter.AnimationMode.EASE_OUT_QUAD;
    case 'easeOutCubic':
      return Clutter.AnimationMode.EASE_OUT_CUBIC;
    case 'linear':
      return Clutter.AnimationMode.LINEAR;
  }
}

/**
 * GNOME Shell production implementation of {@link RealWindowsVisibilityPort}.
 *
 * Toggles BOTH `global.window_group` AND `global.top_window_group`, matching
 * gnome-shell's own `LayoutManager._updateVisibility()` pattern (see
 * `gnome-shell/js/ui/layout.js`, which flips `visible` on both groups when
 * entering / leaving the Activities Overview). `window_group` parents normal
 * Mutter window actors; `top_window_group` parents popups, OSDs,
 * notifications, drag indicators, and pad-OSDs that would otherwise leak
 * through the overlay backdrop. Hiding both is the only way to make "the
 * real desktop is gone" hold across every Mutter-managed surface.
 *
 * This is documented-safe with `Clutter.Clone`: clones keep painting their
 * sources regardless of whether the source group is visible, because
 * Clutter samples the source's texture, not its on-stage geometry.
 *
 * Why both groups (was originally avoided, then reverted again): an
 * earlier iteration of this port speculated that flipping
 * `top_window_group.visible` would race the shell's own visibility writes
 * and produce visible re-arrangement artifacts. Reading the gnome-shell
 * source disproved that — the shell happily flips both groups itself
 * with no cascade. The dropped-`top_window_group` variant ALSO failed to
 * resolve the user-reported jitter, which confirms the speculation was
 * misdirected. Restoring both groups is the only way to keep popups /
 * OSDs / notifications from leaking through.
 *
 * Why `visible = false` (was briefly opacity-only, then reverted): a
 * previous iteration switched to `opacity = 0` while leaving `visible`
 * untouched, hoping to avoid a hypothetical `notify::visible` cascade
 * that would jitter the source paint visible through the clones. That
 * hypothesis was also disproven — gnome-shell itself relies on `visible`
 * flips with no cascade issues, and the opacity-only variant did not
 * fix the user-reported jitter either. The real cause of the
 * "background jitter" complaint was architectural: the overlay's
 * semi-transparent dimmer is a translucent layer with mysterious live
 * motion visible through it (the clones above sample their sources
 * every frame). The fix lives in `overlay-actor.ts`, which now mounts
 * an opaque wallpaper backdrop below the dimmer — once there is
 * nothing translucent to look through, the jitter complaint vanishes.
 * This port is back to the gnome-shell-standard `visible = false`
 * pattern as a result.
 *
 * Safety contract — see {@link RealWindowsVisibilityPort} for the full
 * spec. The three things this implementation guarantees:
 *
 * 1. {@link restore} is synchronous, idempotent, and always safe to
 *    call — even when `config.hideRealWindows` is `false`. It is the
 *    last line of defense if the overlay code path throws while the
 *    desktop is hidden, and it defensively resets `visible = true; opacity = 255`
 *    on both groups in case any external code (another extension,
 *    a shell glitch) left them hidden.
 * 2. Every write to `visible` / `opacity` is preceded by
 *    `remove_all_transitions()` on each group, so a stale in-flight
 *    ease can't resurrect a hidden state after a restore.
 * 3. When easing is otherwise disabled (kill switch off, system
 *    reduced-motion, or `fadeMs === 0`), the hide/show paths fall back
 *    to synchronous `visible` writes with no ease in flight.
 *
 * The {@link snapshot} return value reports the port's *intent*
 * (`hidden` after a successful {@link hide}, `false` otherwise), not
 * the live Clutter state, because the actor properties can be
 * mid-transition.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import type { RealWindowsVisibilityPort, RealWindowsVisibilitySnapshot } from './ports.js';
import type { BackdropConfig } from './zone-config.js';

export class GnomeRealWindowsVisibility implements RealWindowsVisibilityPort {
  private hiddenIntent = false;
  private lastRestoredAt: number | null = null;

  constructor(private readonly config: BackdropConfig) {}

  hide(): void {
    if (!this.config.hideRealWindows) {
      return;
    }
    const groups = this.groups();
    if (this.shouldEase()) {
      for (const group of groups) {
        group.remove_all_transitions();
        // Start the fade from the current opacity (which `show()`
        // restores to 255 on every re-open), then flip `visible = false`
        // once the fade lands so subsequent input does not hit the
        // actor. The hard-cut path below mirrors gnome-shell's overview
        // pattern: just set `visible = false` directly.
        group.ease({
          opacity: 0,
          duration: this.config.fadeMs,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          onComplete: () => {
            group.visible = false;
            // Reset opacity so the next `show()` can ease 0 → 255 from a
            // clean baseline.
            group.opacity = 255;
          },
        });
      }
    } else {
      for (const group of groups) {
        group.remove_all_transitions();
        group.visible = false;
        group.opacity = 255;
      }
    }
    this.hiddenIntent = true;
  }

  show(): void {
    if (!this.config.hideRealWindows) {
      return;
    }
    const groups = this.groups();
    if (this.shouldEase()) {
      for (const group of groups) {
        group.remove_all_transitions();
        // Make the group visible first so the fade-in is observable,
        // starting from opacity 0.
        group.opacity = 0;
        group.visible = true;
        group.ease({
          opacity: 255,
          duration: this.config.fadeMs,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
      }
    } else {
      for (const group of groups) {
        group.remove_all_transitions();
        group.visible = true;
        group.opacity = 255;
      }
    }
    this.hiddenIntent = false;
  }

  restore(): void {
    // Defense in depth: runs regardless of `config.hideRealWindows`. If
    // the kill switch was flipped mid-session while the desktop was
    // hidden (or a previous instance died in the hidden state) this is
    // the only way back to a usable screen.
    for (const group of this.groups()) {
      group.remove_all_transitions();
      group.visible = true;
      group.opacity = 255;
    }
    this.hiddenIntent = false;
    this.lastRestoredAt = Date.now();
  }

  snapshot(): RealWindowsVisibilitySnapshot {
    return {
      hidden: this.hiddenIntent,
      lastRestoredAt: this.lastRestoredAt,
    };
  }

  private shouldEase(): boolean {
    if (this.config.fadeMs <= 0) {
      return false;
    }
    return St.Settings.get().enable_animations;
  }

  private groups(): readonly Clutter.Actor[] {
    // Both groups, matching gnome-shell's `LayoutManager._updateVisibility()`
    // — see the file header for the rationale (and why earlier iterations
    // that operated on `window_group` only were wrong).
    return [global.window_group, global.top_window_group];
  }
}

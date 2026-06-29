/**
 * GNOME Shell production implementation of {@link RealWindowsVisibilityPort}.
 *
 * Toggles `global.window_group` and `global.top_window_group` — the two
 * top-level containers Mutter parents every normal window actor under —
 * so the user's real desktop windows are not visually mixed with the
 * live `Clutter.Clone` thumbnails the overlay paints over them. This is
 * the same pattern Mutter's built-in Activities Overview uses, and it is
 * documented-safe with `Clutter.Clone`: clones keep painting their
 * sources regardless of whether the source group is visible, because
 * Clutter samples the source's texture, not its on-stage geometry.
 *
 * Safety contract — see {@link RealWindowsVisibilityPort} for the full
 * spec. The three things this implementation guarantees:
 *
 * 1. {@link restore} is synchronous, idempotent, and always safe to
 *    call — even when `config.hideRealWindows` is `false`. It is the
 *    last line of defense if the overlay code path throws while the
 *    desktop is hidden.
 * 2. Every write to `visible` / `opacity` is preceded by
 *    `remove_all_transitions()` on both groups, so a stale in-flight
 *    ease can't resurrect the hidden state after a restore.
 * 3. When easing is otherwise disabled (kill switch off, system
 *    reduced-motion, or `fadeMs === 0`), the hide/show paths fall back
 *    to synchronous `visible` + `opacity` writes with no ease in
 *    flight.
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
    const groups = this.collectGroups();
    for (const group of groups) {
      group.remove_all_transitions();
    }
    if (this.shouldEase()) {
      for (const group of groups) {
        group.ease({
          opacity: 0,
          duration: this.config.fadeMs,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          onComplete: () => {
            group.visible = false;
          },
        });
      }
    } else {
      for (const group of groups) {
        group.opacity = 0;
        group.visible = false;
      }
    }
    this.hiddenIntent = true;
  }

  show(): void {
    if (!this.config.hideRealWindows) {
      return;
    }
    const groups = this.collectGroups();
    for (const group of groups) {
      group.remove_all_transitions();
      // Flip visibility back on immediately so the fade-in is actually
      // observable. Leaving `visible = false` would make the opacity
      // ease land on a non-rendered actor and the user would only see
      // the result snap in at the end.
      group.visible = true;
    }
    if (this.shouldEase()) {
      for (const group of groups) {
        group.ease({
          opacity: 255,
          duration: this.config.fadeMs,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
      }
    } else {
      for (const group of groups) {
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
    const groups = this.collectGroups();
    for (const group of groups) {
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

  private collectGroups(): Clutter.Actor[] {
    // Both groups are top-level Mutter containers; hiding only one
    // leaves the other (notably override-redirect popups and the
    // top-window layer) visible and undoes the whole point of the
    // step. Always touch both together.
    return [global.window_group, global.top_window_group];
  }
}

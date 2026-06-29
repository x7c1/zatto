/**
 * GNOME Shell production implementation of {@link RealWindowsVisibilityPort}.
 *
 * Toggles ONLY `global.window_group` — the top-level Mutter container that
 * parents every normal window actor — so the user's real desktop windows are
 * not visually mixed with the live `Clutter.Clone` thumbnails the overlay
 * paints over them. This is documented-safe with `Clutter.Clone`: clones keep
 * painting their sources regardless of whether the source group is visible,
 * because Clutter samples the source's texture, not its on-stage geometry.
 *
 * Why `top_window_group` is deliberately NOT touched: it contains
 * shell-managed surfaces (panel popups, OSD volume/brightness indicators,
 * drag indicators, etc.) that gnome-shell coordinates internally — it shows
 * and hides them on its own schedule in response to its own signals. Mutter's
 * built-in Activities Overview can manipulate both groups because the shell
 * IS the manipulator and knows what's in there; an extension does not have
 * that coordination. Flipping `top_window_group.visible` from this port
 * therefore races the shell's own visibility writes, producing visible
 * re-arrangement artifacts (popups appearing to "pop" back, the panel
 * flickering during the open animation) that look like the overlay is
 * re-running its layout. Leaving `top_window_group` alone keeps that layer
 * under the shell's exclusive control where it belongs. Reverted in the
 * step 5d follow-up after these artifacts were observed on real hardware.
 *
 * Safety contract — see {@link RealWindowsVisibilityPort} for the full
 * spec. The three things this implementation guarantees:
 *
 * 1. {@link restore} is synchronous, idempotent, and always safe to
 *    call — even when `config.hideRealWindows` is `false`. It is the
 *    last line of defense if the overlay code path throws while the
 *    desktop is hidden.
 * 2. Every write to `visible` / `opacity` is preceded by
 *    `remove_all_transitions()` on the window group, so a stale
 *    in-flight ease can't resurrect the hidden state after a restore.
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
    const group = this.group();
    group.remove_all_transitions();
    if (this.shouldEase()) {
      group.ease({
        opacity: 0,
        duration: this.config.fadeMs,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
          group.visible = false;
        },
      });
    } else {
      group.opacity = 0;
      group.visible = false;
    }
    this.hiddenIntent = true;
  }

  show(): void {
    if (!this.config.hideRealWindows) {
      return;
    }
    const group = this.group();
    group.remove_all_transitions();
    // Flip visibility back on immediately so the fade-in is actually
    // observable. Leaving `visible = false` would make the opacity
    // ease land on a non-rendered actor and the user would only see
    // the result snap in at the end.
    group.visible = true;
    if (this.shouldEase()) {
      group.ease({
        opacity: 255,
        duration: this.config.fadeMs,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    } else {
      group.opacity = 255;
    }
    this.hiddenIntent = false;
  }

  restore(): void {
    // Defense in depth: runs regardless of `config.hideRealWindows`. If
    // the kill switch was flipped mid-session while the desktop was
    // hidden (or a previous instance died in the hidden state) this is
    // the only way back to a usable screen.
    const group = this.group();
    group.remove_all_transitions();
    group.visible = true;
    group.opacity = 255;
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

  private group(): Clutter.Actor {
    // Only `window_group` is touched. `top_window_group` contains
    // shell-managed surfaces (panel popups, OSDs, drag indicators) that
    // the shell coordinates internally; manipulating it from an extension
    // causes the shell to re-show on its own schedule, producing visible
    // re-arrangement artifacts. See the file header for the full rationale.
    return global.window_group;
  }
}

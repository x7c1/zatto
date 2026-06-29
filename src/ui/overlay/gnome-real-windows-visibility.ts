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
 * Why `visible` is deliberately NOT written on the hide / show paths
 * (H4): even on `window_group` alone, assigning to `Clutter.Actor.visible`
 * fires a `notify::visible` signal. gnome-shell's own coordination layer
 * reacts to visibility changes on the standard window groups by issuing
 * resize / redraw requests against the group's children (the real
 * MetaWindow actors that the live `Clutter.Clone` thumbnails are sampling).
 * Our extension has none of the matching coordination, so the cascade
 * surfaces as continuous source-side jitter — visible to the user
 * *through* the clones, which replay the source's paint every frame.
 * Going opacity-only on hide / show (`opacity = 0` / `opacity = 255`) and
 * leaving the group `visible = true` throughout removes the trigger
 * without sacrificing the "real windows look gone" effect, because
 * `Clutter.Clone` overrides the clone's own opacity via
 * `clutter_clone_paint`'s `set_opacity_override` — so even though the
 * source group is fully transparent, each clone paints its source at the
 * clone's own opacity. {@link restore} is the only place that still
 * writes `visible = true`, as a defense-in-depth measure (see below).
 *
 * Safety contract — see {@link RealWindowsVisibilityPort} for the full
 * spec. The three things this implementation guarantees:
 *
 * 1. {@link restore} is synchronous, idempotent, and always safe to
 *    call — even when `config.hideRealWindows` is `false`. It is the
 *    last line of defense if the overlay code path throws while the
 *    desktop is hidden, and it defensively resets `visible = true` in
 *    case any external code (another extension, a shell glitch) left
 *    the group hidden. Under normal operation the hide / show paths
 *    never set `visible = false`, so the write here is redundant but
 *    harmless.
 * 2. Every write to `opacity` is preceded by `remove_all_transitions()`
 *    on the window group, so a stale in-flight ease can't resurrect a
 *    hidden state after a restore.
 * 3. When easing is otherwise disabled (kill switch off, system
 *    reduced-motion, or `fadeMs === 0`), the hide/show paths fall back
 *    to synchronous `opacity` writes with no ease in flight.
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
    // Opacity-only: see the file header (H4). Writing `visible = false`
    // fires `notify::visible` on `window_group`, which appears to trigger
    // shell-side coordination that cascades into source-window jitter
    // visible *through* the Clutter.Clone children. Leaving the group
    // `visible = true` and dropping opacity to 0 gives the same "real
    // windows gone" effect because clones override their own opacity
    // when sampling the source, so the clones still paint at full
    // opacity over the now-invisible (opacity 0) sources.
    if (this.shouldEase()) {
      group.ease({
        opacity: 0,
        duration: this.config.fadeMs,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    } else {
      group.opacity = 0;
    }
    this.hiddenIntent = true;
  }

  show(): void {
    if (!this.config.hideRealWindows) {
      return;
    }
    const group = this.group();
    group.remove_all_transitions();
    // Opacity-only on the reverse path too — see {@link hide} and the
    // file header. The group is already `visible = true` because we
    // never set it false; only opacity needs to come back.
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
    //
    // We *do* write `visible = true` here, even though the H4 rationale
    // (see file header) calls for avoiding `visible` writes on the
    // hide / show paths. This restore is the safety net invoked from
    // `enable()`, `disable()`, and the `handleOpen()` catch — its job
    // is to leave the desktop in a known-good state regardless of
    // what previous code (an earlier extension version, another
    // extension, a shell glitch) may have done to the group. The
    // shell-side cascade described in H4 is acceptable here because
    // the overlay clones are not on stage at restore time, so any
    // re-paint of the source windows is not visible through a clone.
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

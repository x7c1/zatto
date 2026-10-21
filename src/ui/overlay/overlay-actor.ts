/**
 * Overlay actor: work-area dimmer that hosts live window clones.
 *
 * The dimmer itself is reactive so it absorbs background clicks. It covers
 * only the primary monitor's work area (see `work-area.ts`), the space
 * between the top bar and the dock: the modal grab is taken on the stage
 * (see `gnome-modal-grab.ts`), so the top bar and the dock keep receiving
 * input, and a monitor-wide dimmer added as chrome after them would paint
 * over them and intercept their clicks. The dim colour lives on a separate
 * shade child below the clone container, both at the dimmer's origin. Fading
 * the shade in on `show()` and out on `hide()` does not fade the clones
 * with it (they ease on their own, see `gnome-window-mirror.ts`). The
 * "what does the user see" content is supplied by the
 * {@link WindowMirrorPort} production implementation, which adds live
 * `Clutter.Clone` actors as children of the dedicated clone container
 * returned by {@link OverlayActor.getCloneContainer}. The clone container
 * uses `Clutter.FixedLayout` so the window mirror can position each clone
 * by absolute work-area-relative coordinates (see `gnome-window-mirror.ts`).
 * A second, untransformed container above it, returned by
 * {@link OverlayActor.getChromeContainer}, hosts the decorations drawn over
 * the clones (the cycle strip, see `cycle-strip.ts`).
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { shouldAnimate } from '../../libs/shell/animations.js';
import { safeAddChrome } from '../../libs/shell/safe-add-chrome.js';
import { primaryWorkArea } from '../../libs/shell/work-area.js';
import { DEPTH_VIEW_TUNING, type Rect } from './depth-layout.js';
import type { OverlayActorPort } from './ports.js';

const EASE_MODE = Clutter.AnimationMode.EASE_OUT_QUAD;

const SHADE_STYLE = 'background-color: rgba(0, 0, 0, 0.5);';

export class OverlayActor implements OverlayActorPort {
  private dimmer: St.Widget | null = null;
  private shade: St.Widget | null = null;
  private cloneContainer: St.Widget | null = null;
  private chromeContainer: St.Widget | null = null;
  private mounted = false;
  private visible = false;

  /** Mount the dimmer to the Shell chrome (hidden until `show()` is called). */
  mount(): void {
    if (this.mounted) {
      return;
    }

    const workArea = primaryWorkArea();
    if (workArea === null) {
      // Cannot meaningfully position the overlay without a primary monitor;
      // bail without throwing — `show()` will become a no-op until next mount.
      console.warn('[Zatto] OverlayActor.mount: no primary monitor available');
      return;
    }

    const dimmer = new St.Widget({
      reactive: true,
      visible: false,
      // FixedLayout keeps the shade and the clone container at the
      // dimmer's origin. BinLayout would force-center every child, breaking
      // in-place positioning.
      layout_manager: new Clutter.FixedLayout(),
    });
    dimmer.add_style_class_name('zatto-overlay-dimmer');

    // The dim colour, below the clones. Its opacity is what fades.
    const shade = new St.Widget({
      style: SHADE_STYLE,
      reactive: false,
      opacity: 0,
    });
    shade.add_style_class_name('zatto-overlay-shade');
    dimmer.add_child(shade);

    // Dedicated child container for clones. Keeping clones in their own
    // container (rather than attaching them directly to the dimmer) keeps
    // the dimmer free to host other chrome later (e.g. outlines or
    // labels) without those decorations sharing the clones' input routing.
    // It does not clip: a clone whose window extends outside the work
    // area starts outside the container and eases in.
    const cloneContainer = new St.Widget({
      reactive: false,
      layout_manager: new Clutter.FixedLayout(),
    });
    cloneContainer.add_style_class_name('zatto-overlay-clones');
    dimmer.add_child(cloneContainer);

    // Decorations drawn over the clones. Separate from the clone container
    // so they are not scaled with it and their own reactive children do not
    // change the clones' input routing.
    const chromeContainer = new St.Widget({
      reactive: false,
      layout_manager: new Clutter.FixedLayout(),
    });
    chromeContainer.add_style_class_name('zatto-overlay-chrome');
    dimmer.add_child(chromeContainer);

    safeAddChrome(dimmer);
    this.dimmer = dimmer;
    this.shade = shade;
    this.cloneContainer = cloneContainer;
    this.chromeContainer = chromeContainer;
    this.fitGeometry(workArea);
    this.mounted = true;
  }

  /**
   * Place the dimmer on the primary monitor's work area and the shade, the
   * clone container and the chrome container at its origin, covering it. The work area is
   * re-read on every `show()` rather than kept from `mount()`: it changes
   * after the extension is enabled whenever the dock or the panel changes
   * the space it reserves (e.g. a dock that sets its strut late at login,
   * or auto-hide toggled), and the window mirror reads it fresh on every
   * open, so a stale container would put the clones off their windows.
   */
  private fitGeometry(workArea: Rect): void {
    const { dimmer, shade, cloneContainer, chromeContainer } = this;
    if (dimmer === null || shade === null || cloneContainer === null || chromeContainer === null) {
      return;
    }
    dimmer.set_position(workArea.x, workArea.y);
    dimmer.set_size(workArea.width, workArea.height);
    for (const child of [shade, cloneContainer, chromeContainer]) {
      child.set_position(0, 0);
      child.set_size(workArea.width, workArea.height);
    }
  }

  show(): void {
    const { dimmer, shade } = this;
    if (dimmer === null || shade === null) {
      return;
    }
    // Cancel a fade-out in flight so its completion does not hide the
    // dimmer we are showing again; the fade-in starts from where it was.
    shade.remove_all_transitions();
    const workArea = primaryWorkArea();
    if (workArea !== null) {
      this.fitGeometry(workArea);
    }
    dimmer.reactive = true;
    dimmer.show();
    if (shouldAnimate()) {
      shade.ease({ opacity: 255, duration: DEPTH_VIEW_TUNING.transitionMs, mode: EASE_MODE });
    } else {
      shade.opacity = 255;
    }
    this.visible = true;
  }

  hide(): void {
    const { dimmer, shade } = this;
    if (dimmer === null || shade === null) {
      return;
    }
    this.visible = false;
    shade.remove_all_transitions();
    // The dimmer stays on stage while the shade fades and the clones it
    // hosts ease back; stop it from swallowing clicks meanwhile.
    dimmer.reactive = false;
    if (shouldAnimate()) {
      shade.ease({
        opacity: 0,
        duration: DEPTH_VIEW_TUNING.transitionMs,
        mode: EASE_MODE,
        // Only on a finished fade: a `show()` cancelling it keeps the dimmer.
        onComplete: () => dimmer.hide(),
      });
    } else {
      shade.opacity = 0;
      dimmer.hide();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * The root actor of the overlay. The modal grab uses it to tell presses
   * inside the overlay (on the shade or a clone) from presses outside it.
   */
  getActor(): Clutter.Actor | null {
    return this.dimmer;
  }

  /**
   * The dedicated child container clones are parented to. It uses
   * `Clutter.FixedLayout` so the {@link WindowMirrorPort} production
   * implementation can position each clone at an absolute
   * work-area-relative coordinate (see `gnome-window-mirror.ts`).
   */
  getCloneContainer(): St.Widget | null {
    return this.cloneContainer;
  }

  /**
   * The container for decorations drawn over the clones, such as the cycle
   * strip. It covers the work area like the clone container but is never
   * transformed, and is not itself reactive.
   */
  getChromeContainer(): St.Widget | null {
    return this.chromeContainer;
  }

  /** Unmount and destroy. Idempotent. */
  destroy(): void {
    // A pending fade's completion must not touch a destroyed dimmer.
    this.shade?.remove_all_transitions();
    this.shade = null;
    if (this.dimmer !== null) {
      Main.layoutManager.removeChrome(this.dimmer);
      // The clone container is a child of the dimmer and gets destroyed
      // implicitly when the parent is destroyed; null the reference so
      // `getCloneContainer()` does not hand out a dangling widget.
      this.dimmer.destroy();
      this.dimmer = null;
    }
    this.cloneContainer = null;
    this.chromeContainer = null;
    this.mounted = false;
    this.visible = false;
  }
}

/**
 * Overlay actor: full-monitor dimmer with a single centered placeholder card.
 *
 * This is the bare-bones visual surface for the hot-corner toggle PoC.
 * Subsequent PoC steps will replace the placeholder card with window clones
 * arranged into per-app zones.
 *
 * The dimmer is reactive so it absorbs background clicks; the card itself is
 * decorative for now.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { safeAddChrome } from '../../libs/shell/safe-add-chrome.js';
import type { OverlayActorPort } from './ports.js';

const CARD_WIDTH = 400;
const CARD_HEIGHT = 300;

const DIMMER_STYLE = 'background-color: rgba(0, 0, 0, 0.5);';
const CARD_STYLE = [
  'background-color: rgba(40, 40, 40, 0.95);',
  'border: 1px solid rgba(255, 255, 255, 0.15);',
  'border-radius: 12px;',
  'color: #ffffff;',
  'font-size: 16px;',
  'padding: 24px;',
].join(' ');

export class OverlayActor implements OverlayActorPort {
  private dimmer: St.Widget | null = null;
  private mounted = false;
  private visible = false;

  /** Mount the dimmer to the Shell chrome (hidden until `show()` is called). */
  mount(): void {
    if (this.mounted) {
      return;
    }

    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) {
      // Cannot meaningfully position the overlay without a primary monitor;
      // bail without throwing — `show()` will become a no-op until next mount.
      console.warn('[Zatto] OverlayActor.mount: no primary monitor available');
      return;
    }

    const dimmer = new St.Widget({
      style: DIMMER_STYLE,
      reactive: true,
      visible: false,
      x: monitor.x,
      y: monitor.y,
      width: monitor.width,
      height: monitor.height,
      layout_manager: new Clutter.BinLayout(),
    });
    dimmer.add_style_class_name('zatto-overlay-dimmer');

    const card = new St.Widget({
      style: CARD_STYLE,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      reactive: false,
    });
    card.add_style_class_name('zatto-overlay-card');
    dimmer.add_child(card);

    safeAddChrome(dimmer, { trackFullscreen: true });
    this.dimmer = dimmer;
    this.mounted = true;
  }

  show(): void {
    if (this.dimmer === null) {
      return;
    }
    this.dimmer.show();
    this.visible = true;
  }

  hide(): void {
    if (this.dimmer === null) {
      return;
    }
    this.dimmer.hide();
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** The reactive actor used as the modal grab target. */
  getGrabActor(): Clutter.Actor | null {
    return this.dimmer;
  }

  /** Unmount and destroy. Idempotent. */
  destroy(): void {
    if (this.dimmer !== null) {
      Main.layoutManager.removeChrome(this.dimmer);
      this.dimmer.destroy();
      this.dimmer = null;
    }
    this.mounted = false;
    this.visible = false;
  }
}

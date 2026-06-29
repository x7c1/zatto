/// <reference path="./build-mode.d.ts" />

import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { EXTENSION_UUID } from './infra/constants.js';
import { DBusInspector } from './libs/inspector/index.js';
import { DBusReloader } from './libs/reloader/index.js';
import { safeDisable } from './libs/safe-disable.js';
import { GnomeModalGrab } from './libs/shell/gnome-modal-grab.js';
import { GnomeWindowMirror } from './ui/overlay/gnome-window-mirror.js';
import { HotCornerTrigger } from './ui/overlay/hot-corner-trigger.js';
import { OverlayActor } from './ui/overlay/overlay-actor.js';
import { OverlayController } from './ui/overlay/overlay-controller.js';
import { DEFAULT_ZONE_CONFIG } from './ui/overlay/zone-config.js';

export default class ZattoExtension extends Extension {
  private dbusReloader: DBusReloader | null = null;
  private dbusInspector: DBusInspector | null = null;
  private overlayController: OverlayController | null = null;

  enable() {
    console.log('[Zatto] Extension enabled');

    // D-Bus surfaces come up first so a registration failure (e.g. another
    // wedged zatto instance still owns the bus name) is logged and the
    // matching field nulled-out BEFORE the overlay starts grabbing
    // resources we'd then need to clean up. The overlay/hot-corner path is
    // independent — primary functionality stays alive even if D-Bus is
    // wedged.
    const reloader = this.initializeDBusReloader();
    this.dbusReloader = reloader?.enable() ? reloader : null;

    const actor = new OverlayActor();
    const modalGrab = new GnomeModalGrab(() => actor.getGrabActor());
    const hotCorner = new HotCornerTrigger();
    const windowMirror = new GnomeWindowMirror(
      () => actor.getCloneContainer(),
      DEFAULT_ZONE_CONFIG
    );
    this.overlayController = new OverlayController(hotCorner, actor, modalGrab, windowMirror, {
      // Monotonic ms — GLib reports microseconds, convert once.
      now: () => GLib.get_monotonic_time() / 1000,
    });
    this.overlayController.enable();

    const inspector = this.initializeDBusInspector(this.overlayController);
    this.dbusInspector = inspector?.enable() ? inspector : null;
  }

  disable() {
    console.log('[Zatto] Extension disabled');

    // Tear down D-Bus surfaces FIRST so the bus name is released even if
    // the overlay-controller teardown throws. Each sibling teardown is
    // wrapped so one bad branch can never strand the others — that
    // isolation is exactly what would have prevented the reload-cascade
    // this PR exists to address.
    safeDisable('dbusInspector', () => this.dbusInspector?.disable());
    this.dbusInspector = null;

    safeDisable('dbusReloader', () => this.dbusReloader?.disable());
    this.dbusReloader = null;

    safeDisable('overlayController', () => this.overlayController?.disable());
    this.overlayController = null;
  }

  private initializeDBusReloader(): DBusReloader | null {
    if (!__DEV__) {
      return null;
    }
    try {
      return new DBusReloader(EXTENSION_UUID, this.metadata.uuid);
    } catch (e) {
      console.log(`[Zatto] ERROR: Failed to initialize DBusReloader: ${e}`);
      return null;
    }
  }

  private initializeDBusInspector(controller: OverlayController): DBusInspector | null {
    if (!__DEV__) {
      return null;
    }
    try {
      return new DBusInspector(controller, this.metadata.uuid);
    } catch (e) {
      console.log(`[Zatto] ERROR: Failed to initialize DBusInspector: ${e}`);
      return null;
    }
  }
}

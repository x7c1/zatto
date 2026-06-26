/// <reference path="./build-mode.d.ts" />

import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { EXTENSION_UUID } from './infra/constants.js';
import { DBusInspector } from './libs/inspector/index.js';
import { DBusReloader } from './libs/reloader/index.js';
import { GnomeModalGrab } from './libs/shell/gnome-modal-grab.js';
import { HotCornerTrigger } from './ui/overlay/hot-corner-trigger.js';
import { OverlayActor } from './ui/overlay/overlay-actor.js';
import { OverlayController } from './ui/overlay/overlay-controller.js';

export default class ZattoExtension extends Extension {
  private dbusReloader: DBusReloader | null = null;
  private dbusInspector: DBusInspector | null = null;
  private overlayController: OverlayController | null = null;

  enable() {
    console.log('[Zatto] Extension enabled');

    this.dbusReloader = this.initializeDBusReloader();
    this.dbusReloader?.enable();

    const actor = new OverlayActor();
    const modalGrab = new GnomeModalGrab(() => actor.getGrabActor());
    const hotCorner = new HotCornerTrigger();
    this.overlayController = new OverlayController(hotCorner, actor, modalGrab, {
      // Monotonic ms — GLib reports microseconds, convert once.
      now: () => GLib.get_monotonic_time() / 1000,
    });
    this.overlayController.enable();

    this.dbusInspector = this.initializeDBusInspector(this.overlayController);
    this.dbusInspector?.enable();
  }

  disable() {
    console.log('[Zatto] Extension disabled');

    this.dbusInspector?.disable();
    this.dbusInspector = null;

    this.overlayController?.disable();
    this.overlayController = null;

    this.dbusReloader?.disable();
    this.dbusReloader = null;
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
      return new DBusInspector(controller);
    } catch (e) {
      console.log(`[Zatto] ERROR: Failed to initialize DBusInspector: ${e}`);
      return null;
    }
  }
}

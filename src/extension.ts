/// <reference path="./build-mode.d.ts" />

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { EXTENSION_UUID } from './infra/constants.js';
import { DBusReloader } from './libs/reloader/index.js';
import { OverlayController } from './ui/overlay/overlay-controller.js';

export default class ZattoExtension extends Extension {
  private dbusReloader: DBusReloader | null = null;
  private overlayController: OverlayController | null = null;

  enable() {
    console.log('[Zatto] Extension enabled');

    this.dbusReloader = this.initializeDBusReloader();
    this.dbusReloader?.enable();

    this.overlayController = new OverlayController();
    this.overlayController.enable();
  }

  disable() {
    console.log('[Zatto] Extension disabled');

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
}

/// <reference path="./build-mode.d.ts" />

import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import {
  GioNetworkStateProvider,
  GLibDateProvider,
  GSettingsLicenseRepository,
  HttpLicenseApiClient,
  LicenseOperations,
  type LicenseState,
  LicenseStateHandler,
  SystemDeviceInfoProvider,
  TrialWarningOperations,
} from '@haco-studio/gnome-licensing';
import { EXTENSION_UUID, PRODUCT_NAME } from './infra/constants.js';
import { DBusInspector, type StateProvider } from './libs/inspector/index.js';
import { DBusReloader } from './libs/reloader/index.js';
import { safeDisable } from './libs/safe-disable.js';
import { GLibTimeout } from './libs/shell/glib-timeout.js';
import { GnomeModalGrab } from './libs/shell/gnome-modal-grab.js';
import { LicenseOpenGate } from './licensing/license-open-gate.js';
import { ShellNotifications } from './licensing/shell-notifications.js';
import { CycleStrip } from './ui/overlay/cycle-strip.js';
import { GnomeRealWindows } from './ui/overlay/gnome-real-windows.js';
import { GnomeWindowMirror } from './ui/overlay/gnome-window-mirror.js';
import type { HotCorner } from './ui/overlay/hot-corner-geometry.js';
import {
  DEFAULT_HOT_CORNERS,
  HOT_CORNERS_KEY,
  parseHotCorners,
} from './ui/overlay/hot-corner-setting.js';
import { HotCornerTrigger } from './ui/overlay/hot-corner-trigger.js';
import { OverlayActor } from './ui/overlay/overlay-actor.js';
import { OverlayController } from './ui/overlay/overlay-controller.js';
import { GSettingsIndicatorSetting } from './ui/top-bar-indicator/gsettings-indicator-setting.js';
import { buildIndicatorMenu } from './ui/top-bar-indicator/menu-model.js';
import { TopBarIndicator } from './ui/top-bar-indicator/top-bar-indicator.js';
import { TopBarIndicatorManager } from './ui/top-bar-indicator/top-bar-indicator-manager.js';

export default class ZattoExtension extends Extension {
  private dbusReloader: DBusReloader | null = null;
  private dbusInspector: DBusInspector | null = null;
  private overlayController: OverlayController | null = null;
  private realWindows: GnomeRealWindows | null = null;
  private settings: Gio.Settings | null = null;
  private hotCornersChangedId: number | null = null;
  private topBarIndicator: TopBarIndicatorManager | null = null;
  private notifications: ShellNotifications | null = null;
  private licenseHandler: LicenseStateHandler | null = null;

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
    const modalGrab = new GnomeModalGrab(() => actor.getActor());
    this.settings = this.loadSettings();
    this.notifications = new ShellNotifications(() => this.openPreferences());
    this.licenseHandler = this.createLicenseHandler(this.settings, this.notifications);
    const hotCorner = new HotCornerTrigger(this.readHotCorners());
    // The strip's preferences button goes through the controller, which
    // closes the depth view before the window opens.
    const cycleStrip = new CycleStrip(
      () => actor.getChromeContainer(),
      () => this.overlayController?.openPreferences()
    );
    const windowMirror = new GnomeWindowMirror(
      () => actor.getCloneContainer(),
      cycleStrip,
      new GLibTimeout()
    );
    const realWindows = new GnomeRealWindows();
    this.realWindows = realWindows;
    this.overlayController = new OverlayController(
      hotCorner,
      actor,
      modalGrab,
      windowMirror,
      realWindows,
      {
        // Monotonic ms — GLib reports microseconds, convert once.
        now: () => GLib.get_monotonic_time() / 1000,
        // Without a license gate (it could not be set up) every open is
        // allowed, as when the license API does not answer.
        openGate: this.licenseHandler
          ? new LicenseOpenGate(this.licenseHandler, this.notifications, PRODUCT_NAME)
          : undefined,
        openPreferences: () => this.openPreferences(),
      }
    );
    this.overlayController.enable();

    // The trigger swaps only its own corner actors, so a change is safe in
    // any overlay state; the controller never hears about it.
    this.hotCornersChangedId =
      this.settings?.connect(`changed::${HOT_CORNERS_KEY}`, () => {
        hotCorner.setCorners(this.readHotCorners());
      }) ?? null;

    this.topBarIndicator = this.createTopBarIndicator(this.overlayController);
    this.topBarIndicator.enable();

    const inspector = this.initializeDBusInspector(
      withHotCornerSet(this.overlayController, hotCorner)
    );
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

    // The indicator's menu opens the overlay, so it goes before the
    // controller; it also stops following its setting here.
    safeDisable('topBarIndicator', () => this.topBarIndicator?.disable());
    this.topBarIndicator = null;

    // Stop following the setting before the trigger goes away with the
    // controller.
    safeDisable('settings', () => {
      if (this.hotCornersChangedId !== null) {
        this.settings?.disconnect(this.hotCornersChangedId);
      }
    });
    this.hotCornersChangedId = null;
    this.settings = null;

    safeDisable('overlayController', () => this.overlayController?.disable());
    this.overlayController = null;

    // The controller's open gate used the license handler; nothing asks it
    // any more.
    safeDisable('licenseHandler', () => this.licenseHandler?.dispose());
    this.licenseHandler = null;

    safeDisable('notifications', () => this.notifications?.destroy());
    this.notifications = null;

    // After the controller has restored the windows, drop the backdrop actor.
    safeDisable('realWindows', () => this.realWindows?.destroy());
    this.realWindows = null;
  }

  /**
   * The extension's GSettings. `getSettings()` reads `schemas/` under the
   * extension's own directory, which is the `/tmp/<uuid>/` copy when the
   * development reloader runs one; that copy shares the schema id and path,
   * so it sees the same values. Returns `null` (logged) when the schema is
   * missing, and the extension then runs with the schema's defaults.
   */
  private loadSettings(): Gio.Settings | null {
    try {
      return this.getSettings();
    } catch (e) {
      console.log(`[Zatto] ERROR: Failed to load settings, using the defaults: ${e}`);
      return null;
    }
  }

  /**
   * The license gate: a trial counted in days the depth view is opened, and
   * a license key activated in the preferences. Its state lives in the
   * extension's GSettings, which the preferences write directly; the
   * handler follows those changes, so activating a license unlocks zatto
   * without a reload. Returns `null` (logged) when it cannot be set up,
   * and zatto then runs unlocked.
   */
  private createLicenseHandler(
    settings: Gio.Settings | null,
    notifications: ShellNotifications
  ): LicenseStateHandler | null {
    if (settings === null) {
      console.log('[Zatto] ERROR: No settings to keep the license state in; running unlocked');
      return null;
    }
    let handler: LicenseStateHandler | null = null;
    try {
      const repository = new GSettingsLicenseRepository(settings);
      handler = new LicenseStateHandler(
        new LicenseOperations(
          repository,
          new HttpLicenseApiClient(__LICENSE_API_BASE_URL__),
          new GLibDateProvider(),
          new GioNetworkStateProvider(),
          new SystemDeviceInfoProvider()
        ),
        new TrialWarningOperations(repository, notifications, PRODUCT_NAME)
      );
      // A lock takes effect on the next open, which shows why.
      handler.initialize((reason) => {
        console.log(`[Zatto] Locked by the license gate: ${reason}`);
      });
      return handler;
    } catch (e) {
      console.log(`[Zatto] ERROR: Failed to set up the license gate, running unlocked: ${e}`);
      // Drop whatever watchers it had started before failing.
      safeDisable('licenseHandler', () => handler?.dispose());
      return null;
    }
  }

  /** The license state for the top bar menu, or `null` when it cannot be read. */
  private readLicenseState(): LicenseState | null {
    try {
      return this.licenseHandler?.getLicenseState() ?? null;
    } catch (e) {
      console.log(`[Zatto] ERROR: Failed to read the license state: ${e}`);
      return null;
    }
  }

  /**
   * The manager that shows the top bar indicator while
   * `show-top-bar-indicator` is on. Its menu shows the license status and
   * opens the preferences window and the depth view, the latter through the
   * controller (and so through the license gate) as a hot corner does.
   */
  private createTopBarIndicator(controller: OverlayController): TopBarIndicatorManager {
    const actions = {
      openDepthView: () => {
        controller.open();
      },
      openPreferences: () => this.openPreferences(),
    };
    const getEntries = () => buildIndicatorMenu({ licenseState: this.readLicenseState(), actions });
    return new TopBarIndicatorManager(
      new GSettingsIndicatorSetting(this.settings),
      () => new TopBarIndicator({ role: this.metadata.uuid, name: PRODUCT_NAME, getEntries })
    );
  }

  private readHotCorners(): HotCorner[] {
    if (!this.settings) {
      return [...DEFAULT_HOT_CORNERS];
    }
    return parseHotCorners(this.settings.get_strv(HOT_CORNERS_KEY));
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

  private initializeDBusInspector(provider: StateProvider): DBusInspector | null {
    if (!__DEV__) {
      return null;
    }
    try {
      return new DBusInspector(provider, this.metadata.uuid);
    } catch (e) {
      console.log(`[Zatto] ERROR: Failed to initialize DBusInspector: ${e}`);
      return null;
    }
  }
}

/**
 * The controller's snapshot with the trigger's active corners added as
 * `hotCorner.corners`, so a changed `hot-corners` setting shows up in the
 * Inspect endpoint. The corner set belongs to the trigger, not the
 * controller, hence the merge here.
 */
function withHotCornerSet(controller: OverlayController, trigger: HotCornerTrigger): StateProvider {
  return {
    snapshot: () => {
      const snapshot = controller.snapshot();
      return {
        ...snapshot,
        hotCorner: { ...snapshot.hotCorner, corners: trigger.getCorners() },
      };
    },
  };
}

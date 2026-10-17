/**
 * The top bar indicator: an icon in the panel's status area whose popup
 * menu lists the entries of {@link buildIndicatorMenu}.
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { ICON_NAME } from '../../infra/constants.js';
import type { IndicatorMenuEntry } from './menu-model.js';
import type { IndicatorPort } from './ports.js';

export interface TopBarIndicatorOptions {
  /** Unique status area role; the extension's UUID. */
  readonly role: string;
  /** Accessible name of the indicator button. */
  readonly name: string;
  /**
   * The menu's entries, in display order. Read again each time the menu
   * opens, so a status row shows the current state.
   */
  readonly getEntries: () => readonly IndicatorMenuEntry[];
}

export class TopBarIndicator implements IndicatorPort {
  private readonly button: PanelMenu.Button;
  private readonly menu: PopupMenu.PopupMenu;
  private pendingActionId: number | null = null;

  /** Build the indicator and place it in the top bar. */
  constructor(private readonly options: TopBarIndicatorOptions) {
    this.button = new PanelMenu.Button(0.0, options.name, false);
    this.button.add_child(new St.Icon({ icon_name: ICON_NAME, style_class: 'system-status-icon' }));

    this.menu = this.button.menu as PopupMenu.PopupMenu;
    // The menu goes with the button, and its signal handlers with it.
    this.menu.connect('open-state-changed', (_menu, isOpen) => {
      if (isOpen) {
        this.render();
      }
      return undefined;
    });

    try {
      this.render();
      Main.panel.addToStatusArea(options.role, this.button);
    } catch (e) {
      this.button.destroy();
      throw e;
    }
  }

  destroy(): void {
    if (this.pendingActionId !== null) {
      GLib.source_remove(this.pendingActionId);
      this.pendingActionId = null;
    }
    // Destroying the button also destroys its menu and removes it from the
    // panel's status area.
    this.button.destroy();
  }

  /** Replace the menu's entries with the current ones. */
  private render(): void {
    this.menu.removeAll();
    for (const entry of this.options.getEntries()) {
      this.menu.addMenuItem(this.createMenuItem(entry));
    }
  }

  private createMenuItem(entry: IndicatorMenuEntry): PopupMenu.PopupBaseMenuItem {
    switch (entry.kind) {
      case 'status':
        return new PopupMenu.PopupMenuItem(entry.label, { reactive: false, can_focus: false });
      case 'separator':
        return new PopupMenu.PopupSeparatorMenuItem();
      case 'item': {
        const { label, activate } = entry;
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => this.runAfterMenuCloses(label, activate));
        return item;
      }
    }
  }

  /**
   * Run a menu action once the menu has closed, so the menu's modal grab has
   * been released and cannot take input back from what the action opens
   * (the depth view takes its own modal grab).
   */
  private runAfterMenuCloses(label: string, action: () => void): void {
    if (this.pendingActionId !== null) {
      GLib.source_remove(this.pendingActionId);
    }
    this.pendingActionId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.pendingActionId = null;
      try {
        action();
      } catch (e) {
        console.log(`[Zatto] ERROR: Top bar menu item "${label}" failed: ${e}`);
      }
      return GLib.SOURCE_REMOVE;
    });
  }
}

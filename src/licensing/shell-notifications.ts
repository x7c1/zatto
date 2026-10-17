/**
 * zatto's notifications in the Shell's message tray, under a source named
 * after zatto: the license gate's trial warnings ({@link NotificationService})
 * and the notice of a refused open ({@link LockedNoticePort}).
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import type { DisabledReasonDescription, NotificationService } from '@haco-studio/gnome-licensing';
import { ICON_NAME, PRODUCT_NAME } from '../infra/constants.js';
import type { LockedNoticePort } from './ports.js';

export class ShellNotifications implements NotificationService, LockedNoticePort {
  private source: MessageTray.Source | null = null;
  private lockedNotice: MessageTray.Notification | null = null;

  /** @param openPreferences Opens zatto's preferences window. */
  constructor(private readonly openPreferences: () => void) {}

  notifyError(title: string, details?: string): void {
    this.notify(
      new MessageTray.Notification({
        source: this.getSource(),
        title,
        body: details ?? null,
        urgency: MessageTray.Urgency.CRITICAL,
      })
    );
  }

  /**
   * The license gate's only warning is the trial's pre-expiry warning, which
   * asks the user to activate a license: it offers the preferences, where
   * one can be activated, as the notice of a refused open does.
   */
  notifyWarning(title: string, details?: string): void {
    const notification = new MessageTray.Notification({
      source: this.getSource(),
      title,
      body: details ?? null,
    });
    this.offerPreferences(notification);
    this.notify(notification);
  }

  /**
   * Show why the depth view did not open. A newer notice replaces the
   * previous one, so repeated attempts do not stack up in the tray.
   */
  showLocked(description: DisabledReasonDescription): void {
    this.lockedNotice?.destroy(MessageTray.NotificationDestroyedReason.REPLACED);
    const notification = new MessageTray.Notification({
      source: this.getSource(),
      title: description.headline,
      body: description.instruction,
    });
    if (description.canOpenPreferences) {
      this.offerPreferences(notification);
    }
    notification.connect('destroy', () => {
      if (this.lockedNotice === notification) {
        this.lockedNotice = null;
      }
    });
    this.lockedNotice = notification;
    this.notify(notification);
  }

  /** Remove zatto's notifications and its source from the tray. */
  destroy(): void {
    this.lockedNotice = null;
    // Destroying the source destroys its notifications.
    this.source?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    this.source = null;
  }

  /** Open the preferences from the notification's button or from a click on it. */
  private offerPreferences(notification: MessageTray.Notification): void {
    notification.addAction('Open Preferences', () => this.openPreferences());
    notification.connect('activated', () => this.openPreferences());
  }

  private notify(notification: MessageTray.Notification): void {
    this.getSource().addNotification(notification);
  }

  /**
   * The tray source, created on first use. The Shell destroys a source once
   * its last notification goes, so a new one is created after that.
   */
  private getSource(): MessageTray.Source {
    if (this.source === null) {
      const source = new MessageTray.Source({ title: PRODUCT_NAME, iconName: ICON_NAME });
      source.connect('destroy', () => {
        if (this.source === source) {
          this.source = null;
        }
      });
      Main.messageTray.add(source);
      this.source = source;
    }
    return this.source;
  }
}

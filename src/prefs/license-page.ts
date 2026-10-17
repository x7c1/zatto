/**
 * The preferences page with the license gate's group: the license status
 * and the license key entry that activates a license. The group writes to
 * the extension's GSettings, and the extension follows the change live, so
 * an activated license unlocks zatto without a reload. zatto has no
 * purchase page, so nothing offers to purchase a license.
 */

import Adw from 'gi://Adw';
import type Gio from 'gi://Gio';
import { createLicenseGroup } from '@haco-studio/gnome-licensing/prefs';

export function createLicensePage(
  settings: Gio.Settings,
  window: Adw.PreferencesWindow
): Adw.PreferencesPage {
  const page = new Adw.PreferencesPage({ title: 'License', icon_name: 'dialog-password-symbolic' });
  page.add(createLicenseGroup(window, { settings, apiBaseUrl: __LICENSE_API_BASE_URL__ }));
  return page;
}

/**
 * Whether the license needs the user's attention, so the preferences open on
 * the License page: zatto's notifications that ask to activate a license
 * (the trial's warning, a refused open) offer the preferences, and should
 * land where a license key is entered. True once the trial has warned that
 * it ends soon, and while an ended trial, an expired license or an invalid
 * one locks zatto. An ended trial that the license server no longer answers
 * for does not lock zatto, and does not count.
 */
export function licenseNeedsAttention(settings: Gio.Settings): boolean {
  switch (settings.get_string('license-status')) {
    case 'trial':
      return settings.get_int('trial-warning-last-threshold') > 0;
    case 'trial-expired':
      return settings.get_string('trial-probe-result') !== 'no-response';
    case 'expired':
    case 'invalid':
      return true;
    default:
      return false;
  }
}

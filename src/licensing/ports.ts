/**
 * Small interfaces that {@link LicenseOpenGate} uses, so it runs under
 * vitest with fakes instead of the license gate client and the Shell's
 * notifications.
 *
 * Production implementations:
 *
 * - {@link LicenseUsePort} -> `LicenseStateHandler` (`@haco-studio/gnome-licensing`)
 * - {@link LockedNoticePort} -> `ShellNotifications` (`shell-notifications.ts`)
 */

import type { DisabledReason, DisabledReasonDescription } from '@haco-studio/gnome-licensing';

/** The license gate, as far as opening the depth view needs it. */
export interface LicenseUsePort {
  /**
   * Record that the user used zatto: during the trial, today counts as a day
   * of use (once per calendar day). Recording the day that reaches the
   * trial's limit locks zatto at once.
   */
  recordUse(): void;
  /** Why zatto is locked, or `null` when it is not. */
  getDisabledReason(): DisabledReason | null;
}

/** Tells the user why the depth view did not open. */
export interface LockedNoticePort {
  /**
   * Show why zatto is locked, replacing the previous notice; when `description.canOpenPreferences`, offer
   * to open the preferences, where a license can be activated.
   */
  showLocked(description: DisabledReasonDescription): void;
  /**
   * Whether the last notice {@link showLocked} showed is still in the
   * message tray: neither dismissed by the user nor otherwise removed.
   */
  isLockedShown(): boolean;
}

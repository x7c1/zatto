/**
 * Lets the depth view open only while the license allows it. Every open is
 * a use of zatto, recorded before the lock is checked: during the trial a
 * day of use is a day the depth view is opened, and recording the day that
 * ends the trial locks zatto on that very open.
 *
 * A refused open shows the locked notice. An explicit request shows it every
 * time, since the user asked for the depth view and must see why it did not
 * open. A hot corner, often touched by accident, does not show it again while
 * an earlier notice saying the same is still in the message tray, so brushing
 * the corner does not pop a banner up on every touch. When the reason has
 * changed since that notice, the corner shows the new one, so the tray does
 * not keep a reason, or an offer to open the preferences, that no longer
 * applies.
 */

import {
  type DisabledReasonDescription,
  describeDisabledReason,
} from '@haco-studio/gnome-licensing';
import type { OpenGatePort, OpenSource } from '../ui/overlay/ports.js';
import type { LicenseUsePort, LockedNoticePort } from './ports.js';

export class LicenseOpenGate implements OpenGatePort {
  /**
   * @param license The license gate.
   * @param notice Explains a refused open.
   * @param productName The extension's name as shown to the user.
   */
  constructor(
    private readonly license: LicenseUsePort,
    private readonly notice: LockedNoticePort,
    private readonly productName: string
  ) {}

  /**
   * Record a use, then allow the open unless zatto is locked; a refused open
   * shows why, unless it came from a hot corner while a notice saying the
   * same is still in the tray. A failure to record the use is logged and does
   * not lock zatto: only the license decides that.
   */
  allowOpen(source: OpenSource): boolean {
    try {
      this.license.recordUse();
    } catch (e) {
      console.log(`[Zatto] ERROR: Failed to record a use of the depth view: ${e}`);
    }
    const reason = this.license.getDisabledReason();
    if (reason === null) {
      return true;
    }
    const description = describeDisabledReason(reason, this.productName);
    const inTray = this.notice.lockedInTray();
    if (source === 'request' || inTray === null || !sameDescription(inTray, description)) {
      this.notice.showLocked(description);
    }
    return false;
  }
}

/** Whether two notices say the same: the same text and the same offer. */
function sameDescription(a: DisabledReasonDescription, b: DisabledReasonDescription): boolean {
  return (
    a.headline === b.headline &&
    a.instruction === b.instruction &&
    a.canOpenPreferences === b.canOpenPreferences
  );
}

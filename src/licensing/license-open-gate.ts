/**
 * Lets the depth view open only while the license allows it. Every open is
 * a use of zatto, recorded before the lock is checked: during the trial a
 * day of use is a day the depth view is opened, and recording the day that
 * ends the trial locks zatto on that very open.
 */

import { describeDisabledReason } from '@haco-studio/gnome-licensing';
import type { OpenGatePort } from '../ui/overlay/ports.js';
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
   * shows why. A failure to record the use is logged and does not lock
   * zatto: only the license decides that.
   */
  allowOpen(): boolean {
    try {
      this.license.recordUse();
    } catch (e) {
      console.log(`[Zatto] ERROR: Failed to record a use of the depth view: ${e}`);
    }
    const reason = this.license.getDisabledReason();
    if (reason === null) {
      return true;
    }
    this.notice.showLocked(describeDisabledReason(reason, this.productName));
    return false;
  }
}

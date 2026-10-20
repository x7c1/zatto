/**
 * Lets the depth view open only while the license allows it. Every open is
 * a use of zatto, recorded before the lock is checked: during the trial a
 * day of use is a day the depth view is opened, and recording the day that
 * ends the trial locks zatto on that very open.
 *
 * A refused open shows the locked notice. An explicit request shows it every
 * time, since the user asked for the depth view and must see why it did not
 * open. A hot corner, often touched by accident, shows it only while no
 * earlier notice is still in the message tray, so brushing the corner does
 * not pop a banner up on every touch.
 */

import { describeDisabledReason } from '@haco-studio/gnome-licensing';
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
   * shows why, unless it came from a hot corner while the previous notice is
   * still in the tray. A failure to record the use is logged and does not
   * lock zatto: only the license decides that.
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
    if (source === 'request' || !this.notice.isLockedShown()) {
      this.notice.showLocked(describeDisabledReason(reason, this.productName));
    }
    return false;
  }
}

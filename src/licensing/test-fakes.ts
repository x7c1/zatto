/** Test doubles for the licensing ports. */

import type { DisabledReason, DisabledReasonDescription } from '@haco-studio/gnome-licensing';
import type { LicenseUsePort, LockedNoticePort } from './ports.js';

/**
 * A license gate that logs every call to `calls`, so tests can check the
 * order of recording a use and checking the lock.
 */
export class FakeLicense implements LicenseUsePort {
  readonly calls: Array<'recordUse' | 'getDisabledReason'> = [];
  /** Test helper: make the next `recordUse()` throw. */
  recordUseError: Error | null = null;
  /**
   * Test helper: the reason `recordUse()` switches to, as recording the
   * trial's last day does.
   */
  reasonAfterUse: DisabledReason | null | undefined = undefined;

  constructor(private reason: DisabledReason | null) {}

  recordUse(): void {
    this.calls.push('recordUse');
    if (this.recordUseError !== null) {
      const error = this.recordUseError;
      this.recordUseError = null;
      throw error;
    }
    if (this.reasonAfterUse !== undefined) {
      this.reason = this.reasonAfterUse;
    }
  }

  getDisabledReason(): DisabledReason | null {
    this.calls.push('getDisabledReason');
    return this.reason;
  }

  /** Test helper: lock or unlock, as a change in the preferences does. */
  setReason(reason: DisabledReason | null): void {
    this.reason = reason;
  }

  /** How many uses were recorded. */
  useCount(): number {
    return this.calls.filter((call) => call === 'recordUse').length;
  }
}

export class FakeLockedNotice implements LockedNoticePort {
  readonly shown: DisabledReasonDescription[] = [];

  showLocked(description: DisabledReasonDescription): void {
    this.shown.push(description);
  }
}

/**
 * Adds or removes the top bar indicator following the
 * `show-top-bar-indicator` setting, applying a change at once, without
 * restarting the Shell.
 */

import type { IndicatorPort, IndicatorSettingPort } from './ports.js';

export class TopBarIndicatorManager {
  private indicator: IndicatorPort | null = null;
  private stopWatching: (() => void) | null = null;

  /**
   * @param setting The setting to follow.
   * @param createIndicator Places a new indicator in the top bar.
   */
  constructor(
    private readonly setting: IndicatorSettingPort,
    private readonly createIndicator: () => IndicatorPort
  ) {}

  enable(): void {
    if (this.stopWatching !== null) {
      return;
    }
    this.stopWatching = this.setting.watch((shown) => this.setShown(shown));
    this.setShown(this.setting.isShown());
  }

  /** Stop following the setting and remove the indicator. Idempotent. */
  disable(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.setShown(false);
  }

  /** Whether the indicator is in the top bar. */
  isShown(): boolean {
    return this.indicator !== null;
  }

  private setShown(shown: boolean): void {
    if (shown && this.indicator === null) {
      // A failure to build the indicator is logged and leaves it absent; the
      // depth view stays reachable through the hot corners.
      try {
        this.indicator = this.createIndicator();
      } catch (e) {
        console.log(`[Zatto] ERROR: Failed to add the top bar indicator: ${e}`);
      }
    } else if (!shown && this.indicator !== null) {
      const indicator = this.indicator;
      this.indicator = null;
      indicator.destroy();
    }
  }
}

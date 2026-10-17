/**
 * Small interfaces that {@link TopBarIndicatorManager} uses, so it runs
 * under vitest with fakes instead of GSettings and the Shell's panel.
 *
 * Production implementations:
 *
 * - {@link IndicatorSettingPort} -> `GSettingsIndicatorSetting` (`gsettings-indicator-setting.ts`)
 * - {@link IndicatorPort} -> `TopBarIndicator` (`top-bar-indicator.ts`)
 */

/** The `show-top-bar-indicator` setting. */
export interface IndicatorSettingPort {
  /** Whether the indicator should be shown now. */
  isShown(): boolean;
  /**
   * Call `handler` with the new value each time the setting changes. Returns
   * a function that stops watching; calling it more than once is harmless.
   */
  watch(handler: (shown: boolean) => void): () => void;
}

/** An indicator placed in the top bar from its creation until {@link destroy}. */
export interface IndicatorPort {
  /** Remove the indicator from the top bar and free it. */
  destroy(): void;
}

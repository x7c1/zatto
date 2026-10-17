/**
 * {@link IndicatorSettingPort} on the extension's GSettings.
 */

import type Gio from 'gi://Gio';
import type { IndicatorSettingPort } from './ports.js';
import {
  DEFAULT_SHOW_TOP_BAR_INDICATOR,
  SHOW_TOP_BAR_INDICATOR_KEY,
} from './top-bar-indicator-setting.js';

export class GSettingsIndicatorSetting implements IndicatorSettingPort {
  /**
   * @param settings The extension's settings, or `null` when the schema
   *   could not be loaded: the schema's default then holds and never changes.
   */
  constructor(private readonly settings: Gio.Settings | null) {}

  isShown(): boolean {
    return this.settings?.get_boolean(SHOW_TOP_BAR_INDICATOR_KEY) ?? DEFAULT_SHOW_TOP_BAR_INDICATOR;
  }

  watch(handler: (shown: boolean) => void): () => void {
    const settings = this.settings;
    if (settings === null) {
      return () => {};
    }
    let id: number | null = settings.connect(`changed::${SHOW_TOP_BAR_INDICATOR_KEY}`, () =>
      handler(this.isShown())
    );
    return () => {
      if (id !== null) {
        settings.disconnect(id);
        id = null;
      }
    };
  }
}

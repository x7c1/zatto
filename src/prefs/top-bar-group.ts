/**
 * The preferences group with the switch that shows or hides the top bar
 * indicator. The switch is bound to `show-top-bar-indicator`, so it follows
 * outside changes and the extension follows the switch live.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import { SHOW_TOP_BAR_INDICATOR_KEY } from '../ui/top-bar-indicator/top-bar-indicator-setting.js';

export function createTopBarGroup(settings: Gio.Settings): Adw.PreferencesGroup {
  const group = new Adw.PreferencesGroup({ title: 'Top bar' });
  const row = new Adw.SwitchRow({
    title: 'Show top bar indicator',
    subtitle: 'An icon in the top bar whose menu opens the depth view and these preferences',
  });
  settings.bind(SHOW_TOP_BAR_INDICATOR_KEY, row, 'active', Gio.SettingsBindFlags.DEFAULT);
  group.add(row);
  return group;
}

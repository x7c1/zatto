import type Adw from 'gi://Adw';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { createHotCornersPage } from './prefs/hot-corners-page.js';
import { createTopBarGroup } from './prefs/top-bar-group.js';

export default class ZattoPreferences extends ExtensionPreferences {
  async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    // `getSettings()` reads the schema compiled into `schemas/` next to this
    // file, as the extension does.
    const settings = this.getSettings();
    const page = createHotCornersPage(settings, window);
    page.add(createTopBarGroup(settings));
    window.add(page);
  }
}

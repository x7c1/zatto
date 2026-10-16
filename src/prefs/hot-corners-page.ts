/**
 * The preferences page that chooses which corners of the primary monitor
 * open the depth view. One switch row per offered corner writes the whole
 * `hot-corners` list back; the extension follows the change live.
 */

import Adw from 'gi://Adw';
import type Gio from 'gi://Gio';
import type { HotCorner } from '../ui/overlay/hot-corner-geometry.js';
import {
  HOT_CORNERS_KEY,
  parseHotCorners,
  withHotCorner,
} from '../ui/overlay/hot-corner-setting.js';

/**
 * Corners offered as switches. The top-left corner is left out: GNOME
 * Shell's own Activities hot corner lives there. A top-left value set by
 * other means (e.g. `gsettings`) is kept when a switch writes the list.
 */
const OFFERED_CORNERS: readonly { corner: HotCorner; title: string }[] = [
  { corner: 'bottom-left', title: 'Bottom left' },
  { corner: 'bottom-right', title: 'Bottom right' },
  { corner: 'top-right', title: 'Top right' },
];

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** The group description for the stored corner set. */
function describe(corners: readonly HotCorner[]): string {
  const offeredOn = corners.some((corner) => corner !== 'top-left');
  const topLeftOn = corners.includes('top-left');
  let offered = 'Moving the pointer into a corner switched on below opens the depth view.';
  if (!offeredOn) {
    offered = topLeftOn
      ? 'None of the corners below opens the depth view.'
      : 'No corner opens the depth view. Switch a corner on below to open it from there.';
  }
  let topLeft = 'The top-left corner is not offered: it opens the Activities overview.';
  if (topLeftOn) {
    topLeft = `The top-left corner, set outside this window, opens it${offeredOn ? ' too' : ''}.`;
  }
  return `${offered} ${topLeft}`;
}

/**
 * Build the page. The rows follow outside changes of the setting while
 * `window` is open; the listener goes away when the window closes.
 */
export function createHotCornersPage(
  settings: Gio.Settings,
  window: Adw.PreferencesWindow
): Adw.PreferencesPage {
  const page = new Adw.PreferencesPage({
    title: 'General',
    icon_name: 'preferences-system-symbolic',
  });
  const group = new Adw.PreferencesGroup({ title: 'Hot corners' });
  page.add(group);

  const read = (): HotCorner[] => parseHotCorners(settings.get_strv(HOT_CORNERS_KEY));

  const rows = OFFERED_CORNERS.map(({ corner, title }) => {
    const row = new Adw.SwitchRow({ title });
    row.connect('notify::active', () => {
      const stored = settings.get_strv(HOT_CORNERS_KEY);
      const next = withHotCorner(stored, corner, row.get_active());
      // Skip a write that changes nothing, so syncing a row from an outside
      // change does not write the setting back.
      if (!sameList(stored, next)) {
        settings.set_strv(HOT_CORNERS_KEY, next);
      }
    });
    group.add(row);
    return { corner, row };
  });

  const sync = (): void => {
    const corners = read();
    for (const { corner, row } of rows) {
      const active = corners.includes(corner);
      if (row.get_active() !== active) {
        row.set_active(active);
      }
    }
    group.set_description(describe(corners));
  };
  sync();

  const changedId = settings.connect(`changed::${HOT_CORNERS_KEY}`, sync);
  window.connect('close-request', () => {
    settings.disconnect(changedId);
    return false;
  });

  return page;
}

/**
 * Pure wording of the description shown below the preferences window's
 * picture of the display. Kept free of GTK imports so it can be unit-tested;
 * `hot-corners-page.ts` shows it.
 */

import type { HotCorner } from '../ui/overlay/hot-corner-geometry.js';

/**
 * The description for the stored corner set. `gnomeHotCorner` is GNOME's
 * own `enable-hot-corners` setting, or `undefined` when it cannot be read.
 *
 * GNOME Shell opens the Activities overview from the top-left corner when
 * that setting is on, so with zatto's top-left corner also on, one sentence
 * says both use it and where to turn GNOME's off. They do not race: GNOME's
 * corner is a pressure barrier, while zatto fires on entering its corner
 * actor and so opens first, and its modal grab leaves GNOME's barrier inert
 * while the overlay is open. Only pushing on after the overlay closes can
 * still open the overview.
 */
export function describeHotCorners(
  corners: readonly HotCorner[],
  gnomeHotCorner: boolean | undefined
): string {
  if (corners.length === 0) {
    return 'No corner opens the depth view. Switch a corner on in the picture to open it from there.';
  }
  const opens = 'Moving the pointer into a corner switched on in the picture opens the depth view.';
  if (corners.includes('top-left') && gnomeHotCorner === true) {
    return `${opens} GNOME's Activities hot corner also uses the top-left corner; you can turn it off in Settings › Multitasking › Hot Corner.`;
  }
  return opens;
}

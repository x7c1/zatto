/**
 * The single switch for every ease the extension runs.
 *
 * Follows the system-wide `org.gnome.desktop.interface enable-animations`
 * setting, which `St.Settings` mirrors (and which gnome-shell also turns
 * off for some remote sessions). Callers replace each ease with a
 * synchronous set when this returns `false`.
 */

import St from 'gi://St';

export function shouldAnimate(): boolean {
  return St.Settings.get().enable_animations;
}

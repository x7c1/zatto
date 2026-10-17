/**
 * What the top bar indicator's menu lists, independently of St widgets, so
 * the menu can be unit-tested and new entries are added here rather than in
 * the widget code.
 */

import { getLicenseStatusDisplay, type LicenseState } from '@haco-studio/gnome-licensing';

/** The actions the menu's items run. */
export interface IndicatorMenuActions {
  /** Open the depth view, as a hot corner does. */
  readonly openDepthView: () => void;
  /** Open the preferences window. */
  readonly openPreferences: () => void;
}

export interface IndicatorMenuInput {
  /**
   * The license state, shown as a status row; `null` when the license gate
   * could not be set up, and the row is left out.
   */
  readonly licenseState: LicenseState | null;
  readonly actions: IndicatorMenuActions;
}

/** A non-interactive row that shows a status. */
export interface IndicatorMenuStatus {
  readonly kind: 'status';
  readonly label: string;
}

/** A line between groups of entries. */
export interface IndicatorMenuSeparator {
  readonly kind: 'separator';
}

/** An activatable item. */
export interface IndicatorMenuItem {
  readonly kind: 'item';
  readonly label: string;
  readonly activate: () => void;
}

/** One entry of the menu, in display order. */
export type IndicatorMenuEntry = IndicatorMenuStatus | IndicatorMenuSeparator | IndicatorMenuItem;

export function buildIndicatorMenu(input: IndicatorMenuInput): IndicatorMenuEntry[] {
  const { licenseState, actions } = input;
  const items: IndicatorMenuEntry[] = [
    { kind: 'item', label: 'Open Depth View', activate: actions.openDepthView },
    { kind: 'item', label: 'Preferences…', activate: actions.openPreferences },
  ];
  if (licenseState === null) {
    return items;
  }
  return [licenseStatusEntry(licenseState), { kind: 'separator' }, ...items];
}

/**
 * The license status row. zatto has no purchase page, so the status never
 * offers to purchase a license.
 */
function licenseStatusEntry(state: LicenseState): IndicatorMenuStatus {
  const { title, subtitle } = getLicenseStatusDisplay(state, { purchaseAvailable: false });
  return { kind: 'status', label: `License: ${title} — ${subtitle}` };
}

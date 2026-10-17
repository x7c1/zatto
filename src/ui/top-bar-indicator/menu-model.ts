/**
 * What the top bar indicator's menu lists, independently of St widgets, so
 * the menu can be unit-tested and later items (such as a license status row)
 * are added here rather than in the widget code.
 */

/** The actions the menu's items run. */
export interface IndicatorMenuActions {
  /** Open the depth view, as a hot corner does. */
  readonly openDepthView: () => void;
  /** Open the preferences window. */
  readonly openPreferences: () => void;
}

/** One activatable item of the menu, in display order. */
export interface IndicatorMenuItem {
  readonly label: string;
  readonly activate: () => void;
}

export function buildIndicatorMenu(actions: IndicatorMenuActions): IndicatorMenuItem[] {
  return [
    { label: 'Open Depth View', activate: actions.openDepthView },
    { label: 'Preferences…', activate: actions.openPreferences },
  ];
}

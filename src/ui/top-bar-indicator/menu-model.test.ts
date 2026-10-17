import { describe, expect, it, vi } from 'vitest';
import { buildIndicatorMenu } from './menu-model.js';

function setup() {
  const actions = { openDepthView: vi.fn(), openPreferences: vi.fn() };
  return { actions, menu: buildIndicatorMenu(actions) };
}

describe('buildIndicatorMenu', () => {
  it('lists "Open Depth View" and "Preferences…", in that order', () => {
    const { menu } = setup();
    expect(menu.map((item) => item.label)).toEqual(['Open Depth View', 'Preferences…']);
  });

  it('opens the depth view from "Open Depth View"', () => {
    const { actions, menu } = setup();

    menu.find((item) => item.label === 'Open Depth View')?.activate();

    expect(actions.openDepthView).toHaveBeenCalledTimes(1);
    expect(actions.openPreferences).not.toHaveBeenCalled();
  });

  it('opens the preferences from "Preferences…"', () => {
    const { actions, menu } = setup();

    menu.find((item) => item.label === 'Preferences…')?.activate();

    expect(actions.openPreferences).toHaveBeenCalledTimes(1);
    expect(actions.openDepthView).not.toHaveBeenCalled();
  });
});

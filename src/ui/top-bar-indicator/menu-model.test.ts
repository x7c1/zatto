import { createLicenseState, type LicenseState } from '@haco-studio/gnome-licensing';
import { describe, expect, it, vi } from 'vitest';
import { buildIndicatorMenu, type IndicatorMenuEntry } from './menu-model.js';

function licenseState(overrides: Partial<LicenseState> = {}): LicenseState {
  return createLicenseState({
    status: 'trial',
    networkState: 'online',
    trialDaysRemaining: 30,
    validUntil: null,
    validUntilPassed: false,
    lastValidated: null,
    daysSinceLastOnline: 0,
    ...overrides,
  });
}

function setup(state: LicenseState | null = licenseState()) {
  const actions = { openDepthView: vi.fn(), openPreferences: vi.fn() };
  return { actions, menu: buildIndicatorMenu({ licenseState: state, actions }) };
}

function labels(menu: IndicatorMenuEntry[]): string[] {
  return menu.map((entry) => (entry.kind === 'separator' ? '---' : entry.label));
}

function activate(menu: IndicatorMenuEntry[], label: string): void {
  const entry = menu.find((e) => e.kind === 'item' && e.label === label);
  if (entry?.kind !== 'item') {
    throw new Error(`no item "${label}"`);
  }
  entry.activate();
}

describe('buildIndicatorMenu', () => {
  it('lists the license status, a separator, "Open Depth View" and "Preferences…", in that order', () => {
    const { menu } = setup();
    expect(labels(menu)).toEqual([
      'License: Trial — 30 days of use left',
      '---',
      'Open Depth View',
      'Preferences…',
    ]);
    expect(menu.map((entry) => entry.kind)).toEqual(['status', 'separator', 'item', 'item']);
  });

  it.each<[string, Partial<LicenseState>, string]>([
    ['a trial with days left', { trialDaysRemaining: 12 }, 'License: Trial — 12 days of use left'],
    ['a trial with one day left', { trialDaysRemaining: 1 }, 'License: Trial — 1 day of use left'],
    [
      'an expired trial',
      { status: 'trial-expired', trialDaysRemaining: 0 },
      'License: Trial Expired — Please activate a license',
    ],
    [
      'a valid license',
      { status: 'valid', validUntil: new Date(2027, 0, 31) },
      'License: Active — Valid until 2027-01-31',
    ],
    [
      'a valid license used offline',
      { status: 'valid', networkState: 'offline', daysSinceLastOnline: 2 },
      'License: Active — Offline - connect within 5 days',
    ],
    [
      'an expired license',
      { status: 'expired' },
      'License: Expired — Please renew your subscription',
    ],
    ['an invalid license', { status: 'invalid' }, 'License: Invalid — License key is invalid'],
  ])('shows the status of %s as a non-interactive row', (_name, overrides, label) => {
    const { menu } = setup(licenseState(overrides));

    expect(menu[0]).toEqual({ kind: 'status', label });
  });

  it.each([
    'trial',
    'trial-expired',
    'valid',
    'expired',
    'invalid',
  ] as const)('offers nothing to purchase a license when the status is %s', (status) => {
    const { menu } = setup(licenseState({ status }));

    expect(labels(menu).filter((label) => /purchase/i.test(label))).toEqual([]);
    expect(menu.filter((entry) => entry.kind === 'item').map((entry) => entry.label)).toEqual([
      'Open Depth View',
      'Preferences…',
    ]);
  });

  it('leaves the status row out when there is no license state', () => {
    const { menu } = setup(null);
    expect(labels(menu)).toEqual(['Open Depth View', 'Preferences…']);
  });

  it('opens the depth view from "Open Depth View"', () => {
    const { actions, menu } = setup();

    activate(menu, 'Open Depth View');

    expect(actions.openDepthView).toHaveBeenCalledTimes(1);
    expect(actions.openPreferences).not.toHaveBeenCalled();
  });

  it('opens the preferences from "Preferences…"', () => {
    const { actions, menu } = setup();

    activate(menu, 'Preferences…');

    expect(actions.openPreferences).toHaveBeenCalledTimes(1);
    expect(actions.openDepthView).not.toHaveBeenCalled();
  });
});

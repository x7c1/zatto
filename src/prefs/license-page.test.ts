import type Gio from 'gi://Gio';
import { describe, expect, it } from 'vitest';
import { licenseNeedsAttention } from './license-page.js';

function settingsWith(values: {
  status: string;
  warningThreshold?: number;
  probeResult?: string;
}): Gio.Settings {
  const strings: Record<string, string> = {
    'license-status': values.status,
    'trial-probe-result': values.probeResult ?? 'none',
  };
  const ints: Record<string, number> = {
    'trial-warning-last-threshold': values.warningThreshold ?? 0,
  };
  return {
    get_string: (key: string) => strings[key],
    get_int: (key: string) => ints[key],
  } as unknown as Gio.Settings;
}

describe('licenseNeedsAttention', () => {
  it('is false during a trial that has not warned yet', () => {
    expect(licenseNeedsAttention(settingsWith({ status: 'trial' }))).toBe(false);
  });

  it.each([3, 1])('is true during a trial that has warned at %i days left', (threshold) => {
    expect(
      licenseNeedsAttention(settingsWith({ status: 'trial', warningThreshold: threshold }))
    ).toBe(true);
  });

  it.each([
    'none',
    'answered',
  ])('is true for an ended trial with probe result %s', (probeResult) => {
    expect(licenseNeedsAttention(settingsWith({ status: 'trial-expired', probeResult }))).toBe(
      true
    );
  });

  it('is false for an ended trial that the license server no longer answers for', () => {
    expect(
      licenseNeedsAttention(settingsWith({ status: 'trial-expired', probeResult: 'no-response' }))
    ).toBe(false);
  });

  it.each(['expired', 'invalid'])('is true for a %s license', (status) => {
    expect(licenseNeedsAttention(settingsWith({ status }))).toBe(true);
  });

  it('is false for a valid license, even after the trial warned', () => {
    expect(licenseNeedsAttention(settingsWith({ status: 'valid', warningThreshold: 1 }))).toBe(
      false
    );
  });
});

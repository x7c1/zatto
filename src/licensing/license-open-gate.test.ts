/**
 * Opening the depth view through the license gate: {@link LicenseOpenGate}
 * wired into an {@link OverlayController} with fakes, from both the hot
 * corner and the top bar menu (`open()`).
 */

import type { DisabledReason } from '@haco-studio/gnome-licensing';
import { describe, expect, it, vi } from 'vitest';
import { OverlayController } from '../ui/overlay/overlay-controller.js';
import {
  FakeHotCorner,
  FakeModalGrab,
  FakeOverlayActor,
  FakeRealWindows,
  FakeWindowMirror,
} from '../ui/overlay/test-fakes.js';
import { LicenseOpenGate } from './license-open-gate.js';
import { FakeLicense, FakeLockedNotice } from './test-fakes.js';

function setup(reason: DisabledReason | null) {
  let now = 0;
  const license = new FakeLicense(reason);
  const notice = new FakeLockedNotice();
  const hotCorner = new FakeHotCorner();
  const actor = new FakeOverlayActor();
  const modalGrab = new FakeModalGrab();
  const windowMirror = new FakeWindowMirror();
  const realWindows = new FakeRealWindows();
  const controller = new OverlayController(hotCorner, actor, modalGrab, windowMirror, realWindows, {
    debounceMs: 100,
    now: () => now,
    openGate: new LicenseOpenGate(license, notice, 'Zatto'),
  });
  controller.enable();
  return {
    license,
    notice,
    controller,
    hotCorner,
    actor,
    modalGrab,
    windowMirror,
    advance(ms: number) {
      now += ms;
    },
  };
}

const OPENERS = {
  'the hot corner': (s: ReturnType<typeof setup>) => s.hotCorner.fireEnter(),
  'the top bar menu': (s: ReturnType<typeof setup>) => s.controller.open(),
};

describe.each(Object.entries(OPENERS))('opening the depth view from %s', (_name, openFrom) => {
  it('opens it and records a day of use when unlocked', () => {
    const s = setup(null);

    openFrom(s);

    expect(s.controller.snapshot().overlay).toEqual({ state: 'open', visible: true });
    expect(s.license.useCount()).toBe(1);
    expect(s.notice.shown).toEqual([]);
  });

  it('does not open it and shows why when locked', () => {
    const s = setup('trial-expired');

    openFrom(s);

    expect(s.controller.snapshot().overlay).toEqual({ state: 'closed', visible: false });
    expect(s.actor.isVisible()).toBe(false);
    expect(s.modalGrab.acquireCount).toBe(0);
    expect(s.windowMirror.mountCount).toBe(0);
    expect(s.notice.shown).toEqual([
      {
        headline: 'Your Zatto trial has ended.',
        instruction: 'Activate a license to keep using Zatto.',
        canOpenPreferences: true,
      },
    ]);
  });

  it('records the day of use before checking the lock', () => {
    const s = setup(null);
    // Recording the trial's last day ends the trial on this very open.
    s.license.reasonAfterUse = 'trial-expired';

    openFrom(s);

    expect(s.license.calls).toEqual(['recordUse', 'getDisabledReason']);
    expect(s.controller.snapshot().overlay.state).toBe('closed');
    expect(s.notice.shown).toHaveLength(1);
  });

  it('opens once unlocked, without anything else being reset', () => {
    const s = setup('license-invalid');
    openFrom(s);
    s.advance(150);

    s.license.setReason(null);
    openFrom(s);

    expect(s.controller.snapshot().overlay.state).toBe('open');
    expect(s.notice.shown).toHaveLength(1);
  });
});

describe('the locked notice', () => {
  it('is not shown again from the hot corner while the previous one is in the tray', () => {
    const s = setup('trial-expired');
    s.hotCorner.fireEnter();
    s.advance(150);

    s.hotCorner.fireEnter();

    expect(s.controller.snapshot().overlay.state).toBe('closed');
    expect(s.license.useCount()).toBe(2);
    expect(s.notice.shown).toHaveLength(1);
  });

  it('is shown again from the hot corner once the previous one has left the tray', () => {
    const s = setup('trial-expired');
    s.hotCorner.fireEnter();
    s.advance(150);
    s.notice.dismiss();

    s.hotCorner.fireEnter();

    expect(s.notice.shown).toHaveLength(2);
    expect(s.notice.isLockedShown()).toBe(true);
  });

  it('is shown on every request from the top bar menu, even while one is in the tray', () => {
    const s = setup('trial-expired');
    s.hotCorner.fireEnter();

    s.controller.open();
    s.controller.open();

    expect(s.controller.snapshot().overlay.state).toBe('closed');
    expect(s.notice.shown).toHaveLength(3);
  });
});

describe('LicenseOpenGate', () => {
  it('does not lock when recording the use fails', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const s = setup(null);
      s.license.recordUseError = new Error('boom');

      s.hotCorner.fireEnter();

      expect(s.controller.snapshot().overlay.state).toBe('open');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
    } finally {
      log.mockRestore();
    }
  });

  it('explains a lock the preferences cannot lift without offering them', () => {
    const s = setup('offline-grace-exceeded');

    s.hotCorner.fireEnter();

    expect(s.notice.shown).toEqual([
      {
        headline: 'This device has been offline for too long.',
        instruction: 'Reconnect to the internet to continue.',
        canOpenPreferences: false,
      },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { pruneStaleReloadUuids } from './prune-stale-reloads.js';
import { FakeShellExtensionSettings } from './test-fakes.js';

const BASE = 'zatto@x7c1.github.io';
const CURRENT = `${BASE}-reload-1700000000000003`;

describe('pruneStaleReloadUuids', () => {
  it('keeps canonical + current and drops every other reload UUID from both keys', () => {
    const port = new FakeShellExtensionSettings({
      enabled: [BASE, `${BASE}-reload-1000`, CURRENT, 'ding@rastersoft.com'],
      disabled: [`${BASE}-reload-2000`, `${BASE}-reload-3000`, CURRENT, BASE],
    });

    pruneStaleReloadUuids(port, BASE, CURRENT);

    expect(port.getEnabled()).toEqual([BASE, CURRENT, 'ding@rastersoft.com']);
    expect(port.getDisabled()).toEqual([CURRENT, BASE]);
    expect(port.enabledWrites).toBe(1);
    expect(port.disabledWrites).toBe(1);
  });

  it('is a no-op when there are no stale entries (no GSettings write)', () => {
    const port = new FakeShellExtensionSettings({
      enabled: [BASE, CURRENT, 'ding@rastersoft.com'],
      disabled: ['other@example.com'],
    });

    pruneStaleReloadUuids(port, BASE, CURRENT);

    expect(port.getEnabled()).toEqual([BASE, CURRENT, 'ding@rastersoft.com']);
    expect(port.getDisabled()).toEqual(['other@example.com']);
    expect(port.enabledWrites).toBe(0);
    expect(port.disabledWrites).toBe(0);
  });

  it('leaves unrelated UUIDs in both keys untouched', () => {
    const port = new FakeShellExtensionSettings({
      enabled: ['ding@rastersoft.com', 'other@example.com'],
      disabled: ['something@else.org'],
    });

    pruneStaleReloadUuids(port, BASE, CURRENT);

    expect(port.getEnabled()).toEqual(['ding@rastersoft.com', 'other@example.com']);
    expect(port.getDisabled()).toEqual(['something@else.org']);
    expect(port.enabledWrites).toBe(0);
    expect(port.disabledWrites).toBe(0);
  });

  it('matches only <base>-reload-<digits> (rejects non-digit suffixes and other bases)', () => {
    const port = new FakeShellExtensionSettings({
      enabled: [
        BASE,
        `${BASE}-reload-123`, // matches the pattern -> pruned
        `${BASE}-reload-foo`, // non-digit suffix -> kept
        `${BASE}-reload-`, // empty suffix -> kept
        `${BASE}-reload-12a`, // mixed suffix -> kept
        'other@example.com-reload-1', // different base -> kept
      ],
      disabled: [],
    });

    pruneStaleReloadUuids(port, BASE, CURRENT);

    expect(port.getEnabled()).toEqual([
      BASE,
      `${BASE}-reload-foo`,
      `${BASE}-reload-`,
      `${BASE}-reload-12a`,
      'other@example.com-reload-1',
    ]);
    expect(port.enabledWrites).toBe(1);
    expect(port.disabledWrites).toBe(0);
  });
});

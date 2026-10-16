import { describe, expect, it } from 'vitest';
import { describeHotCorners } from './hot-corners-description.js';

const CONFLICT = 'Settings › Multitasking › Hot Corner';

describe('describeHotCorners', () => {
  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ] as const)('with top-left on and GNOME hot corner %s, mentions the conflict: %s', (gnome, mentioned) => {
    const text = describeHotCorners(['top-left', 'bottom-right'], gnome);
    expect(text).toContain('opens the depth view');
    expect(text.includes(CONFLICT)).toBe(mentioned);
  });

  it.each([
    true,
    false,
    undefined,
  ] as const)('with top-left off and GNOME hot corner %s, does not mention the conflict', (gnome) => {
    const text = describeHotCorners(['bottom-left', 'bottom-right'], gnome);
    expect(text).toContain('opens the depth view');
    expect(text).not.toContain(CONFLICT);
  });

  it('says that no corner opens the depth view when none is on', () => {
    const text = describeHotCorners([], true);
    expect(text).toContain('No corner opens the depth view');
    expect(text).not.toContain(CONFLICT);
  });
});

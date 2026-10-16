import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HOT_CORNERS,
  HOT_CORNERS_KEY,
  parseHotCorners,
  withHotCorner,
} from './hot-corner-setting.js';

const SCHEMA_XML = new URL(
  '../../../dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml',
  import.meta.url
);

describe('parseHotCorners', () => {
  it('keeps the default list as is', () => {
    const warn = vi.fn();
    expect(parseHotCorners(['bottom-left', 'bottom-right'], warn)).toEqual([
      'bottom-left',
      'bottom-right',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps a subset, in the fixed corner order', () => {
    expect(parseHotCorners(['bottom-right'], vi.fn())).toEqual(['bottom-right']);
    expect(parseHotCorners(['bottom-right', 'top-right'], vi.fn())).toEqual([
      'top-right',
      'bottom-right',
    ]);
  });

  it('accepts an empty list as no corner', () => {
    const warn = vi.fn();
    expect(parseHotCorners([], warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops duplicates', () => {
    expect(parseHotCorners(['bottom-left', 'bottom-left', 'top-left'], vi.fn())).toEqual([
      'top-left',
      'bottom-left',
    ]);
  });

  it('ignores an unknown name with one warning per distinct name', () => {
    const warn = vi.fn();
    expect(parseHotCorners(['middle', 'bottom-left', 'middle', 'BOTTOM-RIGHT'], warn)).toEqual([
      'bottom-left',
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('"middle"');
    expect(warn.mock.calls[1][0]).toContain('"BOTTOM-RIGHT"');
  });
});

describe('withHotCorner', () => {
  it('switches one corner on, keeping the others', () => {
    expect(withHotCorner(['bottom-left'], 'top-right', true)).toEqual(['top-right', 'bottom-left']);
  });

  it('switches one corner off, keeping a top-left set by other means', () => {
    expect(
      withHotCorner(['top-left', 'bottom-left', 'bottom-right'], 'bottom-left', false)
    ).toEqual(['top-left', 'bottom-right']);
  });

  it('can leave no corner at all', () => {
    expect(withHotCorner(['bottom-right'], 'bottom-right', false)).toEqual([]);
  });

  it('drops unknown strings and duplicates', () => {
    expect(withHotCorner(['bogus', 'bottom-left', 'bottom-left'], 'bottom-right', true)).toEqual([
      'bottom-left',
      'bottom-right',
    ]);
  });
});

describe('DEFAULT_HOT_CORNERS', () => {
  it('matches the default of the schema key', () => {
    const xml = readFileSync(SCHEMA_XML, 'utf8');
    const key = xml.match(new RegExp(`<key name="${HOT_CORNERS_KEY}"[^>]*>([\\s\\S]*?)</key>`));
    const defaultValue = key?.[1].match(/<default>([^<]*)<\/default>/)?.[1];
    expect(defaultValue).toBeDefined();
    const corners = [...(defaultValue ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1]);
    expect(corners).toEqual(DEFAULT_HOT_CORNERS);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHOW_TOP_BAR_INDICATOR,
  SHOW_TOP_BAR_INDICATOR_KEY,
} from './top-bar-indicator-setting.js';

const SCHEMA_XML = new URL(
  '../../../dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml',
  import.meta.url
);

describe('DEFAULT_SHOW_TOP_BAR_INDICATOR', () => {
  it('matches the boolean default of the schema key', () => {
    const xml = readFileSync(SCHEMA_XML, 'utf8');
    const key = xml.match(
      new RegExp(`<key name="${SHOW_TOP_BAR_INDICATOR_KEY}" type="b">([\\s\\S]*?)</key>`)
    );
    const defaultValue = key?.[1].match(/<default>([^<]*)<\/default>/)?.[1];
    expect(defaultValue).toBe(String(DEFAULT_SHOW_TOP_BAR_INDICATOR));
  });
});

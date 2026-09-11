import { describe, expect, it } from 'vitest';

import { en, tr } from './catalogs';
import { localeFromLanguage } from './locales';
import { localizePath } from './routing';

describe('i18n catalogs and routing', () => {
  it('keeps both catalogs in parity', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  it('keeps the mobile landing hint on desktop without saying computer', () => {
    expect(en['landing.desktopHint']).toMatch(/desktop/i);
    expect(tr['landing.desktopHint']).toMatch(/desktop/i);
    expect(en['landing.desktopHint']).not.toMatch(/computer/i);
    expect(tr['landing.desktopHint']).not.toMatch(/bilgisayar/i);
    for (const key of [
      'desktopRequired.landing.title',
      'desktopRequired.landing.body',
      'desktopRequired.story.title',
      'desktopRequired.story.body',
      'desktopRequired.copy',
      'desktopRequired.copyHome',
      'desktopRequired.share',
    ] as const) {
      expect(en[key]).not.toMatch(/computer/i);
      expect(tr[key]).not.toMatch(/bilgisayar/i);
    }
  });

  it('uses Turkish only for Turkish browser locales', () => {
    expect(localeFromLanguage('tr-TR')).toBe('tr');
    expect(localeFromLanguage('en-US')).toBe('en');
    expect(localeFromLanguage(undefined)).toBe('en');
  });

  it('replaces the locale while preserving query and hash', () => {
    expect(localizePath('/en/results?u=semih#reviews', 'tr')).toBe('/tr/results?u=semih#reviews');
    expect(localizePath('/results?u=semih', 'en')).toBe('/en/results?u=semih');
  });
});

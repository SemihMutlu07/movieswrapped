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

  it('treats username scrape as best-effort, not the guaranteed path', () => {
    expect(en['landing.username.title']).toMatch(/or try a public username/i);
    expect(en['landing.username.hint']).toMatch(/ZIP upload is the reliable path/i);
    expect(tr['landing.username.hint']).toMatch(/ZIP/i);
    expect(en['landing.howItWorks.enter.title']).toMatch(/upload your export/i);
    expect(en['landing.error.scrapeBlocked.action']).toMatch(/export ZIP/i);
    expect(en['landing.storyWait.rssPreview']).toMatch(/RSS preview, not a full library/i);
    expect(tr['landing.storyWait.rssPreview']).toMatch(/RSS/i);
    expect(en['landing.cache.badge']).toMatch(/^cached$/i);
    expect(en['landing.cache.reupload']).toMatch(/re-upload zip/i);
    expect(en['results.cached.banner']).toMatch(/cached aggregates/i);
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

  it('keeps English home at / and Turkish home at /tr', () => {
    expect(localizePath('/', 'en')).toBe('/');
    expect(localizePath('/en', 'en')).toBe('/');
    expect(localizePath('/', 'tr')).toBe('/tr');
    expect(localizePath('/story', 'en')).toBe('/en/story');
  });

  it('locks the English homepage title copy', () => {
    expect(en['landing.hero.title']).toBe('Your Letterboxd Wrapped');
    expect(en['landing.hero.tagline']).toBe('From the zip you download. Not their screen again.');
    expect(en['landing.faq.whatIs.answer']).toBe(
      "The file from your zip is your year. Letterboxd's Year in Review is the January 2 email, the same screen again.",
    );
    expect(tr['landing.hero.title']).toBe(
      'Bu senin yılın, indirdiğin dosyadan. Aynı ekran onlarınki.',
    );
  });
});

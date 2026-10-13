import { describe, expect, it } from 'vitest';

import { en, tr } from './catalogs';
import { localeFromLanguage } from './locales';
import { localizePath } from './routing';

describe('i18n catalogs and routing', () => {
  it('keeps both catalogs in parity', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  it('names Letterboxd Wrapped 2026 in the landing h1', () => {
    expect(en['landing.hero.title']).toContain('Letterboxd Wrapped 2026');
    expect(tr['landing.hero.title']).toContain('Letterboxd Wrapped 2026');
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

  it('treats username scrape as the live path with bookmarklet and ZIP backups', () => {
    expect(en['landing.username.title']).toMatch(/type your letterboxd username/i);
    expect(en['landing.username.hint']).toMatch(/bookmarklet or a ZIP/i);
    expect(en['landing.username.bookmarklet']).toMatch(/bookmarklet/i);
    expect(tr['landing.username.hint']).toMatch(/ZIP/i);
    expect(en['landing.howItWorks.enter.title']).toMatch(/enter your username/i);
    expect(en['landing.error.desktopOffline.title']).toMatch(/live scan offline/i);
    expect(en['landing.error.desktopOffline.action']).toMatch(/bookmarklet/i);
    expect(en['landing.error.queueFull.action']).toMatch(/bookmarklet/i);
    expect(en['landing.error.queueFull.action']).toMatch(/ZIP/i);
    expect(tr['landing.error.queueFull.action']).toMatch(/bookmarklet/i);
    expect(en['landing.error.scrapeBlocked.action']).toMatch(/export ZIP/i);
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

import { describe, expect, it } from 'vitest';

import { DEFAULT_HREF, OG_SHARE_IMAGE, seoByLocale, sitemapLanguages } from './seo';

describe('seo copy', () => {
  it('names Letterboxd Wrapped 2026 in EN and TR titles and descriptions', () => {
    for (const locale of ['en', 'tr'] as const) {
      expect(seoByLocale[locale].title).toContain('Letterboxd Wrapped 2026');
      expect(seoByLocale[locale].description).toContain('Letterboxd Wrapped 2026');
    }
  });

  it('points x-default and the share image at space-free URLs', () => {
    expect(DEFAULT_HREF).toBe('/en');
    expect(sitemapLanguages()['x-default']).toBe('https://movieswrapped.com/en');
    expect(OG_SHARE_IMAGE).not.toMatch(/\s/);
  });
});

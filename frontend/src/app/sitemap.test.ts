import { describe, expect, it } from 'vitest';

import sitemap from '@/app/sitemap';
import { hreflangUrls } from '@/i18n/site';

describe('sitemap', () => {
  it('lists only the English home and Turkish home', () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toEqual([
      'https://movieswrapped.com/',
      'https://movieswrapped.com/tr',
    ]);
    expect(urls.some((url) => url === 'https://movieswrapped.com/en' || url.endsWith('/en'))).toBe(false);
    expect(urls.some((url) => url.includes('/story'))).toBe(false);
    expect(urls.some((url) => url.includes('/results'))).toBe(false);
  });

  it('points hreflang en and x-default at /', () => {
    const languages = hreflangUrls();
    expect(languages).toEqual({
      en: 'https://movieswrapped.com/',
      tr: 'https://movieswrapped.com/tr',
      'x-default': 'https://movieswrapped.com/',
    });
    for (const entry of sitemap()) {
      expect(entry.alternates?.languages).toEqual(languages);
    }
  });
});

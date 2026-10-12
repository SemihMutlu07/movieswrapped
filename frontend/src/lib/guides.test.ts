import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import sitemap from '@/app/sitemap';
import { GUIDE_SLUGS, getGuide, guideJsonLd } from '@/lib/guides';

describe('guide documents', () => {
  it('publishes the same slugs in English and Turkish with matching FAQ schema', () => {
    for (const slug of GUIDE_SLUGS) {
      for (const locale of ['en', 'tr'] as const) {
        const guide = getGuide(locale, slug);
        expect(guide.h1.length).toBeGreaterThan(8);
        expect(guide.description.length).toBeGreaterThan(40);
        expect(guide.faqs.length).toBeGreaterThan(2);
        const questions = guideJsonLd(locale, slug)['@graph']
          .filter((node) => node['@type'] === 'FAQPage')
          .flatMap((node) => node.mainEntity as { name: string }[]);
        expect(questions.map((item) => item.name)).toEqual(guide.faqs.map((item) => item.question));
      }
    }
  });

  it('lists guide URLs in the sitemap and leaves the story player out', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain('https://movieswrapped.com/en/letterboxd-wrapped');
    expect(urls).toContain('https://movieswrapped.com/tr/cinema-scale');
    expect(urls).toContain('https://movieswrapped.com/en/export-letterboxd-data');
    expect(urls.some((url) => url.includes('/story'))).toBe(false);
    const guideEntry = sitemap().find((entry) => entry.url.endsWith('/en/letterboxd-wrapped'));
    expect(guideEntry?.alternates?.languages).toMatchObject({
      en: 'https://movieswrapped.com/en/letterboxd-wrapped',
      tr: 'https://movieswrapped.com/tr/letterboxd-wrapped',
    });
  });

  it('points llms.txt at every guide and keeps the English headlines in llms-full.txt', () => {
    const root = resolve(__dirname, '../../public');
    const llms = readFileSync(resolve(root, 'llms.txt'), 'utf8');
    const full = readFileSync(resolve(root, 'llms-full.txt'), 'utf8');
    for (const slug of GUIDE_SLUGS) {
      expect(llms).toContain(`https://movieswrapped.com/en/${slug}`);
      expect(llms).toContain(`https://movieswrapped.com/tr/${slug}`);
      expect(full).toContain(getGuide('en', slug).h1);
    }
  });
});

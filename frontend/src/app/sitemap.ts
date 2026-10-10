import type { MetadataRoute } from 'next';

import { locales } from '@/i18n/locales';
import { SITE_URL, sitemapLanguages } from '@/lib/seo';

// Source of truth for /sitemap.xml (no public/sitemap.xml copy).
// Static export requires explicitly static data routes.
export const dynamic = 'force-static';

// Static, indexable pages only. `/` 301s to `/en` and is not listed.
// Personal results pages (/results) stay out of search indexes.
const STATIC_PATHS = ['', 'story'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const languages = sitemapLanguages();
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const path of STATIC_PATHS) {
      const url = path ? `${SITE_URL}/${locale}/${path}` : `${SITE_URL}/${locale}`;
      const isHome = path === '';
      entries.push({
        url,
        changeFrequency: 'monthly',
        priority: isHome ? (locale === 'en' ? 1 : 0.9) : 0.6,
        alternates: { languages },
      });
    }
  }

  return entries;
}

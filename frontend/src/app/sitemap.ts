import type { MetadataRoute } from 'next';

import { locales } from '@/i18n/locales';

const SITE_URL = 'https://movieswrapped.com';

// Static export requires explicitly static data routes.
export const dynamic = 'force-static';

// Static, indexable pages only. Personal results pages (/results) are
// excluded — they are user-specific data and must stay out of search indexes.
const STATIC_PATHS = ['', 'story'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  // Root chooser (JS redirect to /en or /tr) with hreflang alternates.
  entries.push({
    url: `${SITE_URL}/`,
    changeFrequency: 'monthly',
    priority: 1,
    alternates: {
      languages: { en: `${SITE_URL}/en`, tr: `${SITE_URL}/tr`, 'x-default': `${SITE_URL}/` },
    },
  });

  for (const locale of locales) {
    for (const path of STATIC_PATHS) {
      const url = path ? `${SITE_URL}/${locale}/${path}` : `${SITE_URL}/${locale}`;
      const isHome = path === '';
      entries.push({
        url,
        changeFrequency: 'monthly',
        priority: isHome ? 0.9 : 0.6,
        alternates: {
          languages: { en: `${SITE_URL}/en`, tr: `${SITE_URL}/tr`, 'x-default': `${SITE_URL}/` },
        },
      });
    }
  }

  return entries;
}

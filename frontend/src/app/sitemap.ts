import type { MetadataRoute } from 'next';

import { locales } from '@/i18n/locales';
import { GUIDE_SITEMAP_PRIORITY, GUIDE_SLUGS } from '@/lib/guides';
import { SITE_URL, sitemapLanguages } from '@/lib/seo';

// Source of truth for /sitemap.xml (no public/sitemap.xml copy).
// Static export requires explicitly static data routes.
export const dynamic = 'force-static';

// Indexable documents only. `/` 301s to `/en`. Personal results and the
// session story player stay out: the story route is a playback shell, not
// a page a searcher can read.
const STATIC_PATHS: { path: string; priority: number }[] = [
  { path: '', priority: 1 },
  ...GUIDE_SLUGS.map((path) => ({ path, priority: GUIDE_SITEMAP_PRIORITY[path] })),
];

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const { path, priority } of STATIC_PATHS) {
      const url = path ? `${SITE_URL}/${locale}/${path}` : `${SITE_URL}/${locale}`;
      const isHome = path === '';
      entries.push({
        url,
        changeFrequency: 'monthly',
        priority: isHome ? (locale === 'en' ? 1 : 0.9) : priority,
        alternates: { languages: sitemapLanguages(path) },
      });
    }
  }

  return entries;
}

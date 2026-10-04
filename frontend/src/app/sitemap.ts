import type { MetadataRoute } from 'next';

import { hreflangUrls, SITE_ORIGIN } from '@/i18n/site';

// Static export requires explicitly static data routes.
export const dynamic = 'force-static';

// Static, indexable pages only. `/en` is a 301 to `/` and must not be listed.
// Personal results and story playback stay out of the sitemap.
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = hreflangUrls();

  return [
    {
      url: `${SITE_ORIGIN}/`,
      changeFrequency: 'monthly',
      priority: 1,
      alternates: { languages },
    },
    {
      url: `${SITE_ORIGIN}/tr`,
      changeFrequency: 'monthly',
      priority: 0.9,
      alternates: { languages },
    },
  ];
}

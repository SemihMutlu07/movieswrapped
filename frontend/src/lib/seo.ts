import type { Locale } from '@/i18n/locales';

export const SITE_URL = 'https://movieswrapped.com';
export const DEFAULT_HREF = '/en';
export const OG_SHARE_IMAGE = '/assets/og-share-logo-dark.png';
export const OG_LANDING_IMAGE = '/assets/og-image-1200x630.png';

export const hreflangLanguages = {
  en: '/en',
  tr: '/tr',
  'x-default': '/en',
} as const;

export const seoByLocale: Record<
  Locale,
  { title: string; description: string; ogAlt: string }
> = {
  en: {
    title: 'Movies Wrapped — Letterboxd Wrapped 2026',
    description:
      'Letterboxd Wrapped 2026: Movies Wrapped turns your Letterboxd watch history into a personal year-in-film dossier — film statistics, rating personality, favorite directors and actors, review analysis, and your cinema scale.',
    ogAlt: 'Movies Wrapped — Letterboxd Wrapped 2026',
  },
  tr: {
    title: 'Movies Wrapped — Letterboxd Wrapped 2026',
    description:
      'Letterboxd Wrapped 2026: Movies Wrapped, Letterboxd izleme geçmişini kişisel bir yılın-film dosyasına dönüştürür — film istatistikleri, puanlama kişiliği, favori yönetmen ve oyuncular, inceleme analizi ve sinema ölçeğiniz.',
    ogAlt: 'Movies Wrapped — Letterboxd Wrapped 2026',
  },
};

/** Absolute hreflang map for a locale-less path (`''` is the homepage). */
export function sitemapLanguages(path = ''): Record<string, string> {
  const suffix = path ? `/${path}` : '';
  return {
    en: `${SITE_URL}/en${suffix}`,
    tr: `${SITE_URL}/tr${suffix}`,
    'x-default': `${SITE_URL}/en${suffix}`,
  };
}

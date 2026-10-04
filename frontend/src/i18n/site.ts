import { DEFAULT_LOCALE, type Locale } from './locales';

export const SITE_ORIGIN = 'https://movieswrapped.com';

export function localeHomePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '/' : `/${locale}`;
}

/** hreflang paths for Next metadata. English lives at `/`; `/en` is only a 301. */
export const HREFLANG_PATHS = {
  en: '/',
  tr: '/tr',
  'x-default': '/',
} as const;

export function hreflangUrls(origin = SITE_ORIGIN): {
  en: string;
  tr: string;
  'x-default': string;
} {
  return {
    en: `${origin}/`,
    tr: `${origin}/tr`,
    'x-default': `${origin}/`,
  };
}

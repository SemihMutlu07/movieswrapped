import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import RootDocument from '@/app/RootDocument';
import { isLocale, locales, type Locale } from '@/i18n/locales';
import { HREFLANG_PATHS, SITE_ORIGIN, localeHomePath } from '@/i18n/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

const metadataByLocale: Record<Locale, { title: string; description: string }> = {
  en: {
    title: 'Your Letterboxd Wrapped | Movies Wrapped',
    description: 'From the zip you download. Not their screen again.',
  },
  tr: {
    title: 'Movies Wrapped - Sinemada Yılın',
    description: 'Letterboxd verilerinden kişisel film istatistiklerini ve içgörülerini keşfet.',
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = metadataByLocale[locale];
  const homePath = localeHomePath(locale);
  const pageUrl = `${SITE_ORIGIN}${homePath === '/' ? '/' : homePath}`;
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical: homePath,
      languages: HREFLANG_PATHS,
    },
    openGraph: {
      type: 'website',
      url: pageUrl,
      siteName: 'Movies Wrapped',
      title: copy.title,
      description: copy.description,
      images: [{
        url: '/assets/og-image-1200x630.png',
        width: 1200,
        height: 630,
        alt: locale === 'tr' ? 'Movies Wrapped — Letterboxd ile sinemada yılın' : 'Your Letterboxd Wrapped',
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: copy.title,
      description: copy.description,
      images: ['/assets/og-image-1200x630.png'],
    },
    // English `/en` is a 301 to `/`. Do not index the leftover static file.
    robots: locale === 'en' ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  themeColor: '#1e252d',
  viewportFit: 'cover',
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <RootDocument locale={locale} showLanguageSwitcher>{children}</RootDocument>;
}

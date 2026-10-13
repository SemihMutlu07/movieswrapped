import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import RootDocument from '@/app/RootDocument';
import { isLocale, locales } from '@/i18n/locales';
import { OG_LANDING_IMAGE, hreflangLanguages, seoByLocale } from '@/lib/seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = seoByLocale[locale];
  const siteUrl = 'https://movieswrapped.com';
  return {
    metadataBase: new URL(siteUrl),
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical: `/${locale}`,
      languages: hreflangLanguages,
    },
    openGraph: {
      type: 'website',
      url: `${siteUrl}/${locale}`,
      siteName: 'Movies Wrapped',
      title: copy.title,
      description: copy.description,
      images: [{
        url: OG_LANDING_IMAGE,
        width: 1200,
        height: 630,
        alt: copy.ogAlt,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: copy.title,
      description: copy.description,
      images: [OG_LANDING_IMAGE],
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  themeColor: '#14181c',
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

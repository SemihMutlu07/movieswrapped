import { Suspense, type ReactNode } from 'react';
import { Manrope, Syne } from 'next/font/google';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import PageViewTracker from '@/components/PageViewTracker';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { Locale } from '@/i18n/locales';
import { OG_SHARE_IMAGE, SITE_URL, seoByLocale } from '@/lib/seo';

import './globals.css';

const syne = Syne({
  subsets: ['latin'],
  weight: ['500', '700', '800'],
  variable: '--font-syne',
});

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
});

export default function RootDocument({
  children,
  locale,
  showLanguageSwitcher = false,
}: {
  children: ReactNode;
  locale: Locale;
  showLanguageSwitcher?: boolean;
}) {
  const description = seoByLocale[locale].description;
  // FAQPage JSON-LD lives on the locale homepage only, next to the visible
  // FAQ. Guide routes ship their own graph so this one is not repeated.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/${locale}/#website`,
        url: `${SITE_URL}/${locale}`,
        name: 'Movies Wrapped',
        description,
        publisher: { '@id': `${SITE_URL}/#organization` },
        inLanguage: locale,
      },
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: 'Movies Wrapped',
        url: `${SITE_URL}/en`,
        logo: `${SITE_URL}${OG_SHARE_IMAGE}`,
        description,
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#webapp`,
        name: 'Movies Wrapped',
        url: `${SITE_URL}/en`,
        description,
        applicationCategory: 'EntertainmentApplication',
        operatingSystem: 'Any',
        inLanguage: locale,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
      },
    ],
  };
  return (
    <html lang={locale}>
      <head>
        <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-48x48.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon-192x192.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/assets/favicon-180x180.png" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${manrope.variable} ${syne.variable} bg-[#1e252d] text-white antialiased`}>
        <I18nProvider locale={locale}>
          <ErrorBoundary>
            {showLanguageSwitcher ? (
              <Suspense fallback={null}>
                <LanguageSwitcher />
              </Suspense>
            ) : null}
            {children}
            <Suspense fallback={null}>
              <PageViewTracker />
            </Suspense>
          </ErrorBoundary>
        </I18nProvider>
      </body>
    </html>
  );
}

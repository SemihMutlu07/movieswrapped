import { Suspense, type ReactNode } from 'react';
import { Manrope, Syne } from 'next/font/google';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import PageViewTracker from '@/components/PageViewTracker';
import { I18nProvider } from '@/i18n/I18nProvider';
import { getFaqItems } from '@/i18n/faq';
import type { Locale } from '@/i18n/locales';

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
  const description = locale === 'tr'
    ? 'Movies Wrapped, Letterboxd izleme geçmişini kişisel film istatistiklerine ve içgörülere dönüştürür.'
    : 'Movies Wrapped turns your Letterboxd watch history into personal film statistics and insights.';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `https://movieswrapped.com/${locale}/#website`,
        url: `https://movieswrapped.com/${locale}`,
        name: 'Movies Wrapped',
        description,
        publisher: { '@id': 'https://movieswrapped.com/#organization' },
        inLanguage: locale,
      },
      {
        '@type': 'Organization',
        '@id': 'https://movieswrapped.com/#organization',
        name: 'Movies Wrapped',
        url: 'https://movieswrapped.com/',
        logo: 'https://movieswrapped.com/assets/Sosyal%20Medya%20Logo%20-%20Dark.png',
        description,
      },
      {
        '@type': 'WebApplication',
        '@id': 'https://movieswrapped.com/#webapp',
        name: 'Movies Wrapped',
        url: 'https://movieswrapped.com/',
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
      {
        '@type': 'FAQPage',
        '@id': `https://movieswrapped.com/${locale}/#faq`,
        inLanguage: locale,
        mainEntity: getFaqItems(locale).map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
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

import { getFaqItems } from '@/i18n/faq';
import type { Locale } from '@/i18n/locales';
import { SITE_ORIGIN, localeHomePath } from '@/i18n/site';

export function buildSiteJsonLd(locale: Locale) {
  const siteUrl = `${SITE_ORIGIN}/`;
  const pagePath = localeHomePath(locale);
  const pageUrl = pagePath === '/' ? siteUrl : `${SITE_ORIGIN}${pagePath}`;
  const description = locale === 'tr'
    ? 'Movies Wrapped, Letterboxd izleme geçmişini kişisel film istatistiklerine ve içgörülere dönüştürür.'
    : 'Movies Wrapped turns your Letterboxd watch history into personal film statistics and insights.';

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}#website`,
        url: siteUrl,
        name: 'Movies Wrapped',
        description,
        publisher: { '@id': `${SITE_ORIGIN}/#organization` },
        inLanguage: locale,
      },
      {
        '@type': 'Organization',
        '@id': `${SITE_ORIGIN}/#organization`,
        name: 'Movies Wrapped',
        url: siteUrl,
        logo: `${SITE_ORIGIN}/assets/Sosyal%20Medya%20Logo%20-%20Dark.png`,
        description,
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_ORIGIN}/#webapp`,
        name: 'Movies Wrapped',
        url: siteUrl,
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
        '@id': `${pageUrl}#faq`,
        inLanguage: locale,
        mainEntity: getFaqItems(locale).map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      },
    ],
  };
}

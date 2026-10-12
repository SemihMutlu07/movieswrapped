import { getFaqItems } from '@/i18n/faq';
import type { Locale } from '@/i18n/locales';
import { SITE_URL } from '@/lib/seo';

/** Homepage FAQ schema. Rendered only beside the visible landing FAQ. */
export default function FaqJsonLd({ locale }: { locale: Locale }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_URL}/${locale}/#faq`,
    inLanguage: locale,
    mainEntity: getFaqItems(locale).map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
  );
}

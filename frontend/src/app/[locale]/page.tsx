import { notFound } from 'next/navigation';

import FaqJsonLd from '@/components/seo/FaqJsonLd';
import LetterboxdLanding from '@/components/LetterboxdLanding';
import { isLocale } from '@/i18n/locales';

export default async function LocaleHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <>
      <FaqJsonLd locale={locale} />
      <LetterboxdLanding />
    </>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import GuideArticle from '@/components/seo/GuideArticle';
import { isLocale } from '@/i18n/locales';
import { guideMetadata } from '@/lib/guides';

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return guideMetadata(locale, 'letterboxd-wrapped');
}

export default async function LetterboxdWrappedGuide({ params }: Params) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <GuideArticle locale={locale} slug="letterboxd-wrapped" />;
}

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import RootDocument from '@/app/RootDocument';
import { HREFLANG_PATHS, SITE_ORIGIN } from '@/i18n/site';

const TITLE = 'Your Letterboxd Wrapped | Movies Wrapped';
const DESCRIPTION = 'From the zip you download. Not their screen again.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: '/',
    languages: HREFLANG_PATHS,
  },
  openGraph: {
    type: 'website',
    url: `${SITE_ORIGIN}/`,
    siteName: 'Movies Wrapped',
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: '/assets/og-image-1200x630.png',
        width: 1200,
        height: 630,
        alt: 'Your Letterboxd Wrapped',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/assets/og-image-1200x630.png'],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#1e252d',
  viewportFit: 'cover',
};

export default function EnglishHomeLayout({ children }: { children: ReactNode }) {
  return <RootDocument locale="en" showLanguageSwitcher>{children}</RootDocument>;
}

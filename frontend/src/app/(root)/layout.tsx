import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import RootDocument from '@/app/RootDocument';
import {
  DEFAULT_HREF,
  OG_SHARE_IMAGE,
  hreflangLanguages,
  seoByLocale,
} from '@/lib/seo';

const copy = seoByLocale.en;

export const metadata: Metadata = {
  metadataBase: new URL('https://movieswrapped.com'),
  title: copy.title,
  description: copy.description,
  alternates: {
    canonical: DEFAULT_HREF,
    languages: hreflangLanguages,
  },
  openGraph: {
    type: 'website',
    url: `https://movieswrapped.com${DEFAULT_HREF}`,
    siteName: 'Movies Wrapped',
    title: copy.title,
    description: copy.description,
    images: [
      {
        url: OG_SHARE_IMAGE,
        width: 1080,
        height: 1080,
        alt: copy.ogAlt,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: copy.title,
    description: copy.description,
    images: [OG_SHARE_IMAGE],
  },
  // Production 301s `/` → `/en`. This HTML is a local/dev fallback, not the
  // indexed homepage — crawlers should use the canonical `/en` instead.
  robots: { index: false, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#1e252d',
  viewportFit: 'cover',
};

export default function RootChooserLayout({ children }: { children: ReactNode }) {
  return <RootDocument locale="en">{children}</RootDocument>;
}

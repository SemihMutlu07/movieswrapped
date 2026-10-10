import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import RootDocument from '@/app/RootDocument';

export const metadata: Metadata = {
  title: 'Import Letterboxd export — Movies Wrapped',
  description: 'Receive a bookmarklet export from letterboxd.com and build your wrap.',
  robots: { index: false, follow: false },
};

export default function ImportLayout({ children }: { children: ReactNode }) {
  return <RootDocument locale="en">{children}</RootDocument>;
}

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Session playback, not a document. Without a dossier the page is an empty
// state, so it must not be offered to search as its own URL.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function StoryLayout({ children }: { children: ReactNode }) {
  return children;
}

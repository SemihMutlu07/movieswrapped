import type { Metadata } from 'next';

// Story playback is a personal session view, not an indexable landing page.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function StoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}

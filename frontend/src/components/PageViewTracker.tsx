'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { captureEvent, flushQueue, initPostHog } from '@/lib/posthog';

export default function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    initPostHog();
    flushQueue();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    captureEvent('$pageview', {
      path: pathname,
      search: searchParams?.toString() || '',
    });
  }, [pathname, searchParams]);

  return null;
}

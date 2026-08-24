'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { captureEvent, flushQueue, initPostHog } from '@/lib/posthog';
import { getConsent } from '@/lib/session-id';

export default function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const activate = () => {
      if (getConsent() !== 'accept') return;
      initPostHog();
      flushQueue();
    };

    activate();
    window.addEventListener('analytics-consent-changed', activate);
    return () => window.removeEventListener('analytics-consent-changed', activate);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || getConsent() !== 'accept') return;
    captureEvent('$pageview', {
      path: pathname,
      search: searchParams?.toString() || '',
    });
  }, [pathname, searchParams]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const captureCurrentPage = (event: Event) => {
      const detail = (event as CustomEvent<'accept' | 'decline'>).detail;
      if (detail !== 'accept') return;
      captureEvent('$pageview', {
        path: pathname,
        search: searchParams?.toString() || '',
        consent_activated: true,
      });
    };

    window.addEventListener('analytics-consent-changed', captureCurrentPage);
    return () => window.removeEventListener('analytics-consent-changed', captureCurrentPage);
  }, [pathname, searchParams]);

  return null;
}

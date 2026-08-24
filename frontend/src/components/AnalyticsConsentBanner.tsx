'use client';

import { useEffect, useState } from 'react';

import { captureEvent, clearQueue, initPostHog } from '@/lib/posthog';
import { getConsent, setConsent } from '@/lib/session-id';
import type { Locale } from '@/i18n/locales';

export default function AnalyticsConsentBanner({ locale }: { locale: Locale }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getConsent() === '');
  }, []);

  if (!visible) return null;

  const copy = locale === 'tr'
    ? {
        text: 'Movies Wrapped, ürünü geliştirmek ve hataları bulmak için anonim kullanım verileri kullanır. Oturum kaydı etkin olduğunda form alanları maskelenir.',
        accept: 'Kabul et',
        decline: 'Hayır',
      }
    : {
        text: 'Movies Wrapped uses anonymous usage analytics to improve the product and diagnose errors. When session recording is enabled, form inputs are masked.',
        accept: 'Accept',
        decline: 'No thanks',
      };

  const accept = () => {
    setConsent('accept');
    initPostHog();
    captureEvent('analytics_consent_accepted');
    setVisible(false);
  };

  const decline = () => {
    setConsent('decline');
    clearQueue();
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label={locale === 'tr' ? 'Analitik tercihi' : 'Analytics preference'}
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-3xl rounded-2xl border border-white/15 bg-[#151b22]/95 p-4 shadow-2xl backdrop-blur md:inset-x-6 md:flex md:items-center md:gap-5"
    >
      <p className="text-sm leading-6 text-white/80 md:flex-1">{copy.text}</p>
      <div className="mt-3 flex shrink-0 gap-2 md:mt-0">
        <button
          type="button"
          onClick={decline}
          className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10"
        >
          {copy.decline}
        </button>
        <button
          type="button"
          onClick={accept}
          className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600"
        >
          {copy.accept}
        </button>
      </div>
    </div>
  );
}

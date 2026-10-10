'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { LOCALE_STORAGE_KEY, isLocale, localeFromLanguage } from '@/i18n/locales';

export default function LocaleEntryPage() {
  useEffect(() => {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    const systemLanguage = navigator.languages?.[0] ?? navigator.language;
    const locale = isLocale(stored) ? stored : localeFromLanguage(systemLanguage);
    window.location.replace(`/${locale}${window.location.search}${window.location.hash}`);
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#1e252d] p-6 text-white">
      <div className="text-center">
        <p className="text-sm font-semibold text-white/70" role="status">
          Opening Movies Wrapped…
        </p>
        <noscript>
          <meta httpEquiv="refresh" content="0;url=/en" />
          <p className="mt-4 flex gap-3">
            <Link className="underline" href="/en">English</Link>
            <Link className="underline" href="/tr">Türkçe</Link>
          </p>
        </noscript>
      </div>
    </main>
  );
}

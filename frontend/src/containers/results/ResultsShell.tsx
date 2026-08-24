'use client';

import { useEffect } from 'react';

import { useI18n } from '@/i18n/I18nProvider';
import { markResultsNav } from '@/lib/results-nav';

/** Stable first paint for Results — never a blank screen after navigation. */
export default function ResultsShell() {
  const { t } = useI18n();

  useEffect(() => {
    markResultsNav('shell-visible');
  }, []);

  return (
    <div className="px-3 py-6 md:px-8" data-testid="results-shell">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-3 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-300/80">
            {t('results.shell.loading')}
          </p>
          <p className="text-sm text-slate-400">{t('results.shell.loadingHint')}</p>
        </div>
        <div className="h-16 rounded-2xl bg-white/[0.04]" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="h-24 rounded-2xl bg-white/[0.04]" />
          <div className="h-24 rounded-2xl bg-white/[0.04]" />
          <div className="col-span-2 h-24 rounded-2xl bg-white/[0.04] sm:col-span-1" />
        </div>
        <div className="h-48 rounded-2xl bg-white/[0.04]" />
      </div>
    </div>
  );
}

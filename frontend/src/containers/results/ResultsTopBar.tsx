'use client';

import { Suspense } from 'react';

import LanguageSwitcher from '@/components/LanguageSwitcher';
import { toggleClass } from '@/containers/results/sections/section-utils';
import { useI18n } from '@/i18n/I18nProvider';

type StatsWindow = 'lifetime' | 'year';

type ResultsTopBarProps = {
  hasYearWindow?: boolean;
  statsWindow?: StatsWindow;
  onStatsWindowChange?: (next: StatsWindow) => void;
};

/**
 * Owns the Results chrome that previously competed for one horizontal band:
 * stats-window filters + language switcher.
 *
 * Compact: language on its own row, filters on the next — never overlapping.
 * Expanded: filters centered, language trailing on the same row.
 */
export default function ResultsTopBar({
  hasYearWindow = false,
  statsWindow = 'lifetime',
  onStatsWindowChange,
}: ResultsTopBarProps) {
  const { t } = useI18n();

  return (
    <div className="sticky top-0 z-40 border-b border-white/8 bg-[#1e252d]/95 pt-[max(0.35rem,env(safe-area-inset-top))] backdrop-blur">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-3">
        <div className="hidden sm:block" />
        <div className="order-2 flex justify-center sm:order-none">
          {hasYearWindow && onStatsWindowChange ? (
            <div className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full border border-slate-700/30 bg-slate-800/60 p-0.5">
              <button
                type="button"
                className={toggleClass(statsWindow === 'lifetime')}
                onClick={() => onStatsWindowChange('lifetime')}
              >
                {t('results.window.allTime')}
              </button>
              <button
                type="button"
                className={toggleClass(statsWindow === 'year')}
                onClick={() => onStatsWindowChange('year')}
              >
                {t('results.window.last12Months')}
              </button>
            </div>
          ) : null}
        </div>
        <div className="order-1 flex justify-end sm:order-none">
          <Suspense fallback={null}>
            <LanguageSwitcher variant="inline" />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

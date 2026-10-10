'use client';

import type { CachedAnalysisRun } from '@/lib/supabase/analysis_runs';
import { useI18n } from '@/i18n/I18nProvider';

type CachedRunOfferProps = {
  username: string;
  run: CachedAnalysisRun;
  onViewCached: () => void;
  onReuploadZip: () => void;
  onAnalyzeLive: () => void;
};

export default function CachedRunOffer({
  username,
  run,
  onViewCached,
  onReuploadZip,
  onAnalyzeLive,
}: CachedRunOfferProps) {
  const { t } = useI18n();
  const films = run.total_films;
  const persona = run.cinematic_persona;
  const score = run.sinefil_meter;

  return (
    <section
      data-testid="cached-run-offer"
      aria-label={t('landing.cache.title')}
      className="rounded-2xl p-5 sm:p-6 backdrop-blur-sm"
      style={{ borderWidth: 1, borderColor: 'rgba(255, 127, 0, 0.35)', backgroundColor: 'rgba(27, 28, 30, 0.4)' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="cached-run-badge"
          className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: 'rgba(255, 127, 0, 0.18)', color: '#ffb060' }}
        >
          {t('landing.cache.badge')}
        </span>
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
          {t('landing.cache.title')}
        </h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-white/60">
        {t('landing.cache.hint')}
      </p>
      <p className="mt-3 text-sm text-white/80">
        @{username}
        {typeof films === 'number' ? ` · ${t('landing.cache.films', { count: films })}` : ''}
        {typeof score === 'number' ? ` · ${score}` : ''}
        {persona ? ` · ${persona}` : ''}
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onViewCached}
          className="rounded-xl px-5 py-3 text-sm font-semibold transition active:scale-[0.98]"
          style={{ backgroundColor: '#ff7f00', color: '#1b1c1e' }}
        >
          {t('landing.cache.view')}
        </button>
        <button
          type="button"
          onClick={onReuploadZip}
          className="rounded-xl px-5 py-3 text-sm font-semibold text-white transition active:scale-[0.98]"
          style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(31, 38, 46, 0.8)' }}
        >
          {t('landing.cache.reupload')}
        </button>
        <button
          type="button"
          onClick={onAnalyzeLive}
          className="rounded-xl px-5 py-3 text-sm font-semibold text-white/70 transition hover:text-white"
        >
          {t('landing.cache.scrapeAnyway')}
        </button>
      </div>
    </section>
  );
}

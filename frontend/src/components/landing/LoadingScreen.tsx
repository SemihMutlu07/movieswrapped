'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { PosterGuessGame, type PosterGameProps } from '@/components/landing/PosterGuessGame';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/catalogs';

function formatElapsed(seconds: number, t: (key: MessageKey) => string): string {
  if (seconds < 60) return t('landing.loading.seconds').replace('{value}', String(seconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return t('landing.loading.minutesSeconds').replace('{minutes}', String(m)).replace('{seconds}', String(s));
}

type Props = {
  title?: string;
  message?: string;
  detail?: string;
  onCancel?: () => void;
  mode?: 'upload' | 'scrape';
  estimatedFilms?: number;
  /** Typical total duration in seconds (hardcoded or from historical data). */
  typicalSeconds?: number;
  /** Live scrape trace events from /api/progress — real discovery feed. */
  events?: { stage?: string; message?: string; metrics?: Record<string, unknown>; elapsed_seconds?: number }[];
  /** Pixelated poster guessing game, shown while scraping. */
  posterGame?: PosterGameProps | null;
  /** Legacy transition signal. LoadingScreen intentionally never exposes navigation. */
  resultReady?: string | null;
  /** Worker fleet is empty (degraded): the job is queued but may take longer. */
  queued?: boolean;
};

const FUN_MESSAGE_KEYS = [
  'landing.loading.fun.1', 'landing.loading.fun.2', 'landing.loading.fun.3', 'landing.loading.fun.4',
  'landing.loading.fun.5', 'landing.loading.fun.6', 'landing.loading.fun.7', 'landing.loading.fun.8',
  'landing.loading.fun.9', 'landing.loading.fun.10', 'landing.loading.fun.11', 'landing.loading.fun.12',
  'landing.loading.fun.13', 'landing.loading.fun.14', 'landing.loading.fun.15', 'landing.loading.fun.16',
  'landing.loading.fun.17', 'landing.loading.fun.18', 'landing.loading.fun.19', 'landing.loading.fun.20',
  'landing.loading.fun.21', 'landing.loading.fun.22', 'landing.loading.fun.23', 'landing.loading.fun.24',
] as const satisfies readonly MessageKey[];

export default function LoadingScreen({
  title,
  message,
  onCancel,
  mode = 'upload',
  estimatedFilms,
  typicalSeconds,
  events,
  posterGame,
  queued,
}: Props) {
  const { t, formatNumber } = useI18n();
  const [elapsed, setElapsed] = useState(0);
  const [funMessageIndex, setFunMessageIndex] = useState(0);
  const isScrape = mode === 'scrape';

  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isScrape) return;
    const interval = setInterval(() => {
      setFunMessageIndex((i) => (i + 1) % FUN_MESSAGE_KEYS.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [isScrape]);

  const defaultTypical = isScrape ? 30 : 45;
  const typical = typicalSeconds ?? defaultTypical;
  const remaining = Math.max(0, typical - elapsed);
  const pct = Math.min(100, Math.round((elapsed / typical) * 100));

  // Live discovery feed from the real scrape trace (films climb as pages load).
  const liveFilms = (events ?? []).reduce((max, e) => {
    const f = e.metrics?.films;
    return typeof f === 'number' && f > max ? f : max;
  }, 0);
  const recentEvents = (events ?? []).filter((e) => e.message).slice(-3);

  const displayTitle = isScrape ? t('landing.loading.scrape.title') : title ?? t('landing.loading.upload.title');
  const displayMessage = isScrape
    ? estimatedFilms && estimatedFilms > 0
      ? t('landing.loading.scrape.readingFilms').replace('{count}', formatNumber(estimatedFilms))
      : t('landing.loading.scrape.readingProfile')
    : message ?? t('landing.loading.upload.message');
  const displayDetail = isScrape
    ? t('landing.loading.elapsed').replace('{time}', formatElapsed(elapsed, t)).replace('{source}', t('landing.loading.source.profiles'))
    : t('landing.loading.elapsed').replace('{time}', formatElapsed(elapsed, t)).replace('{source}', t('landing.loading.source.exports'));

  return (
    <div className="flex min-h-dvh w-full min-w-0 flex-col items-center justify-start overflow-x-hidden overflow-y-auto bg-slate-900 px-4 pt-[var(--mw-top-chrome-reserve)] pb-5 text-white sm:justify-center sm:px-6 sm:pb-8">
      {/* Keep the rotating prompt in one place, above the loading container. */}
      {isScrape && (
        <div className="mb-4 w-full min-w-0 max-w-xl px-1 text-center">
          <p
            key={funMessageIndex}
            className="text-pretty break-words text-lg font-semibold italic leading-snug tracking-tight text-white/80 transition-opacity duration-500 md:text-xl"
          >
            {t(FUN_MESSAGE_KEYS[funMessageIndex])}
          </p>
        </div>
      )}

      <div className="w-full min-w-0 max-w-xl text-center rounded-3xl border border-slate-700/70 bg-slate-800/55 p-5 md:p-6 backdrop-blur-sm">
        <header className="mb-3 flex min-w-0 flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-4 sm:gap-y-1">
          <h1 className="min-w-0 text-balance break-words text-2xl font-black tracking-tight md:text-3xl">
            {displayTitle}
          </h1>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="group inline-flex min-h-9 shrink-0 items-center gap-1.5 self-end rounded-lg border border-white/15 bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white/85 shadow-sm shadow-black/20 transition-all duration-200 hover:border-rose-400/40 hover:bg-rose-500/15 hover:text-white hover:shadow-rose-500/15 active:scale-[0.96] sm:self-start"
            >
              <X className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:rotate-90" />
              <span className="whitespace-nowrap">{t('landing.loading.cancel')}</span>
            </button>
          )}
        </header>
        {!isScrape && <p className="mb-2 min-w-0 text-pretty break-words text-sm text-slate-300">{displayMessage}</p>}

        {/* Live film count — wraps cleanly; number pops on every increase */}
        {isScrape && liveFilms > 0 && (
          <p className="mb-2 flex min-w-0 flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 text-2xl font-black tabular-nums text-orange-300">
            <span key={liveFilms} className="inline-block animate-[score-pop_1.1s_ease-out]">
              {formatNumber(liveFilms)}
            </span>
            <span className="text-sm font-medium text-slate-400">{t('landing.loading.filmsFound')}</span>
          </p>
        )}

        {/* Status — elapsed/almost-there, then trouble hint if it's taking a while */}
        <div className="mb-4 min-w-0 space-y-1">
          {queued ? (
            <p className="text-pretty break-words text-xs leading-relaxed text-amber-300/90 animate-pulse">
              {t('landing.loading.queued')}
            </p>
          ) : (
            <>
              <p className="text-pretty break-words text-xs font-medium leading-relaxed text-orange-300">
                {remaining <= 0 ? t('landing.loading.almostThere') : displayDetail}
              </p>
              {elapsed > typical && (
                <p className="text-pretty break-words text-xs leading-relaxed text-amber-300/90 animate-pulse">
                  {t('landing.loading.slow')}
                </p>
              )}
            </>
          )}
        </div>

        {isScrape && posterGame && (
          <div className="mb-5 min-w-0">
            <PosterGuessGame {...posterGame} />
          </div>
        )}

        {/* Progress + remaining time */}
        <div className="mt-4 min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm font-medium">
            <span className="min-w-0 text-left text-slate-300">{t('landing.loading.typical')}</span>
            <span className="shrink-0 tabular-nums text-slate-200">{formatElapsed(typical, t)}</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-slate-700/80"
            role="progressbar"
            aria-label={t('landing.loading.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className="h-full bg-gradient-to-r from-orange-400 via-amber-300 to-orange-400 transition-all duration-1000"
              style={{ width: `${pct}%` }}
            />
          </div>
          {remaining > 0 && (
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
              <span className="min-w-0 text-left text-slate-500">{t('landing.loading.remaining')}</span>
              <span className="shrink-0 font-medium tabular-nums text-orange-300">{formatElapsed(remaining, t)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
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
  const reduceMotion = Boolean(useReducedMotion());
  const startedAtRef = useRef(typeof performance === 'undefined' ? Date.now() : performance.now());
  const [elapsed, setElapsed] = useState(0);
  const [funMessageIndex, setFunMessageIndex] = useState(0);
  const isScrape = mode === 'scrape';

  useEffect(() => {
    const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
    const updateElapsed = () => setElapsed(Math.floor((now() - startedAtRef.current) / 1000));
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
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
  const isSlow = elapsed > typical;

  // Live discovery feed from the real scrape trace (films climb as pages load).
  const liveFilms = (events ?? []).reduce((max, e) => {
    const f = e.metrics?.films;
    return typeof f === 'number' && f > max ? f : max;
  }, 0);
  const displayTitle = isScrape ? t('landing.loading.scrape.title') : title ?? t('landing.loading.upload.title');
  const displayMessage = isScrape
    ? estimatedFilms && estimatedFilms > 0
      ? t('landing.loading.scrape.readingFilms').replace('{count}', formatNumber(estimatedFilms))
      : t('landing.loading.scrape.readingProfile')
    : message ?? t('landing.loading.upload.message');
  const displayDetail = t('landing.loading.elapsed').replace('{time}', formatElapsed(elapsed, t));

  return (
    <div className="relative flex min-h-dvh w-full min-w-0 flex-col items-center justify-start overflow-x-hidden overflow-y-auto px-4 pt-[var(--mw-top-chrome-reserve)] pb-5 text-white sm:justify-center sm:px-6 sm:pb-8" style={{ backgroundColor: '#1e252d' }}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-20 -left-20 h-72 w-72 rounded-full blur-3xl sm:h-96 sm:w-96" style={{ backgroundColor: 'rgba(63, 188, 243, 0.12)' }} />
        <div className="absolute -bottom-24 -right-20 h-80 w-80 rounded-full blur-3xl sm:h-[28rem] sm:w-[28rem]" style={{ backgroundColor: 'rgba(255, 127, 0, 0.1)' }} />
      </div>

      <div className="relative z-10 flex w-full min-w-0 max-w-xl flex-col items-center">
        {/* Keep the rotating prompt in one place, above the loading container. */}
        {isScrape && (
          <div className="mb-4 w-full min-w-0 px-1 text-center">
            <p
              key={funMessageIndex}
              className="text-pretty break-words text-lg font-semibold italic leading-snug tracking-tight text-white/70 transition-opacity duration-500 md:text-xl"
            >
              {t(FUN_MESSAGE_KEYS[funMessageIndex])}
            </p>
          </div>
        )}

        <div
          className="w-full min-w-0 rounded-2xl p-5 text-center backdrop-blur-sm md:p-6"
          style={{ borderWidth: 1, borderColor: '#1f262e', backgroundColor: 'rgba(27, 28, 30, 0.4)' }}
        >
          <header className="mb-3 flex min-w-0 flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-4 sm:gap-y-1">
            <h1 className="min-w-0 text-balance break-words text-2xl font-black tracking-tight text-white md:text-3xl">
              {displayTitle}
            </h1>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="group inline-flex min-h-11 shrink-0 items-center gap-1.5 self-end rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff8000]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e252d] motion-safe:active:scale-[0.98] sm:self-start"
              >
                <X className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 motion-safe:group-hover:rotate-90" />
                <span className="whitespace-nowrap">{t('landing.loading.cancel')}</span>
              </button>
            )}
          </header>
          {!isScrape && (
            <p className="mb-2 min-w-0 text-pretty break-words text-sm leading-relaxed text-white/55">
              {displayMessage}
            </p>
          )}

          {/* Live film count — wraps cleanly; number pops on every increase */}
          {isScrape && liveFilms > 0 && (
            <p className="mb-2 flex min-w-0 flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 text-2xl font-black tabular-nums text-[#ff8000]">
              <span key={liveFilms} className="inline-block motion-safe:animate-[score-pop_1.1s_ease-out]">
                {formatNumber(liveFilms)}
              </span>
              <span className="text-sm font-medium text-white/45">{t('landing.loading.filmsFound')}</span>
            </p>
          )}

          {/* Status — elapsed/almost-there, then trouble hint if it's taking a while */}
          <div className="mb-4 min-w-0 space-y-1">
            {queued ? (
              <p className="text-pretty break-words text-xs leading-relaxed text-[#ff8000]/90 motion-safe:animate-pulse">
                {t('landing.loading.queued')}
              </p>
            ) : (
              <>
                {isSlow && (
                  <p className="text-pretty break-words text-xs leading-relaxed text-white/50">
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

          {/* Indeterminate: the client does not receive upload/analyze stage progress. */}
          <div className="mt-5 min-w-0 space-y-2">
            <div
              className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
              role="progressbar"
              aria-label={t('landing.loading.progress')}
            >
              {reduceMotion ? (
                <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-[#ff8000]" aria-hidden="true" />
              ) : (
                <motion.div
                  className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-[#ff8000]"
                  initial={{ x: '-100%' }}
                  animate={{ x: ['-100%', '300%'] }}
                  transition={{ duration: 2.2, ease: 'easeInOut', repeat: Infinity }}
                  aria-hidden="true"
                />
              )}
            </div>
            {!queued && (
              <div className="text-xs font-medium tabular-nums text-white/45">{displayDetail}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

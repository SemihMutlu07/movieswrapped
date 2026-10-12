'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ScrapeStoryWait from '@/components/landing/ScrapeStoryWait';
import { importScrape, type ScrapeProgress } from '@/lib/api';
import { trackEvent, trackConsentedEvent, trackFilmStats } from '@/lib/analytics';
import { bookmarkletHref } from '@/lib/letterboxdBookmarklet';
import {
  isTrustedImportOrigin,
  parseBookmarkletMessage,
  parseBookmarkletPayload,
  type BookmarkletPayload,
} from '@/lib/letterboxdImport';
import { normalizeError, type NormalizedError } from '@/lib/errors';
import { persistStats } from '@/lib/stats-storage';
import { ensureSessionId, getConsent, setUsername } from '@/lib/session-id';
import { storyPath } from '@/lib/routes';
import {
  buildSummaryForPersistence,
  finishAnalysis,
  startAnalysis,
} from '@/lib/supabase/analysis_runs';
import { upsertUserSession } from '@/lib/supabase/sessions';
import { useI18n } from '@/i18n/I18nProvider';

export default function ImportLetterboxdPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [payload, setPayload] = useState<BookmarkletPayload | null>(null);
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<NormalizedError | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [resultReady, setResultReady] = useState(false);
  const [progress, setProgress] = useState<ScrapeProgress | null>(null);
  const origin = typeof window === 'undefined' ? 'https://movieswrapped.com' : window.location.origin;
  const href = useMemo(() => bookmarkletHref(origin), [origin]);
  const abortRef = useRef<AbortController | null>(null);
  const storyDestinationRef = useRef<string | null>(null);

  const applyPayload = useCallback((next: BookmarkletPayload) => {
    setPayload(next);
    setError(null);
    if (typeof window !== 'undefined') {
      window.opener?.postMessage('mw-ack', '*');
    }
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedImportOrigin(event.origin, window.location.origin)) return;
      const parsed = parseBookmarkletMessage(event.data);
      if (!parsed) return;
      event.source?.postMessage('mw-ack', { targetOrigin: event.origin });
      applyPayload(parsed);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [applyPayload]);

  const handlePaste = useCallback(() => {
    try {
      const parsed = parseBookmarkletPayload(JSON.parse(paste));
      if (!parsed) {
        setError({
          title: t('import.invalidJson.title'),
          message: t('import.invalidJson.message'),
          reason: 'unknown_error',
        });
        return;
      }
      applyPayload(parsed);
    } catch {
      setError({
        title: t('import.invalidJson.title'),
        message: t('import.invalidJson.message'),
        reason: 'unknown_error',
      });
    }
  }, [applyPayload, paste, t]);

  const runImport = useCallback(async (data: BookmarkletPayload) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setResultReady(false);
    setProgress(null);
    setError(null);
    const destination = storyPath(data.user, locale);
    storyDestinationRef.current = destination;
    router.prefetch(destination);
    trackEvent('scrape_started', { method: 'bookmarklet' });
    const startedAt = performance.now();
    const sessionId = ensureSessionId();
    const hasPersistenceConsent = getConsent() === 'accept';
    let analysisRun: { id: string } | null = null;
    try {
      if (hasPersistenceConsent) {
        try {
          analysisRun = await startAnalysis({
            id: crypto?.randomUUID?.(),
            session_id: sessionId,
            username: data.user,
          });
        } catch {
          /* analytics failure is non-fatal */
        }
      }
      const result = await importScrape(
        { user: data.user, films: data.films, diary: data.diary },
        controller.signal,
        (p) => setProgress(p),
      );
      const durationMs = Math.round(performance.now() - startedAt);
      setUsername(data.user);
      persistStats(result.stats);
      const films = Number(result.stats.scraped_film_count ?? result.stats.total_films ?? data.films.length);
      const diary = Number(result.stats.scraped_diary_count ?? data.diary.length);
      trackEvent('scrape_done', {
        duration_ms: durationMs,
        films,
        diary,
        queue_wait_ms: Number(result.queue_wait_ms ?? 0),
        method: 'bookmarklet',
      });
      trackConsentedEvent('analyze_succeeded', {
        total_films: result.stats.total_films,
        duration_ms: durationMs,
        method: 'bookmarklet',
      });
      trackFilmStats({
        total_films: result.stats.total_films,
        total_countries: result.stats.total_countries,
        average_rating: result.stats.average_rating,
      });
      if (analysisRun) {
        void (async () => {
          try {
            await finishAnalysis({
              id: analysisRun.id,
              ok: true,
              task_id: result.task_id ?? null,
              summary: buildSummaryForPersistence(result.stats as Record<string, unknown>),
            });
            await upsertUserSession({
              session_id: sessionId,
              username: data.user,
              consent: 'accept',
              film_count: result.stats.total_films || null,
              favorite_genre: result.stats.favorite_genre?.name || null,
            });
          } catch {
            /* analytics failure is non-fatal */
          }
        })();
      }
      setResultReady(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      const normalized = normalizeError(err);
      trackEvent('scrape_failed', { reason: normalized.reason, method: 'bookmarklet' });
      if (analysisRun) {
        try {
          await finishAnalysis({
            id: analysisRun.id,
            ok: false,
            error_message: normalized.message,
            error_code: normalized.reason,
          });
        } catch {
          /* silent */
        }
      }
      setError(normalized);
      setIsRunning(false);
    }
  }, [locale, router]);

  const handleStoryReady = useCallback(() => {
    const destination = storyDestinationRef.current;
    if (!destination) return;
    router.push(destination);
  }, [router]);

  if (isRunning && payload) {
    return (
      <ScrapeStoryWait
        username={payload.user}
        onCancel={() => {
          abortRef.current?.abort();
          setIsRunning(false);
        }}
        events={progress?.trace_events}
        resultReady={resultReady}
        onStoryReady={handleStoryReady}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#1e252d] px-4 py-10 text-white">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-sm text-white/50">
            <Link href={`/${locale}`} className="underline decoration-white/20 hover:text-white">
              {t('nav.backHome')}
            </Link>
          </p>
          <h1 className="text-3xl font-black tracking-tight">{t('import.title')}</h1>
          <p className="text-sm leading-relaxed text-white/60">{t('import.subtitle')}</p>
        </header>

        <section className="rounded-2xl border border-white/8 bg-black/20 p-5 space-y-3">
          <h2 className="text-lg font-semibold">{t('import.bookmarklet.title')}</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-white/70">
            <li>{t('import.bookmarklet.step1')}</li>
            <li>{t('import.bookmarklet.step2')}</li>
            <li>{t('import.bookmarklet.step3')}</li>
          </ol>
          <a
            href={href}
            className="inline-flex rounded-xl bg-[#ff7f00] px-4 py-2 text-sm font-semibold text-[#1b1c1e]"
          >
            {t('import.bookmarklet.drag')}
          </a>
        </section>

        {payload ? (
          <section className="rounded-2xl border border-white/8 bg-black/20 p-5 space-y-3">
            <p className="text-sm text-white/70">
              {t('import.received', { user: payload.user, films: payload.films.length, diary: payload.diary.length })}
            </p>
            <button
              type="button"
              onClick={() => void runImport(payload)}
              className="rounded-xl bg-[#ff7f00] px-4 py-2 text-sm font-semibold text-[#1b1c1e]"
            >
              {t('import.analyze')}
            </button>
          </section>
        ) : (
          <p className="text-center text-sm text-white/45">{t('import.waiting')}</p>
        )}

        <section className="rounded-2xl border border-white/8 bg-black/20 p-5 space-y-3">
          <label className="block text-sm font-semibold" htmlFor="import-json">
            {t('import.pasteLabel')}
          </label>
          <textarea
            id="import-json"
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            placeholder={t('import.pastePlaceholder')}
            className="h-32 w-full rounded-xl border border-white/10 bg-[#1a1a1a] p-3 text-sm text-white placeholder:text-white/30"
          />
          <button
            type="button"
            onClick={handlePaste}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white"
          >
            {t('import.submitPaste')}
          </button>
        </section>

        {error ? (
          <p className="rounded-xl border border-orange-400/40 bg-orange-400/10 p-3 text-sm text-orange-200">
            {error.title}. {error.message}
          </p>
        ) : null}
      </div>
    </main>
  );
}

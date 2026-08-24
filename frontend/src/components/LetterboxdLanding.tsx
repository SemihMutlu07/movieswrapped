'use client';

import JSZip from 'jszip';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, Users, X, UserRound, Sparkles, PartyPopper, ChevronDown } from 'lucide-react';
import {
  analyzeFiles,
  parseLetterboxdUsername,
  scrapeProfile,
  testBackend,
  type ScrapeProgress,
  isWorkerFleetEmpty,
} from '@/lib/api';
import { ERROR_CODE_HINTS } from '@/lib/api';
import { persistStats } from '@/lib/stats-storage';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { startAnalysis, finishAnalysis, buildSummaryForPersistence } from '@/lib/supabase/analysis_runs';
import { upsertUserSession } from '@/lib/supabase/sessions';
import { ensureSessionId, getUsername, setUsername, getConsent } from '@/lib/session-id';
import { storyPath } from '@/lib/routes';
import { trackEvent, trackConsentedEvent, trackFilmStats } from '@/lib/analytics';
import { normalizeError, needsZipFallback, type NormalizedError } from '@/lib/errors';
import { useI18n } from '@/i18n/I18nProvider';
import { localizePath } from '@/i18n/routing';
import { FAQ_ITEMS } from '@/i18n/faq';
import ErrorBanner from '@/components/ErrorBanner';
import LoadingScreen from '@/components/landing/LoadingScreen';
import ScrapeStoryWait from '@/components/landing/ScrapeStoryWait';
import UploadZone from '@/components/landing/UploadZone';
import ExportInstructions from '@/components/landing/ExportInstructions';
import { POSTER_GAME_MOVIES, type PosterGameMovie } from '@/lib/posterGameData';

const POSTER_GAME_MAX_LEVEL = 5;
// Points for a correct guess, indexed by how many wrong guesses/hints were used first.
const POSTER_ROUND_POINTS = [100, 80, 60, 40, 20];

const USERNAME_PLACEHOLDER_EXAMPLES = [
  'semihmutsuz',
  'watchthemengo',
  'denisvilleneuve',
  'meryl_streep',
  'quentintarantino',
  'timothee_chalamet',
  'christophernolan',
  'zendaya',
];

function useTypewriterPlaceholder(examples: string[], active: boolean): string {
  const [placeholder, setPlaceholder] = useState(examples[0] ?? '');

  useEffect(() => {
    if (!active || examples.length === 0) return;

    let wordIndex = 0;
    let charIndex = 0;
    let deleting = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
      const word = examples[wordIndex];
      if (!deleting) {
        charIndex += 1;
        setPlaceholder(word.slice(0, charIndex));
        if (charIndex === word.length) {
          deleting = true;
          timeoutId = setTimeout(tick, 1400);
          return;
        }
        timeoutId = setTimeout(tick, 90);
      } else {
        charIndex -= 1;
        setPlaceholder(word.slice(0, charIndex));
        if (charIndex === 0) {
          deleting = false;
          wordIndex = (wordIndex + 1) % examples.length;
          timeoutId = setTimeout(tick, 400);
          return;
        }
        timeoutId = setTimeout(tick, 40);
      }
    };

    timeoutId = setTimeout(tick, 90);
    return () => clearTimeout(timeoutId);
  }, [active, examples]);

  return active ? placeholder : (examples[0] ?? '');
}

function drawShuffledMovie(deckRef: React.MutableRefObject<PosterGameMovie[]>, indexRef: React.MutableRefObject<number>): PosterGameMovie {
  if (indexRef.current >= deckRef.current.length) {
    const shuffled = [...POSTER_GAME_MOVIES];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    deckRef.current = shuffled;
    indexRef.current = 0;
  }
  const movie = deckRef.current[indexRef.current];
  indexRef.current += 1;
  return movie;
}

function localizeLandingError(error: NormalizedError, t: (key: import('@/i18n/catalogs').MessageKey) => string): NormalizedError {
  if (error.title === 'prepare_folder') {
    return {
      ...error,
      title: t('landing.error.prepareFolder.title'),
      message: t('landing.error.prepareFolder.message'),
      action: t('landing.error.prepareFolder.action'),
    };
  }
  if (error.title === 'prepare_files') {
    return {
      ...error,
      title: t('landing.error.prepareFiles.title'),
      message: t('landing.error.prepareFiles.message'),
      action: t('landing.error.prepareFiles.action'),
    };
  }
  const messages = {
    no_files_selected: ['landing.error.noFiles.title', 'landing.error.noFiles.message'],
    file_too_large: ['landing.error.fileTooLarge.title', 'landing.error.fileTooLarge.message', 'landing.error.fileTooLarge.action'],
    invalid_file_type: ['landing.error.invalidFile.title', 'landing.error.invalidFile.message'],
    no_csv_files: ['landing.error.noCsv.title', 'landing.error.noCsv.message', 'landing.error.noCsv.action'],
    corrupt_zip: ['landing.error.corruptZip.title', 'landing.error.corruptZip.message'],
    missing_required_files: ['landing.error.missingFiles.title', 'landing.error.missingFiles.message', 'landing.error.missingFiles.action'],
    backend_unreachable: ['landing.error.backendUnreachable.title', 'landing.error.backendUnreachable.message', 'landing.error.backendUnreachable.action'],
    tmdb_timeout: ['landing.error.tmdbTimeout.title', 'landing.error.tmdbTimeout.message', 'landing.error.tmdbTimeout.action'],
    tmdb_rate_limited: ['landing.error.rateLimited.title', 'landing.error.rateLimited.message', 'landing.error.rateLimited.action'],
    no_username: ['landing.error.noUsername.title', 'landing.error.noUsername.message'],
    invalid_username: ['landing.error.invalidUsername.title', 'landing.error.invalidUsername.message'],
    invalid_analysis_period: ['landing.error.invalidPeriod.title', 'landing.error.invalidPeriod.message', 'landing.error.invalidPeriod.action'],
    no_films: ['landing.error.noFilms.title', 'landing.error.noFilms.message', 'landing.error.noFilms.action'],
    no_films_in_period: ['landing.error.noFilmsPeriod.title', 'landing.error.noFilmsPeriod.message', 'landing.error.noFilmsPeriod.action'],
    user_not_found: ['landing.error.userNotFound.title', 'landing.error.userNotFound.message', 'landing.error.userNotFound.action'],
    scrape_failed: ['landing.error.scrapeFailed.title', 'landing.error.scrapeFailed.message', 'landing.error.scrapeFailed.action'],
    scrape_blocked: ['landing.error.scrapeBlocked.title', 'landing.error.scrapeBlocked.message', 'landing.error.scrapeBlocked.action'],
    scraper_unavailable: ['landing.error.scraperUnavailable.title', 'landing.error.scraperUnavailable.message', 'landing.error.scraperUnavailable.action'],
    queue_full: ['landing.error.queueFull.title', 'landing.error.queueFull.message', 'landing.error.queueFull.action'],
    desktop_worker_offline: ['landing.error.desktopOffline.title', 'landing.error.desktopOffline.message', 'landing.error.desktopOffline.action'],
    desktop_worker_paused: ['landing.error.desktopPaused.title', 'landing.error.desktopPaused.message', 'landing.error.desktopPaused.action'],
    stats_too_large: ['landing.error.statsTooLarge.title', 'landing.error.statsTooLarge.message', 'landing.error.statsTooLarge.action'],
  } as const;
  const copy = messages[error.reason as keyof typeof messages];
  if (!copy) {
    return {
      ...error,
      title: t('landing.error.unknown.title'),
      message: error.message || t('landing.error.unknown.message'),
      action: error.action || t('landing.error.unknown.action'),
    };
  }
  return { ...error, title: t(copy[0]), message: t(copy[1]), action: copy[2] ? t(copy[2]) : undefined };
}

export default function LetterboxdLanding() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [isUploading, setIsUploading] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress | null>(null);
  // Degraded mode: the desktop worker fleet is empty, so a scrape is queued
  // and may take much longer than usual. Non-fatal — just informs the UI.
  const [workerQueued, setWorkerQueued] = useState(false);
  // Pixelated poster guessing game, shown while scraping.
  const [posterRound, setPosterRound] = useState<PosterGameMovie | null>(null);
  const [posterLevel, setPosterLevel] = useState(0);
  const [posterScore, setPosterScore] = useState(0);
  const [posterWrongGuesses, setPosterWrongGuesses] = useState(0);
  const [posterRevealed, setPosterRevealed] = useState(false);
  const [posterRoundsPlayed, setPosterRoundsPlayed] = useState(0);
  const shuffledDeckRef = useRef<PosterGameMovie[]>([]);
  const deckIndexRef = useRef(0);
  const scrapeAbortRef = useRef<AbortController | null>(null);
  // Story route to navigate to once the scrape wait machine settles READY → STORY.
  const storyDestinationRef = useRef<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameFocused, setUsernameFocused] = useState(false);
  const usernamePlaceholder = useTypewriterPlaceholder(USERNAME_PLACEHOLDER_EXAMPLES, !usernameFocused && usernameInput.length === 0);
  const [error, setError] = useState<NormalizedError | null>(null);
  const [backendOffline, setBackendOffline] = useState(false);
  const [, setDetectedUsername] = useState<string | null>(null);

  // Track initial session on page load
  useEffect(() => {
    const trackInitialSession = async () => {
      try {
        let sessionId = sessionStorage.getItem('session_id');
        if (!sessionId) {
          sessionId = crypto?.randomUUID?.() ?? `session_${Date.now()}`;
          sessionStorage.setItem('session_id', sessionId);
        }
      } catch {
        // silent
      }
    };
    trackInitialSession();
  }, []);

  // Test backend connectivity on component mount
  useEffect(() => {
    const testBackendConnectivity = async () => {
      try {
        await testBackend();
        setBackendOffline(false);
        trackEvent('app_opened');
      } catch {
        setBackendOffline(true);
        trackEvent('app_opened', { backend_offline: true });
      }
    };
    testBackendConnectivity();
  }, []);

  useBodyScrollLock(showUploadModal);

  // ESC closes the upload modal
  useEffect(() => {
    if (!showUploadModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowUploadModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [showUploadModal]);

  const drawNextRound = useCallback(() => {
    const movie = drawShuffledMovie(shuffledDeckRef, deckIndexRef);
    setPosterLevel(0);
    setPosterWrongGuesses(0);
    setPosterRevealed(false);
    setPosterRound(movie);
  }, []);

  // Poster-guess is not part of the scrape wait story; it stays unused here so
  // the wait path does not download the game deck.

  const handleWrongGuess = useCallback(() => {
    setPosterWrongGuesses((prev) => prev + 1);
    setPosterLevel((prev) => {
      const next = Math.min(prev + 1, POSTER_GAME_MAX_LEVEL);
      if (next >= POSTER_GAME_MAX_LEVEL) {
        setPosterRevealed(true);
        setPosterRoundsPlayed((prev) => prev + 1);
        setTimeout(() => drawNextRound(), 2000);
      }
      return next;
    });
  }, [drawNextRound]);

  const handleCorrectGuess = useCallback(() => {
    const points = POSTER_ROUND_POINTS[Math.min(posterWrongGuesses, POSTER_ROUND_POINTS.length - 1)];
    setPosterScore((prev) => prev + points);
    setPosterRoundsPlayed((prev) => prev + 1);
    setPosterRevealed(true);
    setTimeout(() => drawNextRound(), 1200);
  }, [drawNextRound, posterWrongGuesses]);

  // Only attach poster-game stats when the user actually played a round.
  const withPosterGameStats = useCallback(
    (stats: object) =>
      posterRoundsPlayed > 0
        ? { ...stats, poster_game_score: posterScore, poster_game_rounds: posterRoundsPlayed }
        : stats,
    [posterRoundsPlayed, posterScore]
  );

  const zipFiles = useCallback(async (files: FileList | File[]): Promise<File> => {
    const zip = new JSZip();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath?.length
        ? (f as File & { webkitRelativePath?: string }).webkitRelativePath!
        : f.name;
      zip.file(rel, f);
    }
    const content = await zip.generateAsync({ type: 'blob' });
    return new File([content], 'letterboxd-export.zip', { type: 'application/zip' });
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) {
      setError({ title: 'No files selected', message: 'Please choose your Letterboxd export files.', reason: 'no_files_selected' });
      trackEvent('analyze_failed', { reason: 'no_files_selected', step: 'validation' });
      return;
    }

    const isFolderUpload = Array.from(files).some(
      (f) => !!(f as File & { webkitRelativePath?: string }).webkitRelativePath,
    );

    const maxFileSize = 50 * 1024 * 1024;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (isFolderUpload && !/\.csv$/i.test(file.name)) continue;
      if (file.size > maxFileSize) {
        const sizeMb = (file.size / 1024 / 1024).toFixed(1);
        setError({ title: 'File too large', message: `"${file.name}" is ${sizeMb} MB. Maximum size is 50 MB.`, action: 'Try exporting a smaller date range or compressing the file.', reason: 'file_too_large' });
        trackEvent('analyze_failed', { reason: 'file_too_large', step: 'validation' });
        return;
      }
      const hasValidExtension = ['.csv', '.zip'].some((ext) => file.name.toLowerCase().endsWith(ext));
      if (!hasValidExtension) {
        setError({ title: 'Unsupported file', message: `"${file.name}" is not a supported format. Please upload .csv or .zip files only.`, reason: 'invalid_file_type' });
        trackEvent('analyze_failed', { reason: 'invalid_extension', step: 'validation' });
        return;
      }
    }

    // Show loading immediately so the user knows the drop registered.
    // Anything async (Supabase upsert, network calls) happens after this.
    setIsUploading(true);
    setError(null);
    trackEvent('analyze_started', { fileCount: files.length, method: 'upload' });

    // Detect username
    let detectedUsername: string | null = null;
    for (let i = 0; i < files.length; i++) {
      const file = files[i] as File & { webkitRelativePath?: string };
      const relativePath = file.webkitRelativePath || '';
      const pathParts = relativePath ? relativePath.split('/').filter(Boolean) : [];
      for (const candidate of [file.name, relativePath, pathParts[0] || '']) {
        if (!candidate) continue;
        const { username: parsed } = await parseLetterboxdUsername(candidate);
        if (parsed) { detectedUsername = parsed; break; }
      }
      if (detectedUsername) break;
    }

    const hasPersistenceConsent = getConsent() === 'accept';

    if (detectedUsername) {
      setDetectedUsername(detectedUsername);
      setUsername(detectedUsername);
      if (hasPersistenceConsent) {
        // Fire-and-forget — Supabase analytics shouldn't block the upload UI.
        try {
          await upsertUserSession({ session_id: ensureSessionId(), username: detectedUsername, consent: 'accept', film_count: null, favorite_genre: null });
        } catch (err) {
          console.warn('[supabase] session upsert failed (non-blocking):', err);
        }
      }
    }

    let uploadFiles: File[] = [];
    const single = files.length === 1 ? files[0] : null;
    const isZip = single && /\.zip$/i.test(single.name);

    if (isZip && single) {
      uploadFiles = [single];
    } else if (isFolderUpload) {
      const csvFiles = Array.from(files).filter((f) => /\.csv$/i.test(f.name));
      if (csvFiles.length === 0) {
        setError({ title: 'No CSV files found', message: 'The selected folder contains no Letterboxd CSV files.', action: 'Make sure you selected the extracted Letterboxd export folder.', reason: 'no_csv_files' });
        setIsUploading(false);
        trackEvent('analyze_failed', { reason: 'no_csv_in_folder', step: 'preparation' });
        return;
      }
      try {
        uploadFiles = [await zipFiles(csvFiles)];
      } catch (err) {
        console.error('[upload] folder zip packaging failed:', err);
        setError({ title: 'prepare_folder', message: '', reason: 'unknown_error' });
        setIsUploading(false);
        trackEvent('analyze_failed', { reason: 'zip_pack_failed', step: 'preparation' });
        return;
      }
    } else if (files.length === 1) {
      uploadFiles = [files[0]];
    } else if (Array.from(files).every((f) => /\.csv$/i.test(f.name))) {
      uploadFiles = Array.from(files);
    } else {
      try {
        uploadFiles = [await zipFiles(files)];
      } catch (err) {
        console.error('[upload] file zip packaging failed:', err);
        setError({ title: 'prepare_files', message: '', reason: 'unknown_error' });
        setIsUploading(false);
        trackEvent('analyze_failed', { reason: 'zip_pack_failed', step: 'preparation' });
        return;
      }
    }

    const formData = new FormData();
    uploadFiles.forEach((file) => formData.append('files', file));

    const sessionId = ensureSessionId();
    const username = getUsername();
    let analysisRun: { id: string } | null = null;
    let startedAt = 0;

    try {
      if (hasPersistenceConsent && username) {
        try {
          const runId = crypto?.randomUUID?.();
          analysisRun = await startAnalysis({ id: runId, session_id: sessionId, username });
        } catch { /* analytics failure is non-fatal */ }
      }

      startedAt = performance.now();
      trackEvent('analyze_started', { hasZip: !!isZip, fileCount: files.length, method: 'upload' });

      const result = await analyzeFiles(formData);
      const durationMs = performance.now() - startedAt;

      if (detectedUsername) setUsername(detectedUsername);
      // Per-tab storage avoids the cross-tab race where a concurrent scrape's
      // result overwrites this tab's data on a shared localStorage key.
      persistStats(withPosterGameStats(result.stats));

      trackConsentedEvent('analyze_succeeded', { total_films: result.stats.total_films, duration_ms: Math.round(durationMs) });
      trackFilmStats({ total_films: result.stats.total_films, total_countries: result.stats.total_countries, average_rating: result.stats.average_rating });

      if (analysisRun && detectedUsername) {
        void (async () => {
          try {
            await finishAnalysis({ id: analysisRun.id, ok: true, task_id: result.task_id ?? null, summary: buildSummaryForPersistence(result.stats as Record<string, unknown>) });
            await upsertUserSession({
              session_id: sessionId,
              username: detectedUsername,
              consent: 'accept',
              film_count: result.stats.total_films || null,
              favorite_genre: result.stats.favorite_genre?.name || null,
            });
          } catch { /* analytics failure is non-fatal */ }
        })();
      }

      router.push(storyPath(detectedUsername, locale));
    } catch (err) {
      console.error('[upload] analysis failed:', err);
      const normalized = normalizeError(err);
      if (analysisRun && detectedUsername) {
        try { await finishAnalysis({ id: analysisRun.id, ok: false, error_message: normalized.message, error_code: normalized.reason }); } catch { /* silent */ }
      }
      trackEvent('analyze_failed', { reason: normalized.reason, duration_ms: startedAt > 0 ? Math.round(performance.now() - startedAt) : 0 });
      setError(normalized);
      setIsUploading(false);
    }
  }, [locale, router, zipFiles]);

  const handleScrape = useCallback(async () => {
    let raw = usernameInput.trim();

    // Extract username if a full Letterboxd URL was pasted
    const urlMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?letterboxd\.com\/([a-zA-Z0-9_]+)/);
    if (urlMatch) {
      raw = urlMatch[1];
    }

    const username = raw.replace(/^@/, '').toLowerCase();
    if (!username) {
      setError({ title: 'No username', message: 'Please enter your Letterboxd username.', reason: 'no_username' });
      return;
    }
    if (!/^[a-z0-9_]+$/.test(username)) {
      setError({ title: 'Invalid username', message: 'Letterboxd usernames can only contain lowercase letters, numbers, and underscores. You can also paste your full Letterboxd profile URL.', reason: 'invalid_username' });
      return;
    }

    setIsScraping(true);
    setScrapeProgress(null);
    setWorkerQueued(false);
    // Degraded-mode probe: if no desktop worker is online the scrape is queued
    // and may take much longer. Best-effort — endpoint failure keeps the
    // normal loading screen (no error shown).
    isWorkerFleetEmpty().then((empty) => {
      if (empty) setWorkerQueued(true);
    }).catch(() => { /* non-fatal */ });
    setPosterRound(null);
    setPosterLevel(0);
    setPosterScore(0);
    setPosterWrongGuesses(0);
    setPosterRevealed(false);
    shuffledDeckRef.current = [];
    deckIndexRef.current = 0;
    setError(null);
    trackEvent('analyze_started', { username, method: 'scrape', analysis_period: 'lifetime' });
    const destination = storyPath(username, locale);
    storyDestinationRef.current = destination;
    router.prefetch(destination);

    scrapeAbortRef.current?.abort();
    const scrapeAbort = new AbortController();
    scrapeAbortRef.current = scrapeAbort;

    const sessionId = ensureSessionId();
    const hasPersistenceConsent = getConsent() === 'accept';
    let analysisRun: { id: string } | null = null;
    let startedAt = 0;
    try {
      if (hasPersistenceConsent) {
        try {
          const runId = crypto?.randomUUID?.();
          analysisRun = await startAnalysis({ id: runId, session_id: sessionId, username });
        } catch { /* analytics failure is non-fatal */ }
      }

      startedAt = performance.now();
      // The desktop worker scrapes the full profile from a residential IP.
      const method = 'scrape' as const;
      const result = await scrapeProfile(username, 'lifetime', scrapeAbort.signal, setScrapeProgress);
      if (scrapeAbort.signal.aborted) return;
      const returnedUsername = (result.stats as { scraped_username?: string })?.scraped_username;
      if (returnedUsername && returnedUsername !== username) {
        throw new Error(`Username mismatch: requested @${username}, got @${returnedUsername}`);
      }
      setUsername(username);
      persistStats(withPosterGameStats(result.stats));

      trackConsentedEvent('analyze_succeeded', { total_films: result.stats.total_films, method });

      if (analysisRun) {
        void (async () => {
          try {
            await finishAnalysis({ id: analysisRun.id, ok: true, task_id: result.task_id ?? null, summary: buildSummaryForPersistence(result.stats as Record<string, unknown>) });
            await upsertUserSession({
              session_id: sessionId,
              username,
              consent: 'accept',
              film_count: result.stats.total_films || null,
              favorite_genre: result.stats.favorite_genre?.name || null,
            });
          } catch { /* analytics failure is non-fatal */ }
        })();
      }

      // Navigation is deferred: ScrapeStoryWait fires onStoryReady when the
      // machine settles READY → STORY, so the story opens after its settle dwell.
    } catch (err) {
      if ((err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError')) {
        return;
      }
      console.error('[scrape] analysis failed:', err);
      const normalized = normalizeError(err);
      if (analysisRun) {
        try { await finishAnalysis({ id: analysisRun.id, ok: false, error_message: normalized.message, error_code: normalized.reason }); } catch { /* silent */ }
      }
      trackEvent('analyze_failed', { reason: normalized.reason, duration_ms: startedAt > 0 ? Math.round(performance.now() - startedAt) : 0, method: 'scrape' });
      setError(normalized);
      setIsScraping(false);

      // Surface a single, structured diagnostics line in the console so any user
      // (or agent reading the console later) immediately sees why the scraper failed.
      if (err instanceof Error && 'code' in err) {
        console.error('[scrape] failure diagnostics:', {
          username,
          reason: normalized.reason,
          error_code: (err as { code?: string }).code,
          hint: ERROR_CODE_HINTS[(err as { code?: string }).code ?? ''] ?? 'No hint available for this code',
          message: err.message,
          action: normalized.action,
        });
      }
    }
  }, [locale, router, usernameInput]);

  // STORY handoff: fired exactly once by ScrapeStoryWait when READY settles.
  const handleStoryReady = useCallback(() => {
    const destination = storyDestinationRef.current;
    if (!destination) return;
    storyDestinationRef.current = null;
    router.push(destination);
  }, [router]);

  const handleCancel = useCallback(() => {
    scrapeAbortRef.current?.abort();
    scrapeAbortRef.current = null;
    storyDestinationRef.current = null;
    setIsUploading(false);
    setIsScraping(false);
    setScrapeProgress(null);
    setWorkerQueued(false);
    setPosterRound(null);
    setPosterLevel(0);
    setPosterScore(0);
    setPosterWrongGuesses(0);
    setPosterRevealed(false);
    shuffledDeckRef.current = [];
    deckIndexRef.current = 0;
    setError(null);
  }, []);

  const translatedError = error ? localizeLandingError(error, t) : null;

  if (isUploading) return <LoadingScreen onCancel={handleCancel} typicalSeconds={45} />;
  if (isScraping) {
    return (
      <ScrapeStoryWait
        username={getUsername() || usernameInput}
        onCancel={handleCancel}
        queued={workerQueued}
        events={scrapeProgress?.trace_events}
        onStoryReady={handleStoryReady}
      />
    );
  }

  return (
    <div className="relative min-h-screen text-white" style={{ backgroundColor: '#1e252d' }}>
      <style>{`
        @keyframes watchlist-pulse {
          0%, 100% {
            box-shadow: 0 0 8px 0 rgba(255, 127, 0, 0.15);
            border-color: rgba(255, 255, 255, 0.2);
          }
          50% {
            box-shadow: 0 0 20px 4px rgba(255, 127, 0, 0.30);
            border-color: rgba(255, 127, 0, 0.5);
          }
        }
        .watchlist-glow {
          animation: watchlist-pulse 2.5s ease-in-out infinite;
        }
      `}</style>
      {/* Decorative background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -left-20 h-72 w-72 sm:h-96 sm:w-96 rounded-full blur-3xl" style={{ backgroundColor: 'rgba(63, 188, 243, 0.15)' }} />
        <div className="absolute -bottom-24 -right-20 h-80 w-80 sm:h-[28rem] sm:w-[28rem] rounded-full blur-3xl" style={{ backgroundColor: 'rgba(255, 127, 0, 0.15)' }} />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center px-4 py-8 sm:py-10">
        <div className="space-y-7">
          {/* Hero */}
          <header className="text-center">
            <h1 className="font-black tracking-tight leading-[0.95] text-[clamp(28px,6vw,48px)] text-white">
              Movies Wrapped
            </h1>
            <p className="mx-auto mt-3 text-base sm:text-lg leading-relaxed text-white/80">{t('landing.hero.tagline')}</p>
          </header>

          {/* Username — primary CTA */}
          <section aria-label={t('landing.username.section')}>
            <div className="mx-auto max-w-lg rounded-2xl p-5 sm:p-6 text-center backdrop-blur-sm" style={{ borderWidth: 1, borderColor: '#1f262e', backgroundColor: 'rgba(27, 28, 30, 0.4)' }}>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">{t('landing.username.title')}</h2>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleScrape();
                }}
                className="mx-auto mt-5 max-w-md space-y-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row">
                  <label className="relative flex-1">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-white/40">@</span>
                    <input
                      type="text"
                      name="username"
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      onFocus={() => setUsernameFocused(true)}
                      onBlur={() => setUsernameFocused(false)}
                      placeholder={usernamePlaceholder}
                      autoFocus
                      autoComplete="username"
                      spellCheck={false}
                      className="w-full rounded-xl py-3 pl-9 pr-4 text-base font-semibold text-white placeholder:text-white/40 placeholder:font-normal focus:outline-none transition-shadow"
                      style={{ borderWidth: 1, borderColor: 'rgba(255, 127, 0, 0.4)', backgroundColor: 'rgba(30, 37, 45, 0.7)', boxShadow: usernameFocused ? '0 0 0 2px rgba(255, 127, 0, 0.6)' : undefined }}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!usernameInput.trim()}
                    className="rounded-xl px-6 py-3 text-base font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed"
                    style={usernameInput.trim()
                      ? { backgroundColor: '#ff7f00', color: '#1b1c1e' }
                      : { backgroundColor: '#1f262e', color: 'rgba(255,255,255,0.4)' }}
                  >
                    {t('landing.username.analyze')} →
                  </button>
                </div>
              </form>

            </div>

            {translatedError && (
              <div className="mx-auto mt-4 max-w-lg">
                <ErrorBanner
                  error={translatedError}
                  onDismiss={() => setError(null)}
                  onRetry={needsZipFallback(translatedError.reason) ? undefined : () => setError(null)}
                  onUpload={
                    needsZipFallback(translatedError.reason)
                      ? () => {
                          setShowUploadModal(true);
                          trackEvent('upload_modal_opened', { source: 'scrape_error' });
                        }
                      : undefined
                  }
                />
              </div>
            )}

            {/* Secondary: upload export */}
            <div className="mt-4 grid gap-2 sm:flex sm:justify-center">
              <button
                type="button"
                onClick={() => {
                  setShowUploadModal(true);
                  if (!translatedError || !needsZipFallback(translatedError.reason)) {
                    setError(null);
                  }
                  trackEvent('upload_modal_opened');
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium transition active:scale-[0.98] sm:w-auto"
                style={
                  translatedError && needsZipFallback(translatedError.reason)
                    ? { backgroundColor: '#ff7f00', color: '#1b1c1e', borderWidth: 1, borderColor: '#ff7f00' }
                    : { borderWidth: 1, borderColor: '#1f262e', backgroundColor: 'rgba(27, 28, 30, 0.4)', color: 'rgba(255,255,255,0.7)' }
                }
              >
                <Upload className="h-4 w-4" />
                {t('landing.upload.open')}
              </button>
              <Link
                href={localizePath('/watchlist', locale)}
                className="watchlist-glow inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-white transition active:scale-[0.98] sm:w-auto"
                style={{ borderWidth: 1, borderColor: 'rgba(255, 127, 0, 0.3)', backgroundColor: 'rgba(27, 28, 30, 0.5)' }}
              >
                <Users className="h-4 w-4" />
                {t('landing.watchlist.compare')}
              </Link>
            </div>
          </section>

          {/* How it works */}
          <section aria-label={t('landing.howItWorks.label')} className="mx-auto grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { icon: UserRound, title: t('landing.howItWorks.enter.title'), desc: t('landing.howItWorks.enter.description'), color: '#ff8000' },
              { icon: Sparkles, title: t('landing.howItWorks.analyze.title'), desc: t('landing.howItWorks.analyze.description'), color: '#00e054' },
              { icon: PartyPopper, title: t('landing.howItWorks.wrapped.title'), desc: t('landing.howItWorks.wrapped.description'), color: '#40bcf4' },
            ].map(({ icon: Icon, title, desc, color }) => (
              <div
                key={title}
                className="rounded-xl p-4 text-center"
                style={{ borderWidth: 1, borderColor: '#1f262e', backgroundColor: 'rgba(27, 28, 30, 0.4)' }}
              >
                <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-lg" style={{ borderWidth: 1, borderColor: `${color}40`, backgroundColor: `${color}1a` }}>
                  <Icon className="h-4 w-4" style={{ color }} />
                </div>
                <h3 className="text-xs font-semibold text-white">{title}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-white/50">{desc}</p>
              </div>
            ))}
          </section>

          {/* FAQ */}
          <section aria-label={t('landing.faq.label')} className="mx-auto max-w-lg">
            <h2 className="text-center text-lg font-bold tracking-tight text-white">{t('landing.faq.label')}</h2>
            <div className="mt-4 space-y-2">
              {FAQ_ITEMS.map(({ q, a }) => (
                <details
                  key={q}
                  className="group rounded-xl p-4"
                  style={{ borderWidth: 1, borderColor: '#1f262e', backgroundColor: 'rgba(27, 28, 30, 0.4)' }}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
                    {t(q)}
                    <ChevronDown className="h-4 w-4 shrink-0 text-white/40 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">{t(a)}</p>
                </details>
              ))}
            </div>
          </section>

          <p className="text-center text-xs leading-relaxed text-white/45">
            {t('landing.attribution')}
          </p>

          {backendOffline && (
            <div className="mx-auto max-w-lg rounded-xl p-3 text-center" style={{ borderWidth: 1, borderColor: 'rgba(255, 127, 0, 0.4)', backgroundColor: 'rgba(255, 127, 0, 0.1)' }}>
              <p className="text-xs" style={{ color: '#ff7f00' }}>
                ⚠ {t('landing.backend.starting')}
              </p>
            </div>
          )}

        </div>
      </div>

      {/* Upload Export modal — optional path; opens from secondary link */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/75 backdrop-blur-sm">
          <div
            className="absolute inset-0"
            onClick={() => setShowUploadModal(false)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 shadow-2xl" style={{ borderWidth: 1, borderColor: '#1f262e', backgroundColor: 'rgba(30, 37, 45, 0.95)' }}>
            <button
              onClick={() => setShowUploadModal(false)}
              aria-label={t('landing.upload.close')}
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-white/70 transition hover:text-white"
              style={{ borderWidth: 1, borderColor: '#1f262e', backgroundColor: 'rgba(27, 28, 30, 0.6)' }}
            >
              <X className="size-4" />
            </button>

            <div className="mb-5 pr-12">
              <h3 className="text-xl font-bold tracking-tight sm:text-2xl text-white">{t('landing.upload.modalTitle')}</h3>
              <p className="mt-1 text-sm text-white/50">{t('landing.upload.modalDescription')}</p>
            </div>

            <ExportInstructions />

            <div className="mt-6">
              <UploadZone onFiles={handleFiles} />
            </div>

            <p className="mt-4 text-center text-xs text-white/40">
              {t('landing.upload.quickPath')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

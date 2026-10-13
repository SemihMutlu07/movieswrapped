'use client';

import JSZip from 'jszip';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { MessageKey } from '@/i18n/catalogs';
import { useI18n } from '@/i18n/I18nProvider';
import { trackConsentedEvent, trackEvent, trackFilmStats } from '@/lib/analytics';
import {
  analyzeFiles,
  fileLooksLikeZip,
  isLetterboxdExportFilename,
  parseLetterboxdUsername,
  scrapeProfile,
  testBackend,
  type ScrapeProgress,
} from '@/lib/api';
import { needsZipFallback, normalizeError, type NormalizedError } from '@/lib/errors';
import { storyPath } from '@/lib/routes';
import { persistStats } from '@/lib/stats-storage';
import {
  buildSummaryForPersistence,
  finishAnalysis,
  startAnalysis,
} from '@/lib/supabase/analysis_runs';
import { upsertUserSession } from '@/lib/supabase/sessions';
import { ensureSessionId, getConsent, getUsername, setUsername } from '@/lib/session-id';
import { usePhoneLayout } from '@/hooks/usePhoneLayout';

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

function localizeLandingError(
  error: NormalizedError,
  t: (key: MessageKey) => string,
): NormalizedError {
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
    claim_timeout: ['landing.error.claimTimeout.title', 'landing.error.claimTimeout.message', 'landing.error.claimTimeout.action'],
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

export function useLandingAnalysis({
  showUsernameScrape,
  allowPhoneUpload,
}: {
  showUsernameScrape: boolean;
  allowPhoneUpload: boolean;
}) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const isPhone = usePhoneLayout();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<NormalizedError | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [activeScrapeUsername, setActiveScrapeUsername] = useState('');
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress | null>(null);
  const [scrapeResultReady, setScrapeResultReady] = useState(false);
  const storyDestinationRef = useRef<string | null>(null);
  const lastActionRef = useRef<'upload' | 'scrape' | null>(null);
  const uploadSectionRef = useRef<HTMLElement | null>(null);
  const usernamePlaceholder = useTypewriterPlaceholder(
    USERNAME_PLACEHOLDER_EXAMPLES,
    showUsernameScrape,
  );
  const [backendOffline, setBackendOffline] = useState(false);
  const analysisGeneration = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastUploadRef = useRef<File[] | null>(null);

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
    void testBackendConnectivity();
  }, []);

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

    const filesArray = Array.from(files);
    const isFolderUpload = filesArray.some(
      (f) => !!(f as File & { webkitRelativePath?: string }).webkitRelativePath,
    );

    const maxFileSize = 50 * 1024 * 1024;
    const zipFlags = await Promise.all(filesArray.map((file) => fileLooksLikeZip(file)));
    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      if (isFolderUpload && !/\.csv$/i.test(file.name)) continue;
      if (file.size > maxFileSize) {
        const sizeMb = (file.size / 1024 / 1024).toFixed(1);
        setError({
          title: 'File too large',
          message: `"${file.name}" is ${sizeMb} MB. Maximum size is 50 MB.`,
          action: 'Try exporting a smaller date range or compressing the file.',
          reason: 'file_too_large',
        });
        trackEvent('analyze_failed', { reason: 'file_too_large', step: 'validation' });
        return;
      }
      if (!isLetterboxdExportFilename(file.name) && !zipFlags[i]) {
        setError({
          title: 'Unsupported file',
          message: `"${file.name}" is not a supported format. Upload your Letterboxd export ZIP or CSV files.`,
          reason: 'invalid_file_type',
        });
        trackEvent('analyze_failed', { reason: 'invalid_extension', step: 'validation' });
        return;
      }
    }

    lastUploadRef.current = filesArray;
    lastActionRef.current = 'upload';
    setIsUploading(true);
    setError(null);
    analysisGeneration.current += 1;
    const generation = analysisGeneration.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const stillCurrent = () => generation === analysisGeneration.current && !controller.signal.aborted;
    trackEvent('analyze_started', { fileCount: files.length, method: 'upload' });

    let detectedUsername: string | null = null;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i] as File & { webkitRelativePath?: string };
        const relativePath = file.webkitRelativePath || '';
        const pathParts = relativePath ? relativePath.split('/').filter(Boolean) : [];
        for (const candidate of [file.name, relativePath, pathParts[0] || '']) {
          if (!candidate) continue;
          const { username: parsed } = await parseLetterboxdUsername(candidate);
          if (parsed) {
            detectedUsername = parsed;
            break;
          }
        }
        if (detectedUsername) break;
      }
    } catch {
      // ponytail: username is optional; analyzeFiles reports a dead backend
    }
    if (!stillCurrent()) return;

    const hasPersistenceConsent = getConsent() === 'accept';
    if (detectedUsername) {
      setUsername(detectedUsername);
      if (hasPersistenceConsent) {
        try {
          await upsertUserSession({
            session_id: ensureSessionId(),
            username: detectedUsername,
            consent: 'accept',
            film_count: null,
            favorite_genre: null,
          });
        } catch (err) {
          console.warn('[supabase] session upsert failed (non-blocking):', err);
        }
      }
    }

    let uploadFiles: File[] = [];
    const single = filesArray.length === 1 ? filesArray[0] : null;
    const isZip = Boolean(single && zipFlags[0]);

    if (isZip && single) {
      uploadFiles = [single];
    } else if (isFolderUpload) {
      const csvFiles = Array.from(files).filter((f) => /\.csv$/i.test(f.name));
      if (csvFiles.length === 0) {
        if (!stillCurrent()) return;
        setError({
          title: 'No CSV files found',
          message: 'The selected folder contains no Letterboxd CSV files.',
          action: 'Make sure you selected the extracted Letterboxd export folder.',
          reason: 'no_csv_files',
        });
        setIsUploading(false);
        trackEvent('analyze_failed', { reason: 'no_csv_in_folder', step: 'preparation' });
        return;
      }
      try {
        uploadFiles = [await zipFiles(csvFiles)];
      } catch (err) {
        if (!stillCurrent()) return;
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
        if (!stillCurrent()) return;
        console.error('[upload] file zip packaging failed:', err);
        setError({ title: 'prepare_files', message: '', reason: 'unknown_error' });
        setIsUploading(false);
        trackEvent('analyze_failed', { reason: 'zip_pack_failed', step: 'preparation' });
        return;
      }
    }

    if (!stillCurrent()) return;

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
        } catch {
          /* analytics failure is non-fatal */
        }
      }

      if (!stillCurrent()) return;
      startedAt = performance.now();
      const result = await analyzeFiles(formData, { signal: controller.signal });
      const durationMs = performance.now() - startedAt;
      if (!stillCurrent()) return;

      if (detectedUsername) {
        setUsername(detectedUsername);
      }
      if (!stillCurrent()) return;
      const { dropped } = persistStats(result.stats);
      if (dropped.length > 0) {
        trackEvent('stats_storage_degraded', {
          dropped_count: dropped.length,
          dropped_fields: dropped.join(','),
        });
      }

      trackConsentedEvent('analyze_succeeded', { total_films: result.stats.total_films, duration_ms: Math.round(durationMs) });
      trackFilmStats({
        total_films: result.stats.total_films,
        total_countries: result.stats.total_countries,
        average_rating: result.stats.average_rating,
      });

      if (analysisRun && detectedUsername) {
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
              username: detectedUsername,
              consent: 'accept',
              film_count: result.stats.total_films || null,
              favorite_genre: result.stats.favorite_genre?.name || null,
            });
          } catch {
            /* analytics failure is non-fatal */
          }
        })();
      }

      if (!stillCurrent()) return;
      router.push(storyPath(detectedUsername, locale));
    } catch (err) {
      if (!stillCurrent() || (err instanceof Error && err.name === 'AbortError')) return;
      const normalized = normalizeError(err);
      if (analysisRun && detectedUsername) {
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
      trackEvent('analyze_failed', {
        reason: normalized.reason,
        duration_ms: startedAt > 0 ? Math.round(performance.now() - startedAt) : 0,
      });
      setError(normalized);
      setIsUploading(false);
    }
  }, [locale, router, zipFiles]);

  const handleScrape = useCallback(async () => {
    let raw = usernameInput.trim();

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
      setError({
        title: 'Invalid username',
        message: 'Letterboxd usernames can only contain lowercase letters, numbers, and underscores. You can also paste your full Letterboxd profile URL.',
        reason: 'invalid_username',
      });
      return;
    }

    lastActionRef.current = 'scrape';
    setError(null);
    analysisGeneration.current += 1;
    const generation = analysisGeneration.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const stillCurrent = () => generation === analysisGeneration.current && !controller.signal.aborted;

    const sessionId = ensureSessionId();
    setActiveScrapeUsername(username);
    setIsScraping(true);
    setScrapeProgress(null);
    setScrapeResultReady(false);

    trackEvent('analyze_started', { method: 'scrape', analysis_period: 'lifetime' });
    trackEvent('scrape_started', { method: 'scrape' });
    const destination = storyPath(username, locale);
    storyDestinationRef.current = destination;
    router.prefetch(destination);

    const hasPersistenceConsent = getConsent() === 'accept';
    let analysisRun: { id: string } | null = null;
    let startedAt = 0;

    try {
      if (hasPersistenceConsent) {
        try {
          const runId = crypto?.randomUUID?.();
          analysisRun = await startAnalysis({ id: runId, session_id: sessionId, username });
        } catch {
          /* analytics failure is non-fatal */
        }
      }

      if (!stillCurrent()) return;
      startedAt = performance.now();
      const result = await scrapeProfile(username, 'lifetime', controller.signal, (p) => {
        if (stillCurrent()) {
          setScrapeProgress(p);
        }
      });
      const durationMs = performance.now() - startedAt;
      if (!stillCurrent()) return;

      const returnedUsername = result.stats.scraped_username?.trim().toLowerCase();
      if (returnedUsername && returnedUsername !== username) {
        throw new Error(`Username mismatch: requested @${username}, got @${returnedUsername}`);
      }

      setUsername(username);
      const { dropped } = persistStats(result.stats);
      if (dropped.length > 0) {
        trackEvent('stats_storage_degraded', {
          dropped_count: dropped.length,
          dropped_fields: dropped.join(','),
        });
      }

      trackEvent('scrape_done', {
        duration_ms: Math.round(durationMs),
        films: Number(result.stats.scraped_film_count ?? result.stats.total_films ?? 0),
        diary: Number(result.stats.scraped_diary_count ?? 0),
        queue_wait_ms: Number(result.queue_wait_ms ?? 0),
        method: 'scrape',
      });
      trackConsentedEvent('analyze_succeeded', {
        total_films: result.stats.total_films,
        duration_ms: Math.round(durationMs),
        method: 'scrape',
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
              username,
              consent: 'accept',
              film_count: result.stats.total_films || null,
              favorite_genre: result.stats.favorite_genre?.name || null,
            });
          } catch {
            /* analytics failure is non-fatal */
          }
        })();
      }

      if (!stillCurrent()) return;
      setScrapeResultReady(true);
    } catch (err) {
      if (!stillCurrent() || (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError')) {
        return;
      }
      console.error('[scrape] analysis failed:', err);
      const normalized = normalizeError(err);
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
      trackEvent('scrape_failed', { reason: normalized.reason, method: 'scrape' });
      trackEvent('analyze_failed', {
        reason: normalized.reason,
        duration_ms: startedAt > 0 ? Math.round(performance.now() - startedAt) : 0,
        method: 'scrape',
      });
      setError(normalized);
      setIsScraping(false);
      setActiveScrapeUsername('');
    }
  }, [locale, router, usernameInput]);

  const handleStoryReady = useCallback(() => {
    const destination = storyDestinationRef.current;
    if (!destination) return;
    storyDestinationRef.current = null;
    router.push(destination);
  }, [router]);

  const handleCancel = useCallback(() => {
    analysisGeneration.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    storyDestinationRef.current = null;
    setIsUploading(false);
    setIsScraping(false);
    setActiveScrapeUsername('');
    setScrapeProgress(null);
    setScrapeResultReady(false);
    setError(null);
  }, []);

  const handleRetry = useCallback(() => {
    if (error && needsZipFallback(error.reason)) {
      setError(null);
      uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setError(null);
    if (lastActionRef.current === 'scrape' && usernameInput.trim()) {
      void handleScrape();
    } else if (lastUploadRef.current?.length) {
      void handleFiles(lastUploadRef.current);
    }
  }, [error, handleFiles, handleScrape, usernameInput]);

  useEffect(() => {
    if (error && needsZipFallback(error.reason)) {
      uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [error]);

  return {
    isPhone,
    isUploading,
    isScraping,
    activeScrapeUsername,
    scrapeProgress,
    scrapeResultReady,
    handleCancel,
    handleStoryReady,
    view: {
      showUsernameScrape,
      allowPhoneUpload,
      isPhone,
      backendOffline,
      translatedError: error ? localizeLandingError(error, t) : null,
      usernameInput,
      setUsernameInput,
      usernameFocused,
      setUsernameFocused,
      usernamePlaceholder,
      uploadSectionRef,
      handleFiles,
      handleScrape,
      handleRetry,
      clearError: () => setError(null),
    },
  };
}

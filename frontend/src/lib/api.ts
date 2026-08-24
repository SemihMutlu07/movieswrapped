// Minimal typing for analysis stats — keeps component code readable without
// encoding the full backend schema here.
export interface LetterboxdStats {
  total_films?: number;
  total_countries?: number;
  average_rating?: number;
  favorite_genre?: { name: string; count: number } | null;
  analysis_period?: AnalysisPeriodMetadata;
  [key: string]: unknown;
}

export type AnalysisPeriod = 'month' | 'year' | 'lifetime';

export interface AnalysisPeriodMetadata {
  key: AnalysisPeriod;
  start_date: string | null;
  end_date: string | null;
}

export interface ScrapeProfileResult {
  status: string;
  stats: LetterboxdStats;
  task_id?: string;
}

export interface WatchlistFilm {
  title: string;
  year: string;
  slug: string;
  poster_url?: string;
  poster_path?: string;
  popularity?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;
  genres?: string[];
}

export interface WatchlistBucketCounts {
  common: number;
  first_only: number;
  second_only: number;
}

export interface WatchlistTruncation {
  common: boolean;
  first_only: boolean;
  second_only: boolean;
}

export interface WatchlistCompareResult {
  status: 'success';
  users: [string, string];
  counts: {
    first_total: number;
    second_total: number;
    common: number;
    first_only: number;
    second_only: number;
  };
  returned_counts?: WatchlistBucketCounts;
  truncated?: WatchlistTruncation;
  match_score: number;
  common: WatchlistFilm[];
  first_only: WatchlistFilm[];
  second_only: WatchlistFilm[];
}

export interface FindFilmCounts {
  per_user: Record<string, number>;
  intersection: number;
  watched_removed: number;
  candidates: number;
  returned: number;
  truncated: boolean;
}

export interface FindFilmResult {
  status: 'success';
  users: string[];
  counts: FindFilmCounts;
  films: WatchlistFilm[];
}

export type RecommendationStrategy = 'random' | 'highest_rated' | 'newest';

export interface FilmRecommendation {
  title: string;
  year: string;
  reason: string;
  poster_path: string;
  slug?: string;
  vote_average?: number | null;
  release_date?: string;
  director?: string | null;
  overview?: string | null;
}

export interface RecommendFromCompareResult {
  recommendation: FilmRecommendation;
  alternatives: FilmRecommendation[];
}

export interface DateNightResult {
  mutual_profile: {
    top_genres: string[];
    top_directors: string[];
    era_overlap: string;
  };
  recommendations: FilmRecommendation[];
}

// API base configuration
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000').replace(/\/$/, '');

// Enhanced error handling utility
export function handleApiError(error: unknown, context: string): Error {
  const code = error instanceof Error && 'code' in error ? (error as { code?: string }).code : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const hint = code ? ERROR_CODE_HINTS[code] : undefined;

  // Log a structured, self-diagnosing error so the console is useful for both
  // users and the next Claude session. We always log detail + hint + code.
  console.error(`[API Error] ${context}:`, rawMessage, {
    code,
    hint,
    error,
    context,
  });

  if (error instanceof Error) {
    if (error.name === 'TypeError' || error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
      const err = new Error(`Network error: Unable to connect to ${context}. The server may still be starting or your internet connection may be down.`);
      if (code) (err as { code?: string }).code = code;
      return err;
    }
    if (code) {
      // The error already carries a backend code; prefer that over regexp parsing.
      return error;
    }
    return error;
  }
  const err = new Error(`Unexpected error in ${context}: ${rawMessage}`);
  if (code) (err as { code?: string }).code = code;
  return err;
}

// Likely cause for a given backend error_code — surfaced in the console log so a
// failure is self-diagnosing (for both a human and a future Claude session reading
// the console) instead of a raw object dump with no explanation.
const ERROR_CODE_HINTS: Record<string, string> = {
  scraper_unavailable:
    'All available scraper slots are full. If the backend uses a desktop worker, the worker is either busy, offline, or still starting up. Try again in 30–60 seconds or use ZIP upload for a guaranteed result.',
  worker_paused:
    'The admin dashboard paused the desktop worker. Scrape jobs will not run until an admin resumes the worker. ZIP upload still works.',
  desktop_worker_paused: 'Admin dashboard has the worker paused for maintenance.',
  worker_offline:
    'No desktop worker heartbeat has been received. The worker process is not running or cannot reach the backend. Restart the worker or use ZIP upload.',
  desktop_worker_offline:
    'No desktop worker heartbeat has been received. The worker process is not running or cannot reach the backend. Restart the worker or use ZIP upload.',
  scrape_blocked:
    'Letterboxd blocked the scrape request (bot detection / cloud IP). The backend has reached Letterboxd directly and was denied. Use ZIP upload instead.',
  user_not_found:
    'Letterboxd returned a 404 for this username, or the profile is private. Double-check spelling and that the profile is public.',
  same_username: 'Both usernames were identical. This is a client-side validation problem.',
  watchlist_lab_rate_limited:
    'You hit the per-client watchlist-lab rate limit (10 requests / 10 min). Wait a few minutes.',
  scrape_timeout:
    'The desktop worker accepted the job but did not finish within the timeout. It may be stuck or overloaded. Try again.',
  enrichment_failed:
    'TMDB metadata lookup failed for the shared watchlist. This is usually transient. Try again.',
  invalid_username:
    'The submitted username contains invalid characters. The UI should prevent this; report if it did not.',
  no_common_watchlist:
    'The two watchlists have zero films in common. This is a real result, not an error.',
  duplicate_username:
    'After normalization fewer than two distinct usernames remained. The UI should prevent this; report if it did not.',
  queue_full:
    'The desktop worker job queue is at capacity. Wait a minute and try again.',
  find_film_processing_failed:
    'The group watchlist result could not be assembled after the scrape finished. Usually transient — try again.',
  find_film_enrichment_timeout:
    'TMDB metadata lookup for the group watchlist took too long. Usually transient — try again.',
};

export { ERROR_CODE_HINTS };

// Shared failure parser for watchlist/date-night endpoints: reads the FastAPI
// `{detail: {error_code, message}}` shape, logs a labeled + hinted console error,
// and returns an Error carrying `.code` for handleApiError to pass through.
async function parseApiFailure(r: Response, context: string, fallbackMessage: string): Promise<Error & { code?: string }> {
  let detail = '';
  let code: string | undefined;
  let fullBody: unknown;
  try {
    fullBody = await r.json();
    if (typeof fullBody === 'object' && fullBody !== null) {
      const { detail: bodyDetail } = fullBody as { detail?: unknown };
      if (typeof bodyDetail === 'string') {
        detail = bodyDetail;
      } else if (bodyDetail && typeof bodyDetail === 'object') {
        const obj = bodyDetail as Record<string, unknown>;
        detail = String(obj.message || obj.error_code || '');
        code = typeof obj.error_code === 'string' ? obj.error_code : undefined;
      }
    }
  } catch {
    // body wasn't JSON
  }
  const err = new Error(detail || fallbackMessage) as Error & { code?: string };
  if (code) err.code = code;
  console.error(
    `[API Error] ${context} failed — ${code ? `error_code: ${code}` : `HTTP ${r.status}`}`,
    {
      status: r.status,
      code,
      detail,
      hint: code ? ERROR_CODE_HINTS[code] : undefined,
      body: fullBody,
      url: r.url,
    },
  );
  return err;
}

// Search for person (director/actor) in TMDB
export async function searchPerson(name: string, role: 'director' | 'actor' = 'director') {
  const url = `${API_BASE}/api/tmdb/person/search?name=${encodeURIComponent(name)}&role=${encodeURIComponent(role)}`;
  try {
    const r = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`TMDB search ${r.status}`);
    const data = await r.json();
    if (!data || typeof data !== 'object') throw new Error('Invalid response from TMDB search');
    return data;
  } catch (error) {
    const enhancedError = handleApiError(error, 'TMDB search');
    return { found: false, message: enhancedError.message, name, url: null, error: enhancedError.message };
  }
}

// Search for a movie in TMDB by title (and optional year), returning its poster URL
export async function searchMovie(title: string, year?: number) {
  const params = new URLSearchParams({ title });
  if (year) params.set('year', String(year));
  const url = `${API_BASE}/api/tmdb/movie/search?${params.toString()}`;
  try {
    const r = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`TMDB movie search ${r.status}`);
    const data = await r.json();
    if (!data || typeof data !== 'object') throw new Error('Invalid response from TMDB movie search');
    return data;
  } catch (error) {
    const enhancedError = handleApiError(error, 'TMDB movie search');
    return { found: false, message: enhancedError.message, title, url: null, error: enhancedError.message };
  }
}

export type ScrapeTraceEvent = {
  stage?: string;
  message?: string;
  metrics?: Record<string, unknown>;
  elapsed_seconds?: number;
};

export type ScrapeProgress = {
  stage?: string;
  message?: string;
  trace_events?: ScrapeTraceEvent[];
};

// Poll a task until it reaches a terminal state (done | failed).
async function pollTask<T = { status: string; stats: LetterboxdStats }>(
  taskId: string,
  pollToken: string,
  opts: { intervalMs?: number; timeoutMs?: number; onProgress?: (p: ScrapeProgress) => void; signal?: AbortSignal } = {},
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs  = opts.timeoutMs  ?? 600_000; // 10 min max
  const deadline = Date.now() + timeoutMs;
  const signal = opts.signal;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const r = await fetch(`${API_BASE}/api/progress/${taskId}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'X-Task-Token': pollToken },
      signal,
    });

    if (!r.ok) {
      if (r.status === 404) {
        let likelyServerRestart = false;
        try {
          const body = await r.json();
          likelyServerRestart = Boolean(body?.detail?.likely_server_restart);
        } catch {
          // ignore — fall through to the generic message
        }
        throw new Error(
          likelyServerRestart
            ? 'The server restarted while your analysis was running. Please try again.'
            : 'Task not found or expired.',
        );
      }
      throw new Error(`Progress poll failed: ${r.status}`);
    }

    const task = await r.json();

    if (task.status === 'done') {
      const result = task.result;
      if (!result) throw new Error('Analysis returned no result');
      if (result.status === 'error') throw new Error(result.detail || 'Analysis failed');
      return result as T;
    }

    if (task.status === 'failed') {
      const error = new Error(task.error || 'Analysis failed on the server');
      if (task.error_code) {
        (error as Error & { code?: string; error_code?: string }).code = task.error_code;
        (error as Error & { code?: string; error_code?: string }).error_code = task.error_code;
      }
      throw error;
    }

    // pending | running — surface live progress, then wait and retry
    opts.onProgress?.({ stage: task.stage, message: task.message, trace_events: task.trace_events });
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timer = setTimeout(resolve, intervalMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  throw new Error('Analysis timed out after 10 minutes');
}

// Analyze uploaded files — submits the job and polls until completion.
// The returned shape {status, stats} matches the previous synchronous contract
// so callers do not need to change.
export async function analyzeFiles(formData: FormData): Promise<{ status: string; stats: LetterboxdStats; task_id?: string }> {
  const url = `${API_BASE}/api/analyze`;
  try {
    if (!formData || formData.entries().next().done) {
      throw new Error('No files provided for analysis');
    }

    const r = await fetch(url, { method: 'POST', body: formData });

    if (!r.ok) {
      throw await parseApiFailure(r, 'file analysis', `analyze ${r.status}`);
    }

    const data = await r.json();
    if (data && data.task_id) {
      const result = await pollTask<{ status: string; stats: LetterboxdStats }>(data.task_id, data.poll_token);
      return { ...result, task_id: data.task_id };
    }
    if (!data || data.status === 'error') {
      throw new Error(data?.detail || 'Analysis failed');
    }
    return data as { status: string; stats: LetterboxdStats; task_id?: string };
  } catch (error) {
    throw handleApiError(error, 'file analysis');
  }
}

// Test backend connectivity with retry for concurrent startup
export async function testBackend(retries = 2, delayMs = 1000) {
  const url = `${API_BASE}/`;
  if (process.env.NODE_ENV === 'development') {
    console.log('[api] backend health URL:', url);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!r.ok) throw new Error(`test ${r.status}`);
      const data = await r.json();
      if (!data || typeof data !== 'object') throw new Error('Invalid response from backend health check');
      return data;
    } catch (error) {
      if (attempt === retries) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Backend connection timeout. The server may still be starting up.');
        }
        const enhancedError = handleApiError(error, 'the backend');
        if (process.env.NODE_ENV === 'development') console.error('Backend connectivity test failed after retries:', enhancedError);
        throw enhancedError;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export type WorkerHealth = {
  workers: { worker_id?: string; last_seen_at?: string | null; status?: string }[];
  queue_depth?: number;
  oldest_queued_age_seconds?: number;
};

/**
 * Whether the desktop worker fleet is empty (degraded mode).
 *
 * Best-effort: returns true only when the endpoint answers and reports zero
 * workers. Any network error / non-OK response returns false so the UI keeps
 * showing the normal loading screen instead of an error.
 */
export async function isWorkerFleetEmpty(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`${API_BASE}/api/health/workers`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!r.ok) return false;
    const data: WorkerHealth = await r.json();
    return Array.isArray(data.workers) && data.workers.length === 0;
  } catch {
    return false;
  }
}

// Scrape a Letterboxd profile by username.
// Handles two backend contracts transparently:
//   - synchronous (local / no desktop worker): { status, stats }
//   - desktop-worker mode: 202 { task_id } → poll /api/progress until done
// Either way the caller receives { status, stats }.
export async function scrapeProfile(
  username: string,
  analysisPeriod: AnalysisPeriod = 'lifetime',
  signal?: AbortSignal,
  onProgress?: (p: ScrapeProgress) => void,
): Promise<ScrapeProfileResult> {
  const url = `${API_BASE}/api/scrape-profile`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, analysis_period: analysisPeriod }),
      signal,
    });

    if (!r.ok) {
      throw await parseApiFailure(r, 'profile scraping', `scrape ${r.status}`);
    }

    const data = await r.json();

    // Desktop-worker mode: the job was queued — poll until the worker finishes.
    if (data && data.task_id && !data.stats) {
      const result = await pollTask<ScrapeProfileResult>(data.task_id, data.poll_token, { onProgress, signal });
      return { ...result, task_id: data.task_id };
    }

    if (!data || data.status === 'error') {
      throw new Error(data?.detail || 'Scraping failed');
    }

    return data as ScrapeProfileResult;
  } catch (error) {
    // Pass through AbortError so the caller can distinguish cancellation
    if ((error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError')) {
      throw error;
    }
    throw handleApiError(error, 'profile scraping');
  }
}

// Compare two public Letterboxd watchlists by username
export async function compareWatchlists(
  firstUsername: string,
  secondUsername: string,
): Promise<WatchlistCompareResult> {
  const url = `${API_BASE}/api/watchlist-compare`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [firstUsername, secondUsername] }),
    });

    if (!r.ok) {
      throw await parseApiFailure(r, 'watchlist comparison', `watchlist compare ${r.status}`);
    }

    const data = await r.json();

    if (r.status === 202 && data?.task_id && data?.poll_token) {
      return await pollTask<WatchlistCompareResult>(data.task_id, data.poll_token);
    }

    if (!data || data.status === 'error') {
      throw new Error(data?.detail || 'Watchlist comparison failed');
    }

    return data as WatchlistCompareResult;
  } catch (error) {
    throw handleApiError(error, 'watchlist comparison');
  }
}

// Group find-film: films on everyone's watchlist that nobody has watched,
// popularity-sorted by the backend. Always async via the desktop worker.
export async function findFilm(
  usernames: string[],
  onProgress?: (p: ScrapeProgress) => void,
): Promise<FindFilmResult> {
  const url = `${API_BASE}/api/find-film`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames }),
    });

    if (!r.ok) {
      throw await parseApiFailure(r, 'find film', `find film ${r.status}`);
    }

    const data = await r.json();

    if (r.status === 202 && data?.task_id && data?.poll_token) {
      return await pollTask<FindFilmResult>(data.task_id, data.poll_token, { onProgress });
    }

    if (!data || data.status === 'error') {
      throw new Error(data?.detail || 'Find film failed');
    }

    return data as FindFilmResult;
  } catch (error) {
    throw handleApiError(error, 'find film');
  }
}

// Recommend one movie from two users' shared watchlist overlap
export async function recommendFromCompare(
  firstUsername: string,
  secondUsername: string,
  strategy: RecommendationStrategy = 'random',
): Promise<RecommendFromCompareResult> {
  const url = `${API_BASE}/api/recommend-from-compare`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [firstUsername, secondUsername], strategy }),
    });

    if (!r.ok) {
      throw await parseApiFailure(r, 'watchlist recommendation', `watchlist recommendation ${r.status}`);
    }

    return await r.json() as RecommendFromCompareResult;
  } catch (error) {
    throw handleApiError(error, 'watchlist recommendation');
  }
}

// Enrich watchlist common films with TMDB metadata (popularity, genres, ratings)
export async function enrichWatchlistFilms(
  firstUsername: string,
  secondUsername: string,
): Promise<{ status: string; users: [string, string]; films: WatchlistFilm[] }> {
  const url = `${API_BASE}/api/watchlist-enrich`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [firstUsername, secondUsername] }),
    });

    if (!r.ok) {
      throw await parseApiFailure(r, 'watchlist enrichment', `watchlist enrichment ${r.status}`);
    }

    return await r.json();
  } catch (error) {
    throw handleApiError(error, 'watchlist enrichment');
  }
}

// Build a mutual profile and recommend unwatched films for two users
export async function dateNight(
  firstUsername: string,
  secondUsername: string,
): Promise<DateNightResult> {
  const url = `${API_BASE}/api/date-night`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [firstUsername, secondUsername] }),
    });

    if (!r.ok) {
      throw await parseApiFailure(r, 'date night recommendations', `date night ${r.status}`);
    }

    const data = await r.json();
    if (r.status === 202 && data?.task_id && data?.poll_token) {
      return await pollTask<DateNightResult>(data.task_id, data.poll_token);
    }
    return data as DateNightResult;
  } catch (error) {
    throw handleApiError(error, 'date night recommendations');
  }
}

// Parse Letterboxd username from filename
export async function parseLetterboxdUsername(filename: string) {
  try {
    const url = `${API_BASE}/api/parse-username`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    if (!r.ok) throw new Error(`parse-username ${r.status}`);
    const data = await r.json();
    if (!data || typeof data !== 'object' || !('username' in data)) {
      throw new Error('Invalid response from username parsing service');
    }
    return data;
  } catch (error) {
    const enhancedError = handleApiError(error, 'username parsing');
    return { username: null, error: enhancedError.message };
  }
}

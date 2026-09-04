export interface LetterboxdStats {
  total_films?: number;
  total_countries?: number;
  average_rating?: number;
  favorite_genre?: { name: string; count: number } | null;
  [key: string]: unknown;
}

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000').replace(/\/$/, '');

export function isLetterboxdExportFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.csv')
    || lower.endsWith('.zip')
    || lower.endsWith('-utc')
    || /^letterboxd-.+-utc(?:\.zip)?$/i.test(name)
  );
}

export function isLetterboxdZipFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('-utc') || /^letterboxd-.+-utc(?:\.zip)?$/i.test(name);
}

export async function fileLooksLikeZip(file: File): Promise<boolean> {
  if (isLetterboxdZipFilename(file.name)) return true;
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return header.length >= 2 && header[0] === 0x50 && header[1] === 0x4b;
}

const ERROR_CODE_HINTS: Record<string, string> = {
  missing_required_files: 'The upload did not contain Letterboxd CSV files. Export from letterboxd.com/settings/data and upload the ZIP.',
  corrupt_zip: 'The ZIP file could not be read. Re-download the export from Letterboxd.',
  unsafe_archive: 'The ZIP structure was not recognized. Re-download the export from Letterboxd and upload the original file.',
  task_not_found: 'The analysis job expired or the server restarted. Upload again.',
};

export { ERROR_CODE_HINTS };

export function handleApiError(error: unknown, context: string): Error {
  const code = error instanceof Error && 'code' in error ? (error as { code?: string }).code : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const hint = code ? ERROR_CODE_HINTS[code] : undefined;

  console.error(`[API Error] ${context}:`, rawMessage, { code, hint, error, context });

  if (error instanceof Error) {
    if (error.name === 'TypeError' || error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
      const err = new Error(`Network error: Unable to connect to ${context}. The server may still be starting or your internet connection may be down.`);
      if (code) (err as { code?: string }).code = code;
      return err;
    }
    if (code) return error;
    return error;
  }
  const err = new Error(`Unexpected error in ${context}: ${rawMessage}`);
  if (code) (err as { code?: string }).code = code;
  return err;
}

async function parseApiFailure(r: Response, context: string, fallbackMessage: string): Promise<Error & { code?: string }> {
  let detail = '';
  let code: string | undefined;
  let fullBody: unknown;
  try {
    fullBody = await r.json();
    if (typeof fullBody === 'object' && fullBody !== null) {
      const body = fullBody as Record<string, unknown>;
      const bodyDetail = body.detail;
      if (typeof bodyDetail === 'string') {
        detail = bodyDetail;
      } else if (bodyDetail && typeof bodyDetail === 'object') {
        const obj = bodyDetail as Record<string, unknown>;
        detail = String(obj.message || obj.error_code || '');
        code = typeof obj.error_code === 'string' ? obj.error_code : undefined;
      }
      if (!detail && typeof body.message === 'string') detail = body.message;
      if (!code && typeof body.error_code === 'string') code = body.error_code;
    }
  } catch {
    // body wasn't JSON
  }
  const err = new Error(detail || `${fallbackMessage} (HTTP ${r.status})`) as Error & { code?: string };
  if (code) err.code = code;
  console.error(`[API Error] ${context} failed`, { status: r.status, code, detail, hint: code ? ERROR_CODE_HINTS[code] : undefined, body: fullBody, url: r.url });
  return err;
}

async function pollTask<T = { status: string; stats: LetterboxdStats }>(
  taskId: string,
  pollToken: string,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const deadline = Date.now() + timeoutMs;
  const signal = opts.signal;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const r = await fetch(`${API_BASE}/api/progress/${taskId}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Task-Token': pollToken },
      signal,
    });

    if (!r.ok) {
      if (r.status === 404) {
        let likelyServerRestart = false;
        try {
          const body = await r.json();
          likelyServerRestart = Boolean(body?.detail?.likely_server_restart);
        } catch {
          // ignore
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
        (error as Error & { code?: string }).code = task.error_code;
      }
      throw error;
    }

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

export async function testBackend(retries = 2, delayMs = 1000) {
  const url = `${API_BASE}/`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
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
        throw handleApiError(error, 'the backend');
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

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
    throw handleApiError(error, 'username parsing');
  }
}

export async function searchPerson(name: string, role: 'director' | 'actor' = 'director') {
  const url = `${API_BASE}/api/tmdb/person/search?name=${encodeURIComponent(name)}&role=${encodeURIComponent(role)}`;
  try {
    const r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`TMDB search ${r.status}`);
    return await r.json();
  } catch (error) {
    const enhancedError = handleApiError(error, 'TMDB search');
    return { found: false, message: enhancedError.message, name, url: null, error: enhancedError.message };
  }
}

export async function searchMovie(title: string, year?: number) {
  const params = new URLSearchParams({ title });
  if (year) params.set('year', String(year));
  const url = `${API_BASE}/api/tmdb/movie/search?${params.toString()}`;
  try {
    const r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`TMDB movie search ${r.status}`);
    return await r.json();
  } catch (error) {
    const enhancedError = handleApiError(error, 'TMDB movie search');
    return { found: false, message: enhancedError.message, title, url: null, error: enhancedError.message };
  }
}

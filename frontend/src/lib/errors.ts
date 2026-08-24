export type ErrorReason =
  | 'no_files_selected'
  | 'no_csv_files'
  | 'invalid_file_type'
  | 'file_too_large'
  | 'corrupt_zip'
  | 'missing_required_files'
  | 'backend_unreachable'
  | 'tmdb_timeout'
  | 'tmdb_rate_limited'
  | 'no_username'
  | 'invalid_username'
  | 'invalid_analysis_period'
  | 'no_films'
  | 'no_films_in_period'
  | 'user_not_found'
  | 'scrape_failed'
  | 'scrape_blocked'
  | 'scraper_unavailable'
  | 'queue_full'
  | 'desktop_worker_offline'
  | 'desktop_worker_paused'
  | 'stats_too_large'
  | 'unknown_error';

export interface NormalizedError {
  title: string;
  message: string;
  action?: string;
  reason: ErrorReason;
}

/** Scrape-path failures where export upload is the reliable next step. */
export const ZIP_FALLBACK_REASONS: readonly ErrorReason[] = [
  'scraper_unavailable',
  'queue_full',
  'desktop_worker_offline',
  'desktop_worker_paused',
  'scrape_blocked',
];

export function needsZipFallback(reason: ErrorReason): boolean {
  return ZIP_FALLBACK_REASONS.includes(reason);
}

/**
 * Map a raw error (from backend detail or network failure) to a structured
 * NormalizedError that the UI can display consistently.
 */
export function normalizeError(err: unknown): NormalizedError {
  const errObj = err as { code?: unknown; error_code?: unknown; message?: unknown } | null;
  const code =
    typeof errObj?.code === 'string'
      ? errObj.code
      : typeof errObj?.error_code === 'string'
        ? errObj.error_code
        : '';
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : typeof errObj?.message === 'string'
          ? errObj.message
          : code;

  // Backend unreachable / network failure
  if (
    err instanceof TypeError ||
    /Failed to fetch|NetworkError|fetch|ECONNREFUSED/i.test(raw)
  ) {
    return {
      title: "Can't reach the server",
      message:
        'The analysis server appears to be offline or your connection dropped.',
      action: 'Try again in a moment.',
      reason: 'backend_unreachable',
    };
  }

  // Analysis succeeded but the browser refused to store even the trimmed result
  if (err instanceof Error && err.name === 'StatsTooLargeError') {
    return {
      title: 'Result too large to store',
      message:
        'Your analysis finished, but this browser ran out of storage before it could be handed to the results page.',
      action: 'Close other tabs of this site, or clear site data, then try again.',
      reason: 'stats_too_large',
    };
  }

  // Corrupt ZIP
  if (/not a valid ZIP|BadZipFile|corrupt/i.test(raw)) {
    return {
      title: 'Corrupt ZIP file',
      message:
        'The file you uploaded is not a valid ZIP archive. Please re-download your Letterboxd export and try again.',
      reason: 'corrupt_zip',
    };
  }

  // Missing required CSVs
  if (/No valid Letterboxd CSV|missing_required_files/i.test(raw)) {
    return {
      title: 'Required files not found',
      message:
        'No valid Letterboxd CSV files were found in the upload. This often happens on Mac when Safari auto-extracts the ZIP.',
      action:
        'Re-download the original ZIP from Letterboxd and upload it directly — do not extract the files. (On Mac, Safari may unzip automatically; use Chrome or Firefox instead.)',
      reason: 'missing_required_files',
    };
  }

  // File too large
  if (/413|too large|file_too_large/i.test(raw)) {
    return {
      title: 'File too large',
      message:
        'The uploaded file exceeds the maximum allowed size (50 MB).',
      action: 'Try exporting a smaller date range or compressing the file.',
      reason: 'file_too_large',
    };
  }

  // TMDB timeout
  if (/TMDB.*timeout|timeout.*TMDB/i.test(raw)) {
    return {
      title: 'Movie database timeout',
      message:
        'The movie metadata service took too long to respond.',
      action: 'Please try again in a few moments.',
      reason: 'tmdb_timeout',
    };
  }

  // Rate limited
  if (/429|rate.?limit/i.test(raw)) {
    return {
      title: 'Too many requests',
      message:
        'You have made too many requests in a short period.',
      action: 'Please wait a minute and try again.',
      reason: 'tmdb_rate_limited',
    };
  }

  // Scraper-service failure (worker failed/unreachable/too busy). These messages
  // come from the local scraper or desktop worker when it cannot complete a job.
  if (/desktop_worker_offline|desktop scraper is offline/i.test(raw) || code === 'desktop_worker_offline') {
    return {
      title: 'Desktop scraper offline',
      message:
        raw ||
        'The desktop scraper is offline right now.',
      action:
        'Upload your Letterboxd export ZIP — that path does not use the scraper.',
      reason: 'desktop_worker_offline',
    };
  }

  if (code === 'queue_full' || /queue_full|analysis queue is full|worker queue is full/i.test(raw)) {
    return {
      title: 'Scraper queue is full',
      message:
        raw ||
        'Too many scrapes are already running from this network. Export upload still works.',
      action:
        'Upload your Letterboxd export ZIP (Settings → Import & Export). Username scrape can wait.',
      reason: 'queue_full',
    };
  }

  if (
    /scraper_unavailable|scraper service|too many people are using the scraper|all scraper slots are full|worker is (busy|offline|not available)|scrape queue full/i.test(
      raw,
    )
  ) {
    return {
      title: 'Scraper is busy',
      message: raw || 'Too many people are using the scraper right now. Please wait a few seconds and try again.',
      action:
        'Upload your Letterboxd export ZIP for a guaranteed result, or retry in a minute.',
      reason: 'scraper_unavailable',
    };
  }

  // Admin-paused desktop worker path
  if (/desktop_worker_paused|desktop scraper is paused/i.test(raw)) {
    return {
      title: 'Desktop scraper paused',
      message:
        raw ||
        'The desktop scraper is paused for maintenance.',
      action:
        'Upload your Letterboxd export ZIP — that path does not use the scraper.',
      reason: 'desktop_worker_paused',
    };
  }

  // Scrape blocked by Letterboxd bot detection (cloud IP)
  if (/scrape_blocked|letterboxd is blocking|rate limit hit/i.test(raw)) {
    return {
      title: 'Letterboxd access blocked',
      message: raw || 'Letterboxd has temporarily blocked automated profile access.',
      action: 'Download your Letterboxd export ZIP and upload it here — that always works.',
      reason: 'scrape_blocked',
    };
  }

  // Unsupported analysis window
  if (/invalid_analysis_period|invalid analysis period/i.test(raw)) {
    return {
      title: 'Invalid analysis period',
      message: raw || 'The selected analysis period is not supported.',
      action: 'Choose one month, one year, or all time and try again.',
      reason: 'invalid_analysis_period',
    };
  }

  // Valid profile, but no films inside the selected window
  if (/no_films_in_period|no films.*(?:period|date range)/i.test(raw)) {
    return {
      title: 'No films in this period',
      message: raw || 'No public films were found in the selected period.',
      action: 'Choose a longer period and try again.',
      reason: 'no_films_in_period',
    };
  }

  // No public films on this profile
  if (/no_films|no public films/i.test(raw)) {
    return {
      title: 'No public films',
      message: raw || 'No public films found on this profile.',
      action: 'Make sure your profile is public and your watched films are visible to everyone (not just followers).',
      reason: 'no_films',
    };
  }

  // Scrape-specific: user truly not found vs blocked
  if (/user_not_found/i.test(raw)) {
    return {
      title: 'Profile not found',
      message: raw || 'This Letterboxd user could not be found.',
      action:
        'Check the username is spelled exactly right and the profile is public (not a private/patron-only profile).',
      reason: 'user_not_found',
    };
  }

  if (/blocked|blocking|automated access/i.test(raw)) {
    return {
      title: 'Blocked by Letterboxd',
      message: raw || 'Letterboxd blocked the request.',
      action: 'Try again in a few minutes. If it persists, use the ZIP upload method instead.',
      reason: 'scrape_failed',
    };
  }

  if (/scrape_unreachable|Could not reach Letterboxd/i.test(raw)) {
    return {
      title: "Can't reach Letterboxd",
      message: raw || 'The server could not connect to Letterboxd.',
      action: 'Check your internet connection and try again.',
      reason: 'backend_unreachable',
    };
  }

  if (/402/i.test(raw)) {
    return {
      title: 'Rate limited',
      message: 'Letterboxd is rate-limiting requests from this server.',
      action: 'Wait a minute and try again, or use the ZIP upload.',
      reason: 'scrape_failed',
    };
  }

  // Fallback — include raw debug detail for backend errors
  const showDebug = /Debug:/.test(raw);
  return {
    title: showDebug ? 'Something went wrong (debug)' : 'Something went wrong',
    message: raw || 'An unexpected error occurred during analysis.',
    action: showDebug ? undefined : 'Try again. If the issue persists, use the ZIP upload instead.',
    reason: 'unknown_error',
  };
}

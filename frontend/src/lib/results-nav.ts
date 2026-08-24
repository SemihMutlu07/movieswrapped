const TAP_KEY = 'mw:results-nav-tap-ms';
const MARK_PREFIX = 'mw:results-nav:';

export type ResultsNavPhase =
  | 'tap'
  | 'route-start'
  | 'shell-visible'
  | 'data-ready'
  | 'content-mounted'
  | 'interactive';

function wallClock(): number {
  return Date.now();
}

function safeMark(phase: ResultsNavPhase) {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  try {
    performance.mark(`${MARK_PREFIX}${phase}`);
  } catch {
    // Marks are diagnostics only.
  }
}

/** Call on the user gesture that should open Results. Uses wall clock so it survives a full page load. */
export function stampResultsNavTap() {
  try {
    sessionStorage.setItem(TAP_KEY, String(wallClock()));
  } catch {
    // Storage may be unavailable; timings then start at Results mount.
  }
  safeMark('tap');
}

export function markResultsNav(phase: ResultsNavPhase) {
  safeMark(phase);
  if (typeof window === 'undefined') return;
  try {
    const tap = Number(sessionStorage.getItem(TAP_KEY) || '');
    const sinceTap = Number.isFinite(tap) && tap > 0 ? wallClock() - tap : null;
    const detail = { phase, sinceTapMs: sinceTap };
    window.__MW_RESULTS_NAV__ = {
      ...(window.__MW_RESULTS_NAV__ ?? {}),
      [phase]: detail,
    };
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[results-nav]', detail);
    }
  } catch {
    // Diagnostics must never block rendering.
  }
}

declare global {
  interface Window {
    __MW_RESULTS_NAV__?: Partial<Record<ResultsNavPhase, { phase: ResultsNavPhase; sinceTapMs: number | null }>>;
  }
}

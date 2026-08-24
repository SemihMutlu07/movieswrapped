'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { chunkIntoBatches, MAX_POSTERS, resolveScrapeReveal, type ScrapeReveal, type ScrapeWaitBeat } from '@/components/landing/scrapeReveal';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/catalogs';
import type { ScrapeTraceEvent } from '@/lib/api';

type Props = {
  username: string;
  onCancel?: () => void;
  queued?: boolean;
  events?: ScrapeTraceEvent[];
  onStoryReady?: () => void;
};

/**
 * Explicit wait machine (audit decision 1):
 *   INTRO → SCRAPING → REVIEWS → ANALYZING → READY → STORY
 * `queued` is the pre-machine state: nothing has started yet.
 * Each state defines exactly one dominant content motion; progress shimmer is
 * only permitted when it IS that state's dominant motion (`pulse`), so a
 * counter bump, poster drop, pulse and slide crossfade never run together.
 */
type MachinePhase = 'intro' | 'scraping' | 'reviews' | 'analyzing' | 'ready';
type WaitPhase = 'queued' | MachinePhase | 'story';

type DominantMotion = 'crossfade' | 'posterDrop' | 'pulse' | 'settle';

/** Exit crossfade duration — the next slide waits for this before entering. */
const EXIT_MS = 240;
/** READY dwells briefly so the final count can settle before the STORY handoff. */
const STORY_DWELL_MS = 1400;

// Poster stream pacing (audit decision 3): posters arrive in batches of 2–4,
// never as a single-poster drip. The counter settles COUNT_SETTLE_MS AFTER its
// posters appear and always comes from the worker's real films_found — never
// derived from how many posters are on screen.
const FIRST_BATCH_DELAY_MS = 250;
const BATCH_INTERVAL_MS = 700;
const COUNT_SETTLE_MS = 100;

const PROGRESS_STAGES = ['intro', 'scraping', 'reviews', 'analyzing'] as const;

type PhaseSpec = {
  labelKey: MessageKey;
  /** Index of the active progress segment; PROGRESS_STAGES.length means all done. */
  activeIndex: number;
  /** The single dominant content motion for this phase. */
  dominant: DominantMotion | null;
};

const PHASE_SPEC: Record<MachinePhase | 'story', PhaseSpec> = {
  intro: {
    labelKey: 'landing.storyWait.intro',
    activeIndex: 0,
    dominant: 'crossfade',
  },
  scraping: {
    labelKey: 'landing.storyWait.films',
    activeIndex: 1,
    dominant: 'posterDrop',
  },
  reviews: {
    labelKey: 'landing.storyWait.reviews',
    activeIndex: 2,
    dominant: 'crossfade',
  },
  analyzing: {
    labelKey: 'landing.storyWait.analyzing',
    activeIndex: 3,
    dominant: 'pulse',
  },
  ready: {
    labelKey: 'landing.storyWait.ready',
    activeIndex: PROGRESS_STAGES.length,
    dominant: 'settle',
  },
  story: {
    labelKey: 'landing.storyWait.ready',
    activeIndex: PROGRESS_STAGES.length,
    // Exit motion belongs to the parent handoff, not to this component.
    dominant: null,
  },
};

function phaseFromBeat(beat: ScrapeWaitBeat): 'queued' | MachinePhase {
  return beat === 'films' ? 'scraping' : beat;
}

function formatElapsed(seconds: number, t: (key: MessageKey) => string): string {
  if (seconds < 60) return t('landing.loading.seconds').replace('{value}', String(seconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return t('landing.loading.minutesSeconds').replace('{minutes}', String(m)).replace('{seconds}', String(s));
}

export default function ScrapeStoryWait({ username, onCancel, queued = false, events, onStoryReady }: Props) {
  const { t } = useI18n();
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reveal: ScrapeReveal = resolveScrapeReveal(events, queued);
  const handle = username.replace(/^@/, '');

  // Target comes straight from worker evidence; STORY is entered locally after READY settles.
  const target: WaitPhase = phaseFromBeat(reveal.beat);
  // What is on screen right now. Transitions exit first, then swap (no overlap).
  const [current, setCurrent] = useState<WaitPhase>(target);
  const [leaving, setLeaving] = useState(false);
  // Poster stream state: which batches are visible, and the settled film count.
  const [revealedBatches, setRevealedBatches] = useState(0);
  const [settledFilms, setSettledFilms] = useState<number | null>(null);

  const spec = current === 'queued' ? null : PHASE_SPEC[current];
  const finished = current === 'ready' || current === 'story';
  const animate = started && !reduceMotion;

  const posters = reveal.posters.slice(0, MAX_POSTERS);
  const batches = chunkIntoBatches(posters);
  const posterSignature = posters.map((item) => item.title).join('|');
  const shownBatches = animate ? Math.min(revealedBatches, batches.length) : batches.length;

  // Auto-play off: animations and timers wait for the card's first viewport entry.
  useEffect(() => {
    const node = rootRef.current;
    if (!node || started) return;
    if (typeof IntersectionObserver === 'undefined') {
      setStarted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [started]);

  // Reduced motion stops the JS-driven counter too, not just CSS animation.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduceMotion(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Elapsed wall-clock stops once the work is done (audit decision 5).
  useEffect(() => {
    if (!started || reduceMotion || finished) return;
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [started, reduceMotion, finished]);

  // Slide transition with real exit motion: old content fades out for EXIT_MS,
  // only then the new phase mounts. A rapid replay cancels the pending swap and
  // re-targets cleanly — stale timers never fire across phases.
  // STORY is absorbing: worker evidence stays at 'ready', so a ready→story
  // target must not pull the machine back out of the handoff state.
  const effectiveTarget: WaitPhase = current === 'story' && target === 'ready' ? 'story' : target;
  useEffect(() => {
    if (!animate) {
      if (effectiveTarget !== current) setCurrent(effectiveTarget);
      return;
    }
    if (effectiveTarget === current) return;
    setLeaving(true);
    const id = window.setTimeout(() => {
      setLeaving(false);
      setCurrent(effectiveTarget);
    }, EXIT_MS);
    return () => {
      window.clearTimeout(id);
      setLeaving(false);
    };
  }, [animate, effectiveTarget, current]);

  // READY → STORY dwell. Runs even under reduced motion (it is timing, not animation).
  useEffect(() => {
    if (current !== 'ready') return;
    const id = window.setTimeout(() => setCurrent('story'), reduceMotion ? 0 : STORY_DWELL_MS);
    return () => window.clearTimeout(id);
  }, [current, reduceMotion]);

  // onStoryReady fires exactly once per journey; a replay that leaves STORY
  // re-arms it for the next run.
  const storyFiredRef = useRef(false);
  useEffect(() => {
    if (current !== 'story') {
      storyFiredRef.current = false;
      return;
    }
    if (storyFiredRef.current) return;
    storyFiredRef.current = true;
    onStoryReady?.();
  }, [current, onStoryReady]);

  // A new poster set (fresh scrape or new done-stage sample) restarts the batch
  // reveal from zero; every timer below lives in an effect with cleanup so fast
  // replays never stack stale reveals (audit decision 5).
  useEffect(() => {
    setRevealedBatches(0);
  }, [posterSignature]);

  // Batch reveal pacing: first batch after the entrance beat, then one batch
  // per interval until all are visible. Reduced motion shows everything at once.
  useEffect(() => {
    if (!animate) return;
    if (batches.length === 0 || revealedBatches >= batches.length) return;
    const delay = revealedBatches === 0 ? FIRST_BATCH_DELAY_MS : BATCH_INTERVAL_MS;
    const id = window.setTimeout(() => setRevealedBatches((value) => value + 1), delay);
    return () => window.clearTimeout(id);
  }, [animate, revealedBatches, batches.length]);

  // Count settle trails the poster appearance by COUNT_SETTLE_MS. Without any
  // posters it still settles on confirmed counts alone.
  useEffect(() => {
    if (!started || current === 'queued' || current === 'intro') return;
    const next = reveal.filmsFound ?? null;
    if (!animate) {
      setSettledFilms((previous) => (previous === next ? previous : next));
      return;
    }
    if (posters.length > 0 && shownBatches === 0) return;
    const id = window.setTimeout(
      () => setSettledFilms((previous) => (previous === next ? previous : next)),
      COUNT_SETTLE_MS,
    );
    return () => window.clearTimeout(id);
  }, [animate, started, current, reveal.filmsFound, shownBatches, posters.length]);

  // Queued = nothing started yet; otherwise the spec drives the progress segments.
  const activeIndex = current === 'queued' ? -1 : (spec?.activeIndex ?? -1);

  const label = t(
    current === 'queued' ? 'landing.storyWait.queued' : PHASE_SPEC[current].labelKey,
  ).replace('{username}', handle);
  // Under animation the number only shows once settled (80–120ms after its
  // posters); reduced motion reads the live value directly.
  const shownCount = animate ? settledFilms : reveal.filmsFound;
  const countLabel =
    shownCount != null
      ? `${shownCount.toLocaleString()} ${t('landing.loading.filmsFound')}`
      : null;
  const reviewLabel =
    reveal.reviewsFound != null
      ? t('landing.storyWait.reviewsCount').replace('{count}', String(reveal.reviewsFound))
      : null;

  const showPosters = current !== 'queued' && current !== 'intro' && reveal.posters.length > 0;
  const showItems =
    !showPosters && current !== 'queued' && current !== 'intro' && reveal.items.length > 0;
  // Exactly one dominant motion per phase (audit decision 1). The progress
  // shimmer may run only when pulse itself is that dominant motion.
  const dropActive = current !== 'queued' && PHASE_SPEC[current].dominant === 'posterDrop' && animate;
  const shimmerActive = current !== 'queued' && PHASE_SPEC[current].dominant === 'pulse' && animate;
  const enterActive = animate && !leaving && current !== 'queued';

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-dvh flex-col bg-[#1a1a1a] px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] text-white"
      data-testid="scrape-story-wait"
      data-beat={current}
      data-started={started ? 'true' : 'false'}
    >
      <style>{`
        @keyframes mw-wait-fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes mw-wait-fade-out {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes mw-wait-poster-drop {
          from { opacity: 0; transform: translateY(-14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes mw-wait-drift {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(0, -6%, 0); }
        }
        @keyframes mw-progress-shimmer {
          from { transform: translateX(-110%); }
          to { transform: translateX(450%); }
        }
        .mw-wait-enter { animation: mw-wait-fade-in 0.7s ease-out both; }
        .mw-wait-exit { animation: mw-wait-fade-out ${EXIT_MS}ms ease-in both; }
        .mw-wait-drop { animation: mw-wait-poster-drop 0.45s ease-out both; }
        .mw-wait-poster { animation: mw-wait-drift 18s ease-in-out infinite alternate; }
        .mw-wait-seg-active { animation: mw-progress-shimmer 2.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .mw-wait-enter, .mw-wait-exit, .mw-wait-drop, .mw-wait-poster, .mw-wait-seg-active { animation: none; }
        }
      `}</style>

      <header className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-medium text-white/70">@{handle}</p>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-white/15 px-3 text-sm text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            <X className="h-4 w-4" aria-hidden />
            {t('landing.loading.cancel')}
          </button>
        )}
      </header>

      <div
        role="progressbar"
        aria-label={t('landing.loading.progress')}
        aria-valuemin={0}
        aria-valuemax={PROGRESS_STAGES.length}
        aria-valuenow={Math.max(0, Math.min(activeIndex, PROGRESS_STAGES.length))}
        className="mt-4 flex gap-1"
      >
        {PROGRESS_STAGES.map((stage, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
          return (
            <div
              key={stage}
              data-testid={`wait-progress-${stage}`}
              data-state={state}
              className="h-0.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10"
            >
              {state === 'done' && <div className="h-full w-full bg-amber-300" />}
              {state === 'active' && (
                <div
                  data-testid={`wait-progress-fill-${stage}`}
                  className={
                    shimmerActive
                      ? 'h-full w-1/4 bg-amber-300 mw-wait-seg-active'
                      : 'h-full w-1/4 bg-amber-300 opacity-70'
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      <div
        key={current}
        className={`${leaving ? 'mw-wait-exit' : enterActive ? 'mw-wait-enter' : ''} mx-auto flex w-full max-w-md flex-1 flex-col justify-center pt-8`}
      >
        <p className="text-xs uppercase tracking-[0.2em] text-white/45">{t('landing.storyWait.kicker')}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{label}</h1>
        {/* Counter renders as plain text here; the sparse emphasis bump is L2 scope
            and must not stack with this phase's dominant motion. */}
        {countLabel && current !== 'queued' && current !== 'intro' && (
          <p className="mt-3 text-lg text-orange-300">{countLabel}</p>
        )}
        {reviewLabel &&
          (current === 'reviews' || current === 'analyzing' || current === 'ready' || current === 'story') && (
            <p className="mt-1 text-sm text-white/60">{reviewLabel}</p>
          )}

        {showPosters && (
          <ul data-testid="wait-poster-grid" className="mt-8 grid grid-cols-4 gap-2">
            {/* Fixed 2:3 slots reserved upfront — a poster arriving never shifts layout. */}
            {Array.from({ length: MAX_POSTERS }, (_, slot) => {
              const item = batches.slice(0, shownBatches).flat()[slot];
              return (
                <li
                  key={slot}
                  className={`${dropActive ? 'mw-wait-drop' : ''} aspect-[2/3] overflow-hidden rounded-md bg-white/5`}
                >
                  {item && (
                    <img
                      src={item.poster_url}
                      alt=""
                      width={120}
                      height={180}
                      decoding="async"
                      loading="lazy"
                      className={animate ? 'mw-wait-poster h-full w-full object-cover' : 'h-full w-full object-cover'}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {showItems && (
          <ul className="mt-8 space-y-2 text-sm text-white/75">
            {reveal.items.map((item) => (
              <li key={item.title}>
                {item.title}
                {item.year ? ` (${item.year})` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!finished && (
        <p className="mt-6 text-center text-xs text-white/40">{formatElapsed(elapsed, t)}</p>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';

import { slideMeta } from '@/components/story/manifest';
import { useStoryMachine } from '@/components/story/useStoryMachine';
import { AUTO_MIN_MS, SLIDE_MS, PRELOAD_AHEAD } from '@/components/story/constants';
import { buildSlides } from '@/components/story/slides/buildSlides';
import { StoryNavigation } from '@/components/story/StoryNavigation';
import { StorySlidePanel } from '@/components/story/StorySlidePanel';
import { StoryTopChrome } from '@/components/story/StoryTopChrome';
import { PersonSlidePhaseProvider } from '@/components/story/person/PersonSlidePhaseContext';
import { ReviewSlidePhaseProvider } from '@/components/story/review/ReviewSlidePhaseContext';
import { FinaleSlidePhaseProvider } from '@/components/story/finale/FinaleSlidePhaseContext';
import { StoryMotionProvider } from '@/components/story/motion/StoryMotionContext';
import { MOTION_DURATION } from '@/components/story/motion/motionTokens';
import { createTransitionGate, type TransitionGate } from '@/components/story/motion/transitionGate';
import { StoryVisual } from '@/components/story/visuals/StoryVisual';
import { useI18n } from '@/i18n/I18nProvider';

/** Scene crossfade wall-clock lock (audit band 480–620ms). */
const SCENE_TRANSITION_MS = Math.round(MOTION_DURATION.transition * 1000);

export default function StoryExperience() {
  const i18n = useI18n();
  const { t } = i18n;
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const elapsedRef = useRef(0);
  const indexRef = useRef(0);
  const gateRef = useRef<TransitionGate | null>(null);
  if (!gateRef.current) gateRef.current = createTransitionGate(SCENE_TRANSITION_MS);
  const sceneGate = gateRef.current;

  useEffect(() => () => sceneGate.dispose(), [sceneGate]);
  const { phase, stats, start } = useStoryMachine();

  useEffect(() => {
    if (phase === 'ready') start();
  }, [phase, start]);

  const slides = useMemo(() => (stats ? buildSlides(stats, i18n) : []), [i18n, stats]);
  const isLast = index >= slides.length - 1;
  const username = stats?.scraped_username;
  const currentInteraction = slideMeta(slides[index]?.key ?? '').interaction;

  // Audit decision 2: a scene crossfade never overlaps the previous one.
  // Navigations mid-transition queue behind it (latest target wins).
  const goToSlide = useCallback((nextIndex: number) => {
    const clamped = Math.max(0, Math.min(nextIndex, slides.length - 1));
    if (clamped === indexRef.current) return;
    sceneGate.tryBegin(() => {
      // Re-check on queue flush: the latest target may equal the settled slide.
      if (clamped === indexRef.current) return;
      indexRef.current = clamped;
      setIndex(clamped);
      elapsedRef.current = 0;
      setProgress(0);
      setIsPaused(false);
    });
  }, [sceneGate, slides.length]);

  const goNext = useCallback(() => {
    if (currentInteraction === 'auto-min' && elapsedRef.current < AUTO_MIN_MS) return;
    goToSlide(index + 1);
  }, [currentInteraction, goToSlide, index]);
  const goPrevious = useCallback(() => goToSlide(index - 1), [goToSlide, index]);

  useEffect(() => {
    elapsedRef.current = isLast ? SLIDE_MS : 0;
    setProgress(isLast ? 100 : 0);
  }, [index, isLast]);

  useEffect(() => {
    if (slides.length === 0 || isLast || isPaused || phase !== 'playing' || currentInteraction === 'manual') return;
    let frame = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      const delta = Math.max(0, now - previous);
      previous = now;
      elapsedRef.current = Math.min(SLIDE_MS, elapsedRef.current + delta);
      const nextProgress = (elapsedRef.current / SLIDE_MS) * 100;
      setProgress(nextProgress);
      if (elapsedRef.current >= SLIDE_MS) {
        goToSlide(indexRef.current + 1);
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [goToSlide, index, slides.length, isLast, isPaused, phase, currentInteraction]);

  useEffect(() => {
    if (slides.length === 0) return;
    const urls = new Set<string>();
    for (let i = index; i <= Math.min(index + PRELOAD_AHEAD, slides.length - 1); i += 1) {
      for (const item of slides[i]?.media?.slice(0, 12) ?? []) urls.add(item.url);
    }
    for (const url of urls) {
      const img = new Image();
      img.src = url;
    }
  }, [index, slides]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') goNext();
      if (event.key === 'ArrowLeft') goPrevious();
      if (event.key === ' ') {
        event.preventDefault();
        if (!isLast) setIsPaused((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrevious, isLast]);

  if (phase === 'idle') return null;

  if (!stats || slides.length === 0) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#0f0d0b] p-8 text-center">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-stone-500">{t('story.empty.title')}</p>
          <p className="mt-3 text-sm text-stone-400">{t('story.empty.description')}</p>
        </div>
      </main>
    );
  }

  const activeSlide = slides[index];

  return (
    <StoryMotionProvider paused={isPaused}>
    <PersonSlidePhaseProvider
      sequence={activeSlide.directorSequence ?? activeSlide.actorSequence ?? null}
      slideKey={activeSlide.key}
      paused={isPaused}
    >
    <ReviewSlidePhaseProvider
      sequence={activeSlide.reviewSequence ?? null}
      slideKey={activeSlide.key}
      paused={isPaused}
    >
    <FinaleSlidePhaseProvider
      sequence={activeSlide.finaleSequence ?? null}
      slideKey={activeSlide.key}
      paused={isPaused}
    >
    <main className="story-viewport relative grid select-none overflow-x-clip overflow-y-hidden bg-[#0f0d0b] [grid-template-rows:auto_minmax(0,1fr)_auto]">
      <div className="pointer-events-none absolute inset-0 z-0">
        {/* Sync mode: outgoing and incoming fade overlap into one scene-band
            crossfade; the transition gate keeps transitions from stacking. */}
        <AnimatePresence>
          <StoryVisual key={`bg-${activeSlide.key}`} slide={activeSlide} />
        </AnimatePresence>
      </div>

      <StoryTopChrome
        slides={slides}
        index={index}
        progress={progress}
        isPaused={isPaused}
        isLast={isLast}
        onTogglePause={() => !isLast && setIsPaused((v) => !v)}
      />

      <StorySlidePanel
        slide={activeSlide}
        isLast={isLast}
        stats={stats}
        showTapHint={currentInteraction === 'manual'}
      />

      {!isLast && (
        <div className="relative z-20" style={{ height: 'max(0.55rem, env(safe-area-inset-bottom, 0px))' }} />
      )}

      <StoryNavigation
        isLast={isLast}
        username={username}
        locale={i18n.locale}
        onPrevious={goPrevious}
        onNext={goNext}
        onReplay={() => goToSlide(0)}
      />
    </main>
    </FinaleSlidePhaseProvider>
    </ReviewSlidePhaseProvider>
    </PersonSlidePhaseProvider>
    </StoryMotionProvider>
  );
}

export { buildSlides } from '@/components/story/slides/buildSlides';
export { AUTO_MIN_MS } from '@/components/story/constants';

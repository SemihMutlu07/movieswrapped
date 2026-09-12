'use client';

import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import StoryFinaleCard from '@/components/story/StoryFinaleCard';
import type { StatsData } from '@/containers/results/sections/types';
import { useI18n } from '@/i18n/I18nProvider';

import type { Slide } from './types';
import { DirectorSlideBody } from './director/DirectorSlideBody';
import { ActorSlideBody } from './actor/ActorSlideBody';
import { ReviewSlideBody } from './review/ReviewSlideBody';
import { FinaleSlideBody } from './finale/FinaleSlideBody';
import { MOTION_DURATION, MOTION_EASE } from './motion/motionTokens';
import { useStoryMotion } from './motion/StoryMotionContext';
import { Hint } from './SlideTypography';
import { MobileMediaRail } from './visuals/MobileMediaRail';

type StorySlidePanelProps = {
  slide: Slide;
  isLast: boolean;
  stats: StatsData;
  showTapHint: boolean;
};

function SlideCopy({ slide }: { slide: Slide }) {
  if (slide.finaleSequence) return <FinaleSlideBody />;
  if (slide.directorSequence) return <DirectorSlideBody />;
  if (slide.actorSequence) return <ActorSlideBody />;
  if (slide.reviewSequence) return <ReviewSlideBody />;
  return slide.body;
}

export function StorySlidePanel({ slide, isLast, stats, showTapHint }: StorySlidePanelProps) {
  const { t } = useI18n();
  const { reduce, paused } = useStoryMotion();
  const instant = reduce || paused;
  const isPerson = slide.visual === 'person' || slide.visual === 'director' || slide.visual === 'actor';
  const accent = slide.accent ?? '#f59e0b';

  return (
    <div
      data-testid="story-slide-stage"
      data-story-key={slide.key}
      data-story-last={isLast ? 'true' : 'false'}
      className="relative z-20 flex h-full min-h-0 min-w-0 w-full overflow-x-clip px-3 md:px-10 md:py-6"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={slide.key}
          initial={instant ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={instant ? { opacity: 0 } : { opacity: 0, y: -10 }}
          transition={{
            duration: instant ? 0 : MOTION_DURATION.panelEnter,
            ease: MOTION_EASE.snap,
          }}
          style={{ ['--story-accent']: accent } as CSSProperties}
          className={`@container flex h-full max-h-full min-h-0 min-w-0 w-full flex-col ${
            isLast
              ? 'mx-auto max-w-md md:ml-[4vw] md:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl'
              : `mx-auto max-w-xl text-center md:mx-0 md:my-auto md:h-auto md:rounded-[28px] md:border md:border-white/10 md:bg-black/60 md:px-8 md:py-8 md:text-left md:backdrop-blur-xl md:shadow-[inset_3px_0_0_0_var(--story-accent),0_26px_60px_-18px_rgba(0,0,0,0.7)] ${
                  isPerson ? 'md:ml-[6vw] md:max-w-lg' : 'md:ml-[8vw]'
                }`
          }`}
        >
          {isLast ? (
            <>
              <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
                <StoryFinaleCard stats={stats} />
              </div>
              <div className="hidden min-w-0 shrink-0 text-center md:mt-3 md:block md:text-left">
                <SlideCopy slide={slide} />
              </div>
            </>
          ) : (
            <>
              <div className="min-w-0 shrink-0">
                <MobileMediaRail media={slide.media ?? []} accent={slide.accent ?? '#f59e0b'} />
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center">
                <div className="min-w-0">
                  <SlideCopy slide={slide} />
                </div>
                {showTapHint && (
                  <Hint className="mt-4 pt-2 text-amber-300/80 md:mt-5 md:pt-0">
                    {t('story.tapToContinue')}
                  </Hint>
                )}
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

'use client';

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
  const { reduce } = useStoryMotion();
  const isPerson = slide.visual === 'person' || slide.visual === 'director';

  return (
    <div
      data-testid="story-slide-stage"
      data-story-last={isLast ? 'true' : 'false'}
      className="relative z-20 flex h-full min-h-0 min-w-0 w-full overflow-x-clip px-3 md:px-10 md:py-6"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={slide.key}
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
          transition={{
            duration: reduce ? 0 : MOTION_DURATION.panelEnter,
            ease: MOTION_EASE.snap,
          }}
          className={`@container flex h-full max-h-full min-h-0 min-w-0 w-full flex-col ${
            isLast
              ? 'mx-auto max-w-md md:ml-[5vw] md:max-w-2xl'
              : `mx-auto max-w-xl rounded-[24px] border border-white/10 bg-black/55 px-[clamp(1.05rem,4.5vw,1.75rem)] py-[clamp(1rem,3svh,1.85rem)] text-center shadow-2xl shadow-black/40 backdrop-blur-md md:mx-0 md:h-auto md:my-auto md:rounded-[28px] md:bg-black/42 md:px-8 md:py-8 md:text-left ${
                  isPerson ? 'md:ml-[6vw] md:max-w-lg' : 'md:ml-[8vw]'
                }`
          }`}
        >
          {isLast ? (
            <>
              <div className="flex min-h-0 min-w-0 flex-[1.85] items-center justify-center py-1">
                <StoryFinaleCard stats={stats} />
              </div>
              <div className="min-w-0 shrink-0 text-center md:mt-3 md:text-left">
                <SlideCopy slide={slide} />
              </div>
            </>
          ) : (
            <>
              <div className="min-w-0 shrink-0">
                <MobileMediaRail media={slide.media ?? []} accent={slide.accent ?? '#f59e0b'} />
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="min-w-0">
                  <SlideCopy slide={slide} />
                </div>
                {showTapHint && (
                  <Hint className="mt-auto pt-4 text-amber-300/80 md:mt-5 md:pt-0">
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

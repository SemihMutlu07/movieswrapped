'use client';

import { motion } from 'framer-motion';

import type { ReviewSequenceData } from '../types';
import { useReviewSlidePhase } from './ReviewSlidePhaseContext';
import type { ReviewPhase } from './reviewPhases';
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_STAGGER,
} from '../motion/motionTokens';
import { StoryImage } from '../visuals/StoryImage';

const STREAM_VISIBLE = 6;

function heroScale(phase: ReviewPhase, reduce: boolean): number {
  if (reduce) return 1;
  if (phase === 'textReveal') return 0.9;
  if (phase === 'heroIntro') return 1.06;
  return 1;
}

function heroOpacity(phase: ReviewPhase, reduce: boolean, hasHero: boolean): number {
  if (!hasHero) return 0;
  if (reduce) return 1;
  if (phase === 'textReveal') return 0;
  return 1;
}

function showPosterStream(phase: ReviewPhase, reduce: boolean): boolean {
  if (reduce) return true;
  return phase === 'streamBurst' || phase === 'streamAmbient' || phase === 'final';
}

export function ReviewCinematicVisual({
  sequence,
  accent,
}: {
  sequence: ReviewSequenceData;
  accent: string;
}) {
  const { phase, reduce } = useReviewSlidePhase();
  const posters = sequence.streamPosters.slice(0, STREAM_VISIBLE);
  const hasHero = Boolean(sequence.heroPoster);
  const streamVisible = showPosterStream(phase, reduce);

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-y-[10%] left-0 z-0 grid w-[54%] grid-cols-3 grid-rows-2 content-center gap-3">
        {streamVisible &&
          posters.map((item, index) => (
            <motion.div
              key={item.url}
              className="aspect-[2/3] w-full overflow-hidden rounded-[14px] border border-white/10 bg-black shadow-xl"
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 0.92, y: 0 }}
              transition={{
                duration: reduce ? 0 : MOTION_DURATION.streamBurst,
                delay: reduce ? 0 : index * MOTION_STAGGER.streamPoster,
                ease: MOTION_EASE.snap,
              }}
            >
              <StoryImage item={item} priority={index < 3} />
            </motion.div>
          ))}
      </div>

      {sequence.heroPoster && (
        <motion.div
          className="absolute right-[2%] top-1/2 z-20 aspect-[2/3] w-[36%] max-h-[72%] -translate-y-1/2 overflow-hidden rounded-[28px] border border-white/15 bg-black shadow-2xl"
          style={{ boxShadow: `0 0 90px ${accent}55` }}
          initial={false}
          animate={{
            opacity: heroOpacity(phase, reduce, hasHero),
            scale: heroScale(phase, reduce),
          }}
          transition={{ duration: reduce ? 0 : MOTION_DURATION.transition, ease: MOTION_EASE.editorial }}
        >
          <StoryImage item={sequence.heroPoster} priority />
        </motion.div>
      )}
    </div>
  );
}

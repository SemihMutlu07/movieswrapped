'use client';

import { motion } from 'framer-motion';

import type { ReviewSequenceData } from '../types';
import { useReviewSlidePhase } from './ReviewSlidePhaseContext';
import type { ReviewPhase } from './reviewPhases';
import { useStoryMotion } from '../motion/StoryMotionContext';
import {
  MOTION_AMBIENT,
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_STAGGER,
  ambientLoopTransition,
} from '../motion/motionTokens';
import { usePosterField } from '../visuals/PosterFieldContext';
import { StoryImage } from '../visuals/StoryImage';

const STREAM_LAYOUT = [
  { left: '2%', top: '6%', rotate: -10, scale: 0.82 },
  { left: '18%', top: '2%', rotate: 6, scale: 0.78 },
  { left: '34%', top: '14%', rotate: -4, scale: 0.86 },
  { left: '0%', top: '32%', rotate: 8, scale: 0.8 },
  { left: '22%', top: '38%', rotate: -6, scale: 0.84 },
  { left: '38%', top: '28%', rotate: 5, scale: 0.76 },
  { left: '6%', top: '52%', rotate: -7, scale: 0.83 },
  { left: '26%', top: '58%', rotate: 4, scale: 0.79 },
  { left: '42%', top: '48%', rotate: -5, scale: 0.77 },
  { left: '10%', top: '72%', rotate: 9, scale: 0.81 },
  { left: '30%', top: '78%', rotate: -8, scale: 0.75 },
  { left: '48%', top: '66%', rotate: 3, scale: 0.8 },
] as const;

function heroLeft(phase: ReviewPhase, reduce: boolean): string {
  if (reduce || phase === 'compose' || phase === 'streamBurst' || phase === 'streamAmbient' || phase === 'final') {
    return '42%';
  }
  if (phase === 'heroIntro') return '16%';
  return '24%';
}

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
  const { phase, reduce, paused } = useReviewSlidePhase();
  const { ambientActive } = useStoryMotion();
  const { motionScale = 1 } = usePosterField();
  const posters = sequence.streamPosters;
  const hasHero = Boolean(sequence.heroPoster);
  const streamVisible = showPosterStream(phase, reduce);
  const ambient = !reduce && (phase === 'streamAmbient' || phase === 'final') && !paused && ambientActive;

  return (
    <div className="relative h-full w-full">
      <motion.div
        className="absolute inset-0 z-0"
        initial={false}
        animate={ambient ? { x: ['-3%', '3%', '-3%'] } : { x: '0%' }}
        transition={
          ambient
            ? ambientLoopTransition(MOTION_AMBIENT.streamPan, motionScale, true)
            : { duration: 0 }
        }
      >
        {streamVisible &&
          posters.map((item, index) => {
            const slot = STREAM_LAYOUT[index % STREAM_LAYOUT.length];
            return (
              <motion.div
                key={item.url}
                className="absolute aspect-[2/3] w-[22%] overflow-hidden rounded-[14px] border border-white/10 bg-black shadow-xl"
                style={{
                  left: slot.left,
                  top: slot.top,
                  rotate: slot.rotate,
                }}
                initial={reduce ? false : { opacity: 0, scale: slot.scale * 0.72, x: -28 }}
                animate={{ opacity: 0.9, scale: slot.scale, x: 0 }}
                transition={{
                  duration: reduce ? 0 : MOTION_DURATION.streamBurst,
                  delay: reduce ? 0 : index * MOTION_STAGGER.streamPoster,
                  ease: MOTION_EASE.snap,
                }}
              >
                <StoryImage item={item} priority={index < 4} />
              </motion.div>
            );
          })}
      </motion.div>

      <div
        className="pointer-events-none absolute inset-y-[4%] z-10 w-[58%] bg-gradient-to-r from-transparent via-black/25 to-black/55"
        style={{ left: '10%' }}
      />

      {sequence.heroPoster && (
        <motion.div
          className="absolute top-1/2 z-20 aspect-[2/3] w-[46%] max-h-[78vh] min-h-[42vh] -translate-y-1/2 overflow-hidden rounded-[30px] border border-white/15 bg-black shadow-2xl"
          style={{ boxShadow: `0 0 90px ${accent}55` }}
          initial={false}
          animate={{
            left: heroLeft(phase, reduce),
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

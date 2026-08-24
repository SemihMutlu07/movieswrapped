'use client';

import { motion } from 'framer-motion';

import type { FinaleSequenceData } from '../types';
import { useFinaleSlidePhase } from './FinaleSlidePhaseContext';
import type { FinalePhase } from './finalePhases';
import { showFinaleCurtain } from './finalePhases';
import { MOTION_DURATION, MOTION_EASE, MOTION_STAGGER } from '../motion/motionTokens';
import { StoryImage } from '../visuals/StoryImage';

const CURTAIN_LAYOUT = [
  { left: '4%', top: '10%', rotate: -8, scale: 0.72 },
  { left: '22%', top: '4%', rotate: 5, scale: 0.68 },
  { left: '40%', top: '14%', rotate: -3, scale: 0.74 },
  { left: '58%', top: '8%', rotate: 7, scale: 0.7 },
  { left: '2%', top: '38%', rotate: 6, scale: 0.7 },
  { left: '20%', top: '44%', rotate: -5, scale: 0.73 },
  { left: '38%', top: '36%', rotate: 4, scale: 0.69 },
  { left: '56%', top: '42%', rotate: -6, scale: 0.71 },
] as const;

function curtainOpacity(phase: FinalePhase, reduce: boolean): number {
  if (!showFinaleCurtain(phase, reduce)) return 0;
  if (reduce) return 0.55;
  if (phase === 'curtainFade') return 0.45;
  return 0.55;
}

export function FinaleCurtainVisual({
  sequence,
  accent,
}: {
  sequence: FinaleSequenceData;
  accent: string;
}) {
  const { phase, reduce } = useFinaleSlidePhase();
  const posters = sequence.curtainPosters;
  const visible = showFinaleCurtain(phase, reduce);
  const targetOpacity = curtainOpacity(phase, reduce);

  return (
    <div className="relative h-full w-full">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 40%, ${accent}18, transparent 55%)`,
        }}
      />
      {visible &&
        posters.map((item, index) => {
          const slot = CURTAIN_LAYOUT[index % CURTAIN_LAYOUT.length];
          return (
            <motion.div
              key={item.url}
              className="absolute aspect-[2/3] w-[18%] overflow-hidden rounded-[12px] border border-white/8 bg-black shadow-lg"
              style={{
                left: slot.left,
                top: slot.top,
                rotate: slot.rotate,
              }}
              initial={reduce ? false : { opacity: 0, scale: slot.scale * 0.88 }}
              animate={{ opacity: targetOpacity, scale: slot.scale }}
              transition={{
                duration: reduce ? 0 : MOTION_DURATION.reveal,
                delay: reduce ? 0 : index * MOTION_STAGGER.curtainPoster,
                ease: MOTION_EASE.editorial,
              }}
            >
              <StoryImage item={item} priority={index < 4} />
            </motion.div>
          );
        })}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-black/20 to-black/65" />
    </div>
  );
}

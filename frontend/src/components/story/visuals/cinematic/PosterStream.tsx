'use client';

import { motion, useReducedMotion } from 'framer-motion';

import type { StoryMedia } from '../../types';
import { MOTION_AMBIENT, MOTION_DURATION } from '../../motion/motionTokens';

const AMBIENT_DRIFT_CAP = MOTION_AMBIENT.streamPan;
import { StoryImage } from '../StoryImage';

type PosterStreamProps = {
  posters: StoryMedia[];
  accent: string;
  /** When false, ambient loops pause (inactive slide / reduced work). */
  active: boolean;
  /** 0..1 how far into the reveal — drives entrance → ambient. */
  settle: number;
  className?: string;
};

const MAX_UNIQUE = 14;
const COLUMN_COUNT = 3;

function columnFor(index: number, total: number): number {
  // Distribute across columns without packing everything to the right.
  if (total <= 3) return index % Math.max(total, 1);
  return index % COLUMN_COUNT;
}

/**
 * Vertical poster field: quick entrance, then slower ambient drift.
 * Caps DOM nodes; never fabricates unique titles.
 */
export function PosterStream({ posters, accent, active, settle, className = '' }: PosterStreamProps) {
  const reduce = useReducedMotion();
  const unique = posters.slice(0, MAX_UNIQUE);
  if (unique.length === 0) return null;

  const columns: StoryMedia[][] = Array.from({ length: Math.min(COLUMN_COUNT, unique.length) }, () => []);
  unique.forEach((poster, index) => {
    columns[columnFor(index, unique.length)]!.push(poster);
  });

  const ambient = settle >= 1 && active && !reduce;

  return (
    <div className={`pointer-events-none absolute inset-y-[-12%] left-[8%] right-[-6%] md:left-[4%] lg:left-0 ${className}`}>
      <div className="grid h-full grid-cols-3 gap-2 sm:gap-3 md:gap-3 lg:gap-4">
        {columns.map((col, colIndex) => {
          // Ambient drift stays inside the 16–24s tier band.
          const duration = reduce ? 0 : ambient ? Math.min(18 + colIndex * 4, AMBIENT_DRIFT_CAP) : MOTION_DURATION.revealFast;
          const travel = reduce ? 0 : ambient ? (colIndex % 2 === 0 ? -48 : 56) : 0;
          return (
            <motion.div
              key={`col-${colIndex}`}
              className="flex flex-col gap-3"
              style={{ marginTop: colIndex === 1 ? '8%' : colIndex === 2 ? '-4%' : '2%' }}
              initial={reduce ? false : { y: 80 + colIndex * 24, opacity: 0 }}
              animate={{
                y: ambient ? [0, travel, 0] : 0,
                opacity: settle > 0 ? 1 : 0,
              }}
              transition={
                ambient
                  ? { duration, repeat: Infinity, ease: 'easeInOut' }
                  : { duration: MOTION_DURATION.fieldEnter, ease: [0.22, 1, 0.36, 1], delay: colIndex * 0.08 }
              }
            >
              {col.map((item, index) => (
                <motion.div
                  key={`${item.url}-${index}`}
                  initial={reduce ? false : { y: 40, opacity: 0, rotate: colIndex % 2 ? -3 : 3 }}
                  animate={{
                    y: 0,
                    opacity: settle > 0 ? 1 : 0,
                    rotate: colIndex === 1 ? -2 : colIndex === 2 ? 3 : 1.5,
                  }}
                  transition={{
                    duration: reduce ? 0 : 0.55,
                    delay: reduce ? 0 : Math.min(index * 0.06 + colIndex * 0.05, 0.45),
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="relative aspect-[2/3] w-full overflow-hidden rounded-[14px] border border-white/10 bg-black shadow-xl"
                  style={{
                    boxShadow: index === 0 && colIndex === 0 ? `0 0 70px ${accent}44` : undefined,
                  }}
                >
                  <StoryImage item={item} priority={index < 2 && colIndex < 2} />
                </motion.div>
              ))}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

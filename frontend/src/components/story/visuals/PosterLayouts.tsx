'use client';

import { motion, useReducedMotion } from 'framer-motion';

import type { StoryMedia } from '../types';
import { useStoryMotion } from '../motion/StoryMotionContext';
import {
  MOTION_AMBIENT,
  MOTION_DURATION,
  MOTION_EASE,
  scaledDuration,
  verticalDriftTransition,
} from '../motion/motionTokens';
import { usePosterField } from './PosterFieldContext';
import { StoryImage } from './StoryImage';
import { PersonCinematicVisual } from './cinematic/PersonCinematicVisual';

function verticalRest(index: number, amplitude = 18) {
  const sign = index % 2 ? 1 : -1;
  return sign * amplitude;
}

function verticalDrift(index: number, amplitude = 18) {
  const sign = index % 2 ? 1 : -1;
  return sign * (amplitude + 8);
}

export function PosterMosaic({ media, accent }: { media: StoryMedia[]; accent: string }) {
  const { motionScale = 1 } = usePosterField();
  const { ambientActive, reduce } = useStoryMotion();

  return (
    <div className="grid h-full auto-rows-max grid-cols-3 content-center gap-3">
      {media.slice(0, 9).map((item, index) => {
        const rest = verticalRest(index, 16);
        const drift = verticalDrift(index, 16);
        return (
          <motion.div
            key={`${item.url}-${index}`}
            initial={reduce ? false : { opacity: 0, y: rest + (index % 2 ? 24 : -20) }}
            animate={
              ambientActive
                ? { opacity: 1, y: [rest, drift, rest] }
                : { opacity: 1, y: rest }
            }
            transition={{
              opacity: { duration: reduce ? 0 : MOTION_DURATION.revealFast, ease: MOTION_EASE.snap },
              y: verticalDriftTransition(MOTION_AMBIENT.verticalMosaic, index, motionScale, ambientActive),
            }}
            className="relative aspect-[2/3] overflow-hidden rounded-[18px] border border-white/10 bg-stone-950 shadow-2xl"
            style={{ boxShadow: index === 4 ? `0 0 70px ${accent}55` : undefined }}
          >
            <StoryImage item={item} priority={index < 3} />
          </motion.div>
        );
      })}
    </div>
  );
}

export function PosterWall({ media, accent }: { media: StoryMedia[]; accent: string }) {
  const { motionScale = 1 } = usePosterField();
  const { reduce } = useStoryMotion();

  return (
    <div className="grid h-full grid-cols-[repeat(auto-fit,minmax(86px,1fr))] content-center gap-3">
      {media.map((item, index) => {
        const rest = index % 2 ? 10 : -6;
        return (
          <motion.div
            key={`${item.url}-${index}`}
            initial={reduce ? false : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: rest }}
            transition={{
              delay: reduce ? 0 : Math.min(index * 0.032, 0.45),
              duration: reduce ? 0 : scaledDuration(MOTION_DURATION.revealFast, motionScale),
              ease: MOTION_EASE.snap,
            }}
            className="aspect-[2/3] min-h-0 overflow-hidden rounded-[16px] border border-white/10 bg-black shadow-2xl"
            style={{ boxShadow: index === 0 ? `0 0 80px ${accent}66` : undefined }}
          >
            <StoryImage item={item} priority={index < 6} />
          </motion.div>
        );
      })}
    </div>
  );
}

/** @deprecated Prefer PersonCinematicVisual via visual="person" — kept for fallback. */
export function DirectorVisual({ media, accent, sequenceKey = 'director' }: { media: StoryMedia[]; accent: string; sequenceKey?: string }) {
  return <PersonCinematicVisual media={media} accent={accent} sequenceKey={sequenceKey} />;
}

export function PosterCascade({ media, accent }: { media: StoryMedia[]; accent: string }) {
  const { motionScale = 1, density = 1 } = usePosterField();
  const { ambientActive, reduce } = useStoryMotion();
  const maxVisible = Math.round(42 * density);
  const visible = media.slice(0, maxVisible);
  if (visible.length === 0) return null;

  const gapClass = density >= 1 ? 'gap-3' : density >= 0.85 ? 'gap-2.5' : 'gap-2';

  return (
    <div className="relative h-full">
      <div className={`absolute inset-y-[-8%] left-[0%] w-[92%] grid grid-cols-6 ${gapClass}`}>
        {visible.map((item, index) => {
          const restY = verticalRest(index, 34);
          const driftY = verticalDrift(index, 34);
          const restX = index % 3 === 0 ? -14 : 12;
          const driftX = index % 3 === 0 ? 16 : -12;
          return (
            <motion.div
              key={`${item.url}-${index}`}
              initial={
                reduce
                  ? false
                  : { opacity: 0, y: restY + (index % 2 ? 28 : -32), x: restX - 6 }
              }
              animate={
                ambientActive
                  ? { opacity: 1, y: [restY, driftY, restY], x: [restX, driftX, restX] }
                  : { opacity: 1, y: restY, x: restX }
              }
              transition={{
                opacity: { duration: reduce ? 0 : MOTION_DURATION.revealFast, ease: MOTION_EASE.snap },
                y: verticalDriftTransition(MOTION_AMBIENT.verticalCascade, index, motionScale, ambientActive),
                x: verticalDriftTransition(MOTION_AMBIENT.verticalCascade + 1.5, index, motionScale, ambientActive),
              }}
              className="aspect-[2/3] overflow-hidden rounded-[14px] border border-white/10 bg-black shadow-xl"
              style={{ boxShadow: index === 0 ? `0 0 90px ${accent}66` : undefined }}
            >
              <StoryImage item={item} priority={index < 10} />
            </motion.div>
          );
        })}
      </div>
      <div className="absolute inset-y-0 right-0 w-[38%] bg-gradient-to-l from-black/40 to-transparent" />
    </div>
  );
}

export function PosterStrip({ media, accent }: { media: StoryMedia[]; accent: string }) {
  const { motionScale = 1 } = usePosterField();
  const { ambientActive, reduce } = useStoryMotion();

  return (
    <div className="flex h-full items-center gap-3 pl-[2%]">
      {media.slice(0, 7).map((item, index) => {
        const rest = verticalRest(index, 22);
        const drift = verticalDrift(index, 22);
        return (
          <motion.div
            key={`${item.url}-${index}`}
            initial={reduce ? false : { opacity: 0, y: rest + (index % 2 ? 30 : -18) }}
            animate={
              ambientActive
                ? { opacity: 1, y: [rest, drift, rest] }
                : { opacity: 1, y: rest }
            }
            transition={{
              opacity: { duration: reduce ? 0 : MOTION_DURATION.revealFast, ease: MOTION_EASE.snap },
              y: verticalDriftTransition(MOTION_AMBIENT.verticalStrip + index * 0.35, index, motionScale, ambientActive),
            }}
            className="relative aspect-[2/3] h-[70%] shrink-0 overflow-hidden rounded-[20px] border border-white/10 bg-black shadow-2xl"
            style={{ boxShadow: index === 0 ? `0 0 80px ${accent}66` : undefined }}
          >
            <StoryImage item={item} priority={index < 2} />
          </motion.div>
        );
      })}
    </div>
  );
}

/** Longest-review / hero focus — primary poster moderately left of far-right edge. */
export function HeroPoster({ media, accent }: { media: StoryMedia[]; accent: string }) {
  const reduce = useReducedMotion();
  const { motionScale = 1 } = usePosterField();
  const [first, ...rest] = media;
  if (!first) return null;
  return (
    <div className="relative h-full">
      <div className="absolute left-[8%] top-1/2 aspect-[2/3] h-[78%] max-h-[82vh] -translate-y-1/2 md:left-[6%]">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24, rotate: 4 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ duration: reduce ? 0 : 0.55, ease: 'easeOut' }}
          className="h-full w-full overflow-hidden rounded-[28px] border border-white/15 bg-black shadow-2xl"
          style={{ boxShadow: `0 0 100px ${accent}55` }}
        >
          <motion.div
            className="h-full w-full"
            animate={reduce ? undefined : { y: [0, -6, 0] }}
            transition={
              reduce
                ? undefined
                : { duration: scaledDuration(MOTION_AMBIENT.portraitDrift, motionScale), repeat: Infinity, ease: 'easeInOut' }
            }
          >
            <StoryImage item={first} priority />
          </motion.div>
        </motion.div>
      </div>
      <div className="absolute bottom-[6%] left-[36%] flex gap-3 md:left-[40%]">
        {rest.slice(0, 4).map((item, index) => (
          <motion.div
            key={`${item.url}-${index}`}
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 0.85, y: reduce ? 0 : index % 2 ? -8 : 6 }}
            transition={
              reduce
                ? { duration: 0 }
                : {
                    opacity: { delay: 0.35 + index * 0.08, duration: MOTION_DURATION.revealFast },
                    y: {
                      duration: scaledDuration(MOTION_AMBIENT.verticalStrip + index * 0.35, motionScale),
                      repeat: Infinity,
                      repeatType: 'reverse',
                      ease: 'easeInOut',
                    },
                  }
            }
            className="aspect-[2/3] h-28 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-xl md:h-36"
          >
            <StoryImage item={item} priority={index === 0} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function PortraitStack({ media, accent }: { media: StoryMedia[]; accent: string }) {
  const [first, ...rest] = media;
  if (!first) return null;
  return (
    <div className="relative h-full">
      <div
        className="absolute left-[8%] top-1/2 aspect-[2/3] h-[82%] -translate-y-1/2 overflow-hidden rounded-[30px] border border-white/15 bg-black shadow-2xl md:left-[6%]"
        style={{ boxShadow: `0 0 90px ${accent}55` }}
      >
        <StoryImage item={first} priority />
      </div>
      <div className="absolute bottom-8 left-[36%] grid grid-cols-3 gap-2.5 md:left-[40%]">
        {rest.slice(0, 6).map((item, index) => (
          <div key={`${item.url}-${index}`} className="aspect-[2/3] h-28 overflow-hidden rounded-xl border border-white/10 bg-black shadow-xl">
            <StoryImage item={item} priority={index < 2} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Finale recap field — curated portraits + posters, not a random pile. */
export function RecapVisual({ media, accent }: { media: StoryMedia[]; accent: string }) {
  const reduce = useReducedMotion();
  const { motionScale = 1 } = usePosterField();
  const profiles = media.filter((item) => item.type === 'profile').slice(0, 2);
  const posters = media.filter((item) => item.type === 'poster').slice(0, 8);
  const lead = profiles[0] ?? posters[0];
  const secondary = profiles[1] ?? posters[1];
  const stream = posters.filter((item) => item.url !== lead?.url && item.url !== secondary?.url).slice(0, 6);
  if (!lead) return null;

  return (
    <div className="relative h-full">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 20 }}
        animate={reduce ? { opacity: 1, y: 0 } : { opacity: 1, y: [0, -10, 0] }}
        transition={
          reduce
            ? { duration: 0 }
            : {
                y: { duration: scaledDuration(MOTION_AMBIENT.verticalCascade, motionScale), repeat: Infinity, ease: 'easeInOut' },
                opacity: { duration: 0.5 },
              }
        }
        className="absolute left-[8%] top-[12%] z-20 aspect-[2/3] h-[58%] overflow-hidden rounded-[26px] border border-white/15 bg-black shadow-2xl"
        style={{ boxShadow: `0 0 80px ${accent}55` }}
      >
        <StoryImage item={lead} priority />
      </motion.div>
      {secondary && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={reduce ? { opacity: 1, y: 0 } : { opacity: 1, y: [0, 12, 0] }}
          transition={
            reduce
              ? { duration: 0 }
              : {
                  y: { duration: scaledDuration(MOTION_AMBIENT.verticalMosaic, motionScale), repeat: Infinity, ease: 'easeInOut' },
                  opacity: { duration: 0.55, delay: 0.12 },
                }
          }
          className="absolute bottom-[10%] left-[30%] z-30 aspect-[2/3] h-[42%] overflow-hidden rounded-[22px] border border-white/12 bg-black shadow-xl"
        >
          <StoryImage item={secondary} priority />
        </motion.div>
      )}
      <div className="absolute inset-y-[8%] left-[52%] right-[-4%] grid grid-cols-2 content-center gap-3">
        {stream.map((item, index) => (
          <motion.div
            key={`${item.url}-${index}`}
            animate={reduce ? undefined : { y: index % 2 ? [-14, 14] : [12, -12] }}
            transition={
              reduce
                ? undefined
                : {
                    duration: scaledDuration(MOTION_AMBIENT.verticalStrip + index * 0.35, motionScale),
                    repeat: Infinity,
                    repeatType: 'reverse',
                    ease: 'easeInOut',
                  }
            }
            className="aspect-[2/3] overflow-hidden rounded-xl border border-white/10 bg-black/90 shadow-lg"
          >
            <StoryImage item={item} priority={index < 2} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import type { StoryMedia } from '../../types';
import { StoryImage } from '../StoryImage';
import { PHASE_MS, REVEAL, TRANSITION, type CinematicPhase } from './motion';
import { PosterStream } from './PosterStream';

type PersonCinematicVisualProps = {
  media: StoryMedia[];
  accent: string;
  /** Remount key — resets the staged sequence on replay / re-enter. */
  sequenceKey: string;
};

/**
 * Staged cinematic for Favorite Director / Most Watched Actor:
 * identity → portrait → composition shift → poster stream → ambient.
 */
export function PersonCinematicVisual({ media, accent, sequenceKey }: PersonCinematicVisualProps) {
  const reduce = useReducedMotion();
  const profile = media.find((item) => item.type === 'profile') ?? null;
  const posters = media.filter((item) => item.type === 'poster');
  const [phase, setPhase] = useState<CinematicPhase>(() => (reduce ? 'ambient' : 'identity'));

  useEffect(() => {
    if (reduce) {
      setPhase('ambient');
      return;
    }
    setPhase('identity');
    const timers = [
      window.setTimeout(() => setPhase('portrait'), PHASE_MS.portrait),
      window.setTimeout(() => setPhase('composition'), PHASE_MS.composition),
      window.setTimeout(() => setPhase('posters'), PHASE_MS.posters),
      window.setTimeout(() => setPhase('ambient'), PHASE_MS.ambient),
    ];
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [sequenceKey, reduce]);

  const showPortrait = phase !== 'identity' || Boolean(reduce);
  const openStage = phase === 'composition' || phase === 'posters' || phase === 'ambient';
  const showPosters = phase === 'posters' || phase === 'ambient' || Boolean(reduce);
  const settle = phase === 'ambient' || reduce ? 1 : phase === 'posters' ? 0.55 : 0;

  return (
    <div className="relative h-full w-full" data-cinematic-phase={phase}>
      {profile && (
        <motion.div
          key={`portrait-${sequenceKey}`}
          initial={reduce ? false : { opacity: 0, x: 48, scale: 0.96 }}
          animate={{
            opacity: showPortrait ? 1 : 0,
            // Center-right first; open stage pushes portrait farther right via x.
            x: openStage ? '18%' : 0,
            scale: openStage ? 0.92 : 1,
          }}
          transition={openStage ? TRANSITION : REVEAL}
          className="absolute left-[28%] top-1/2 z-20 aspect-[2/3] h-[78%] max-h-[78vh] w-auto -translate-y-1/2 overflow-hidden rounded-[28px] border border-white/15 bg-black shadow-2xl md:left-[30%] lg:left-[32%]"
          style={{ boxShadow: `0 0 90px ${accent}55` }}
        >
          <StoryImage item={profile} priority />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
        </motion.div>
      )}

      <div
        className="absolute inset-y-0 left-0 z-10 w-full"
        style={{ opacity: showPosters ? 1 : 0, transition: reduce ? undefined : 'opacity 0.4s ease' }}
        aria-hidden={!showPosters}
      >
        <PosterStream
          posters={posters}
          accent={accent}
          active={phase === 'ambient' || phase === 'posters' || Boolean(reduce)}
          settle={settle}
        />
      </div>
    </div>
  );
}

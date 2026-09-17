'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';

import type { FinaleSequenceData } from '../types';
import { useFinaleSlidePhase } from './FinaleSlidePhaseContext';
import { showFinaleCurtain } from './finalePhases';
import {
  FINALE_PARADE_MS,
  paradeWaveAt,
  paradeWaves,
} from './finaleParade';
import { FINALE_CURTAIN_POSTER_CAP, FINALE_PARADE_SLOT_COUNT } from '../media';
import { MOTION_DURATION, MOTION_EASE } from '../motion/motionTokens';
import { StoryImage } from '../visuals/StoryImage';

export function FinaleCurtainVisual({
  sequence,
  accent,
}: {
  sequence: FinaleSequenceData;
  accent: string;
}) {
  const { phase, reduce } = useFinaleSlidePhase();
  const visible = showFinaleCurtain(phase, reduce);
  const waves = useMemo(
    () => paradeWaves(sequence.paradePosters, FINALE_PARADE_SLOT_COUNT),
    [sequence.paradePosters],
  );
  const [wave, setWave] = useState(0);
  const [settled, setSettled] = useState(reduce || waves.length === 0);

  useEffect(() => {
    if (reduce || !visible || waves.length === 0) return undefined;
    const started = performance.now();
    setSettled(false);
    setWave(0);
    const tick = window.setInterval(() => {
      const elapsed = performance.now() - started;
      setWave(paradeWaveAt(elapsed, waves.length));
      if (elapsed >= FINALE_PARADE_MS) {
        setSettled(true);
        window.clearInterval(tick);
      }
    }, 200);
    return () => window.clearInterval(tick);
  }, [reduce, visible, waves.length]);

  const current = waves[wave] ?? [];
  const curtain = sequence.curtainPosters.slice(0, FINALE_CURTAIN_POSTER_CAP);
  const showParade = visible && !settled && current.length > 0;

  return (
    <div className="relative h-full w-full">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 42%, ${accent}18, transparent 55%)`,
        }}
      />
      {showParade ? (
        <div className="absolute inset-[6%] grid grid-cols-3 grid-rows-3 place-items-center gap-4">
          {current.map((item, index) => (
            <motion.div
              key={`parade-${wave}-${index}`}
              className="aspect-[2/3] h-full max-h-full w-auto max-w-full overflow-hidden rounded-[14px] border border-white/10 bg-black shadow-lg"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduce ? 0 : 0.28, ease: MOTION_EASE.editorial }}
            >
              <StoryImage item={item} priority={wave === 0 && index < 3} />
            </motion.div>
          ))}
        </div>
      ) : (
        visible && (
          <div className="absolute inset-[10%_8%] grid grid-cols-3 content-center justify-items-center gap-x-8 gap-y-6">
            {curtain.map((item, index) => (
              <motion.div
                key={item.url}
                className="aspect-[2/3] w-[78%] overflow-hidden rounded-[14px] border border-white/10 bg-black shadow-lg"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 0.72 }}
                transition={{
                  duration: reduce ? 0 : MOTION_DURATION.reveal,
                  delay: reduce ? 0 : index * 0.04,
                  ease: MOTION_EASE.editorial,
                }}
              >
                <StoryImage item={item} priority={index < 3} />
              </motion.div>
            ))}
          </div>
        )
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/55" />
    </div>
  );
}

'use client';

import { motion } from 'framer-motion';

import { useStoryMotion } from '../motion/StoryMotionContext';
import { MOTION_DURATION, MOTION_EASE } from '../motion/motionTokens';
import type { StoryMedia } from '../types';
import { StoryImage } from './StoryImage';

export function MobileMediaRail({ media, accent }: { media: StoryMedia[]; accent: string }) {
  const { reduce } = useStoryMotion();
  const hero = media[0];
  if (!hero) return null;

  return (
    <div className="mb-3 flex w-full min-w-0 justify-center md:hidden" data-testid="story-mobile-media-rail">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduce ? 0 : MOTION_DURATION.revealFast,
          ease: MOTION_EASE.snap,
        }}
        className="relative min-w-0 overflow-hidden rounded-xl border border-white/10 bg-black shadow-lg"
        data-story-peek="false"
        style={{
          aspectRatio: '2 / 3',
          width: 'min(100%, 16.5rem)',
          maxHeight: '42svh',
          boxShadow: `0 0 28px ${accent}55`,
        }}
      >
        <StoryImage item={hero} priority />
      </motion.div>
    </div>
  );
}

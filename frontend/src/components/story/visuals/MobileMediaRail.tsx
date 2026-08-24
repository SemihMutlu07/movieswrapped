'use client';

import { motion } from 'framer-motion';

import { useStoryMotion } from '../motion/StoryMotionContext';
import { MOTION_DURATION, MOTION_EASE, MOTION_STAGGER } from '../motion/motionTokens';
import type { StoryMedia } from '../types';
import { StoryImage } from './StoryImage';

const MAX_MOBILE_POSTERS = 3;

export function MobileMediaRail({ media, accent }: { media: StoryMedia[]; accent: string }) {
  const { reduce } = useStoryMotion();
  const visible = media.slice(0, MAX_MOBILE_POSTERS);
  if (visible.length === 0) return null;

  return (
    <div className="mb-4 w-full min-w-0 overflow-hidden px-1 md:hidden" data-testid="story-mobile-media-rail">
      <div
        className="grid w-full min-w-0 items-end gap-[clamp(0.3rem,1.8vw,0.5rem)] px-1"
        style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
      >
        {visible.map((item, index) => (
          <motion.div
            key={`${item.url}-${index}`}
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: index % 2 === 0 ? 0 : 6 }}
            transition={{
              duration: reduce ? 0 : MOTION_DURATION.revealFast,
              delay: reduce ? 0 : Math.min(index * MOTION_STAGGER.streamPoster, 0.18),
              ease: MOTION_EASE.snap,
            }}
            className="relative min-w-0 overflow-hidden rounded-lg border border-white/10 bg-black shadow-lg"
            style={{
              aspectRatio: '2 / 3',
              boxShadow: index === 0 ? `0 0 28px ${accent}55` : undefined,
            }}
          >
            <StoryImage item={item} priority={index < 2} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

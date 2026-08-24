'use client';

import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';

import { useStoryMotion } from '../motion/StoryMotionContext';
import { MOTION_DURATION, MOTION_EASE } from '../motion/motionTokens';
import type { PosterFieldConfig } from './posterFieldConfig';
import { PosterFieldProvider } from './PosterFieldContext';

type PosterFieldProps = {
  slideKey: string;
  layout: PosterFieldConfig;
  children: ReactNode;
};

/**
 * Shared desktop poster frame — one place for left/right/top/bottom + content bias.
 * Inner visuals stay free to compose; they should not hardcode field anchors.
 */
export function PosterField({ slideKey, layout, children }: PosterFieldProps) {
  const { reduce } = useStoryMotion();
  const fieldStyle: CSSProperties = {
    top: layout.top,
    bottom: layout.bottom,
    left: layout.left,
    right: layout.right,
    width: layout.width,
    maxWidth: layout.maxWidth,
  };

  const innerStyle: CSSProperties = {
    transform: `translateX(${layout.contentX ?? '0%'}) rotate(${layout.rotation ?? 0}deg)`,
  };

  return (
    <PosterFieldProvider layout={layout}>
      <motion.div
        key={`poster-field-${slideKey}`}
        initial={reduce ? false : { opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 1.01 }}
        transition={{
          duration: reduce ? 0 : MOTION_DURATION.fieldEnter,
          ease: MOTION_EASE.editorial,
        }}
        className="absolute hidden md:block"
        style={fieldStyle}
        data-testid="story-poster-field"
      >
        <div className="h-full w-full origin-center" style={innerStyle}>
          {children}
        </div>
      </motion.div>
    </PosterFieldProvider>
  );
}

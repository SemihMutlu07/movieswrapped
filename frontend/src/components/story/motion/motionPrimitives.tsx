'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_STAGGER,
} from './motionTokens';

type EaseTuple = readonly [number, number, number, number];

const box = 'min-w-0 max-w-full';

export function RevealLine({
  instant,
  delay = 0,
  children,
  ease = MOTION_EASE.editorial,
  duration = MOTION_DURATION.reveal,
  y = 16,
}: {
  instant?: boolean;
  delay?: number;
  children: ReactNode;
  ease?: EaseTuple;
  duration?: number;
  y?: number;
}) {
  return (
    <motion.div
      initial={instant ? false : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: instant ? 0 : duration,
        delay: instant ? 0 : delay,
        ease,
      }}
      className={box}
    >
      {children}
    </motion.div>
  );
}

export function EmphasisLine({
  instant,
  children,
}: {
  instant?: boolean;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={instant ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: instant ? 0 : MOTION_DURATION.emphasis,
        ease: MOTION_EASE.snap,
      }}
      className={box}
    >
      {children}
    </motion.div>
  );
}

export const TEXT_REVEAL = MOTION_STAGGER;

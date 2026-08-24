'use client';

import { motion, useReducedMotion } from 'framer-motion';

import { MOTION_DURATION } from '../motion/motionTokens';
import { useI18n } from '@/i18n/I18nProvider';

type RewatchInsightProps = {
  title: string;
  watchCount: number;
  extraCount: number;
};

/** Secondary insight under person identity — enters after the primary reveal. */
export function RewatchInsight({ title, watchCount, extraCount }: RewatchInsightProps) {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : 2.6, duration: reduce ? 0 : MOTION_DURATION.fieldEnter, ease: [0.16, 1, 0.3, 1] }}
      className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-left"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-200/90">
        {t('story.slide.rewatch.eyebrow')}
      </p>
      <p className="mt-1 text-sm text-stone-100">
        <span className="font-semibold text-amber-100">{title}</span>
        {' — '}
        {t('story.slide.rewatch.watchedTimes', { count: watchCount })}
      </p>
      {extraCount > 0 && (
        <p className="mt-1 text-xs text-stone-400">
          {t('story.slide.rewatch.more', { count: extraCount })}
        </p>
      )}
    </motion.div>
  );
}

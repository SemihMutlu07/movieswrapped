'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';

import { useI18n } from '@/i18n/I18nProvider';
import { resultPath } from '@/lib/routes';
import { stampResultsNavTap } from '@/lib/results-nav';

import { MOTION_DURATION, MOTION_EASE } from './motion/motionTokens';
import { useStoryMotion } from './motion/StoryMotionContext';

type StoryNavigationProps = {
  isLast: boolean;
  username?: string;
  locale: 'en' | 'tr';
  onPrevious: () => void;
  onNext: () => void;
  onReplay: () => void;
};

const secondaryBtn =
  'min-h-11 flex-1 rounded-full border border-stone-600 bg-black/65 px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-stone-200 backdrop-blur transition-colors hover:border-amber-300 hover:text-amber-200 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 md:flex-none md:px-6 md:py-3 md:text-xs';

export function StoryNavigation({
  isLast,
  username,
  locale,
  onPrevious,
  onNext,
  onReplay,
}: StoryNavigationProps) {
  const { t } = useI18n();
  const { reduce } = useStoryMotion();
  const [openingResults, setOpeningResults] = useState(false);
  const resultsHref = resultPath(username, locale);

  useEffect(() => {
    if (!isLast) {
      setOpeningResults(false);
    }
  }, [isLast]);

  return (
    <>
      <button
        type="button"
        aria-label={t('story.previous')}
        onClick={onPrevious}
        className={`absolute inset-y-0 left-0 w-1/3 cursor-w-resize focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 ${isLast ? 'z-20' : 'z-30'}`}
      />
      <button
        type="button"
        aria-label={t('story.next')}
        onClick={onNext}
        className={`absolute inset-y-0 right-0 w-2/3 cursor-e-resize focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 ${isLast ? 'z-20' : 'z-30'}`}
      />

      {isLast && (
        <motion.div
          data-testid="story-finale-actions"
          className="relative z-50 min-w-0 px-3 pt-2 md:px-5"
          style={{ paddingBottom: 'max(1.15rem, env(safe-area-inset-bottom, 0px))' }}
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : MOTION_DURATION.reveal, ease: MOTION_EASE.snap }}
        >
          <div className="mx-auto flex w-full min-w-0 max-w-md flex-col gap-2 md:max-w-3xl md:flex-row md:flex-wrap md:items-center md:justify-center md:gap-3">
            <div className="flex min-w-0 gap-2 md:contents">
              <button type="button" onClick={onPrevious} className={secondaryBtn}>
                {t('story.back')}
              </button>
              <button type="button" onClick={onReplay} className={secondaryBtn}>
                {t('story.replay')}
              </button>
            </div>
            <motion.div
              initial={reduce ? false : { scale: 0.96 }}
              animate={{ scale: 1 }}
              transition={{
                duration: reduce ? 0 : MOTION_DURATION.emphasis,
                delay: reduce ? 0 : 0.08,
                ease: MOTION_EASE.snap,
              }}
              className="min-w-0 md:flex-none"
            >
              <Link
                href={resultsHref}
                prefetch
                aria-busy={openingResults}
                onClick={() => {
                  stampResultsNavTap();
                  setOpeningResults(true);
                }}
                className={`flex min-h-11 min-w-0 items-center justify-center rounded-full px-5 py-2.5 text-center font-mono text-[11px] font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-amber-950/20 transition-colors active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100 md:px-7 md:py-3 md:text-xs ${
                  openingResults ? 'bg-amber-200' : 'bg-amber-300 hover:bg-amber-200'
                }`}
              >
                {openingResults ? t('story.openingResults') : t('story.openResults')}
              </Link>
            </motion.div>
          </div>
        </motion.div>
      )}

      {openingResults ? (
        <div
          data-testid="results-nav-pending"
          className="fixed inset-0 z-[300] grid place-items-center bg-[#1e252d] px-6 text-center"
          style={{ paddingBottom: 'max(1.15rem, env(safe-area-inset-bottom, 0px))' }}
          aria-live="assertive"
        >
          <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-amber-200">
            {t('story.openingResults')}
          </p>
        </div>
      ) : null}
    </>
  );
}

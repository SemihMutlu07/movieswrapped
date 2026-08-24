'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { ShareVariantRenderer } from '@/components/share/registry';
import type { ShareOrientation } from '@/components/share/types';
import type { StatsData } from '@/containers/results/sections/types';
import { useI18n } from '@/i18n/I18nProvider';

import { useFinaleSlidePhase } from './finale/FinaleSlidePhaseContext';
import { showFinaleCard, showFinaleCardHint } from './finale/finalePhases';
import { MOTION_DURATION, MOTION_EASE } from './motion/motionTokens';
import { Hint } from './SlideTypography';
import { buildStoryShareCard, FINALE_CARD_DOM, FINALE_VARIANT, pickFinaleOrientation } from './viewModel';

/**
 * Story finale: the shareable card, chosen portrait on phones and landscape on
 * wider containers, scaled to fit the remaining slide zone after chrome/CTAs.
 */
export default function StoryFinaleCard({ stats }: { stats: StatsData }) {
  const reduce = Boolean(useReducedMotion());
  const { t } = useI18n();
  const { phase, sequence } = useFinaleSlidePhase();
  const frameRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [orientation, setOrientation] = useState<ShareOrientation>('vertical');

  const showCard = sequence ? showFinaleCard(phase, reduce) : true;
  const showHint = sequence ? showFinaleCardHint(phase, reduce) : false;

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setBox({ w: rect.width, h: rect.height });
      setOrientation(pickFinaleOrientation(rect.width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const data = useMemo(() => buildStoryShareCard(stats), [stats]);
  const dom = FINALE_CARD_DOM[orientation];
  const scale = box.w > 0 && box.h > 0 ? Math.min(box.w / dom.w, box.h / dom.h) : 0;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col" data-testid="story-finale-card">
      <div
        ref={frameRef}
        className="relative min-h-0 w-full flex-1"
        style={{ perspective: reduce ? undefined : 1200 }}
        data-finale-orientation={orientation}
      >
        {scale > 0 && showCard && (
          <div
            className="absolute left-1/2 top-1/2 origin-center"
            style={{
              width: dom.w,
              height: dom.h,
              transform: `translate(-50%, -50%) scale(${scale})`,
              transformStyle: reduce ? undefined : 'preserve-3d',
              filter: 'drop-shadow(0 18px 40px rgba(0,0,0,0.55)) drop-shadow(0 0 28px rgba(251,191,36,0.22))',
            }}
          >
            <motion.div
              initial={reduce ? false : { opacity: 0, rotateY: -18, scale: 0.94 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, rotateY: 0, scale: 1 }}
              transition={{
                duration: reduce ? 0 : MOTION_DURATION.cardReveal,
                ease: MOTION_EASE.editorial,
              }}
              className="overflow-hidden rounded-[28px] ring-1 ring-amber-300/25"
              style={{ width: dom.w, height: dom.h, transformStyle: reduce ? undefined : 'preserve-3d' }}
            >
              <ShareVariantRenderer variant={FINALE_VARIANT[orientation]} data={data} orientation={orientation} />
            </motion.div>
          </div>
        )}
      </div>
      {showHint && (
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduce ? 0 : MOTION_DURATION.emphasis, ease: MOTION_EASE.snap }}
          className="mt-2 hidden shrink-0 text-center md:mt-3 md:block"
        >
          <Hint className="text-stone-400">{t('story.slide.finale.cardHint')}</Hint>
        </motion.div>
      )}
    </div>
  );
}

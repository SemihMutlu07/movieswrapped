'use client';

import { useI18n } from '@/i18n/I18nProvider';

import { Label, Big, Sub } from '../SlideTypography';
import { EmphasisLine, RevealLine, TEXT_REVEAL } from '../motion/motionPrimitives';
import { showReviewInsight } from './reviewPhases';
import { useReviewSlidePhase } from './ReviewSlidePhaseContext';

export function ReviewSlideBody() {
  const { t, formatNumber } = useI18n();
  const { phase, reduce, sequence } = useReviewSlidePhase();
  if (!sequence) return null;

  const instant = reduce;
  const showInsight = showReviewInsight(phase, reduce);
  const likes = sequence.likes;

  return (
    <>
      <RevealLine instant={instant} delay={TEXT_REVEAL.textLabel}>
        <Label>{t('story.slide.review.label')}</Label>
      </RevealLine>
      <RevealLine instant={instant} delay={TEXT_REVEAL.textHeadline} y={16}>
        <Big>{sequence.filmTitle}</Big>
      </RevealLine>
      <RevealLine instant={instant} delay={TEXT_REVEAL.textSub} y={14} duration={0.48}>
        <Sub>
          {sequence.totalWordsWritten != null
            ? t('story.slide.review.wordsTotal', { count: formatNumber(sequence.totalWordsWritten) })
            : null}
        </Sub>
      </RevealLine>
      {showInsight && (
        <EmphasisLine instant={instant}>
          <Sub className="text-stone-400">
            {likes === 0
              ? t('story.slide.review.zeroLikes')
              : likes === 1
                ? t('story.slide.review.likes_one', { count: formatNumber(likes) })
                : t('story.slide.review.likes_other', { count: formatNumber(likes) })}
          </Sub>
          <Sub className="text-stone-400">
            {t('story.slide.review.thisLength', { count: formatNumber(sequence.charLength) })}
          </Sub>
        </EmphasisLine>
      )}
    </>
  );
}

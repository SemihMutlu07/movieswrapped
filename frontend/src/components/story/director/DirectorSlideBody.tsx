'use client';

import { useI18n } from '@/i18n/I18nProvider';

import { Label, Big, Sub } from '../SlideTypography';
import { EmphasisLine, RevealLine, TEXT_REVEAL } from '../motion/motionPrimitives';
import { showPersonRewatch } from '../person/personPhases';
import { usePersonSlidePhase } from '../person/PersonSlidePhaseContext';

export function DirectorSlideBody() {
  const { t, formatNumber } = useI18n();
  const { phase, reduce, sequence } = usePersonSlidePhase();
  if (!sequence) return null;

  const instant = reduce;
  const showRewatch = showPersonRewatch(phase, reduce) && sequence.rewatch;

  return (
    <>
      <RevealLine instant={instant} delay={TEXT_REVEAL.textLabel}>
        <Label>{t('story.slide.director.label')}</Label>
      </RevealLine>
      <RevealLine instant={instant} delay={TEXT_REVEAL.textHeadline} y={16}>
        <Big>{sequence.personName}</Big>
      </RevealLine>
      <RevealLine instant={instant} delay={TEXT_REVEAL.textSub} y={14} duration={0.48}>
        <Sub>
          {t('story.slide.director.sub', { count: formatNumber(sequence.filmCount) })}
        </Sub>
      </RevealLine>
      {showRewatch && sequence.rewatch && (
        <EmphasisLine instant={instant}>
          <Sub className="text-stone-400">
            {sequence.rewatch.watchCount > 2
              ? t('story.slide.director.rewatch.detail', {
                title: sequence.rewatch.title,
                count: formatNumber(sequence.rewatch.watchCount),
              })
              : t('story.slide.director.rewatch.tease')}
          </Sub>
        </EmphasisLine>
      )}
    </>
  );
}

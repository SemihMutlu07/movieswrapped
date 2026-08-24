'use client';

import { useI18n } from '@/i18n/I18nProvider';

import { Label, Big, Sub } from '../SlideTypography';
import { EmphasisLine, RevealLine, TEXT_REVEAL } from '../motion/motionPrimitives';
import { MOTION_EASE } from '../motion/motionTokens';
import { showPersonRewatch } from '../person/personPhases';
import { usePersonSlidePhase } from '../person/PersonSlidePhaseContext';

export function ActorSlideBody() {
  const { t, formatNumber } = useI18n();
  const { phase, reduce, sequence } = usePersonSlidePhase();
  if (!sequence) return null;

  const instant = reduce;
  const showRewatch = showPersonRewatch(phase, reduce) && sequence.rewatch;

  return (
    <>
      <RevealLine instant={instant} delay={TEXT_REVEAL.textLabel} ease={MOTION_EASE.warm}>
        <Label>{t('story.slide.actor.label')}</Label>
      </RevealLine>
      <RevealLine instant={instant} delay={TEXT_REVEAL.textHeadline} y={16} ease={MOTION_EASE.warm}>
        <Big>{sequence.personName}</Big>
      </RevealLine>
      <RevealLine instant={instant} delay={TEXT_REVEAL.textSub} y={14} duration={0.48} ease={MOTION_EASE.warm}>
        <Sub>
          {t('story.slide.actor.sub', { count: formatNumber(sequence.filmCount) })}
        </Sub>
      </RevealLine>
      {showRewatch && sequence.rewatch && (
        <EmphasisLine instant={instant}>
          <Sub className="text-stone-400">
            {sequence.rewatch.watchCount > 2
              ? t('story.slide.actor.rewatch.detail', {
                title: sequence.rewatch.title,
                count: formatNumber(sequence.rewatch.watchCount),
              })
              : t('story.slide.actor.rewatch.tease')}
          </Sub>
        </EmphasisLine>
      )}
    </>
  );
}

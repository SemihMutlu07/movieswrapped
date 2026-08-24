'use client';

import { useI18n } from '@/i18n/I18nProvider';

import { FinaleHeadline, Label } from '../SlideTypography';
import { RevealLine, TEXT_REVEAL } from '../motion/motionPrimitives';
import { useFinaleSlidePhase } from './FinaleSlidePhaseContext';

export function FinaleSlideBody() {
  const { t } = useI18n();
  const { reduce } = useFinaleSlidePhase();
  const instant = reduce;

  return (
    <div className="min-w-0 max-w-full">
      <RevealLine instant={instant} delay={TEXT_REVEAL.textLabel} y={12}>
        <Label className="max-[40rem]:hidden">{t('story.slide.finale.label')}</Label>
      </RevealLine>
      <RevealLine instant={instant} delay={TEXT_REVEAL.textHeadline} y={12}>
        <FinaleHeadline>{t('story.slide.finale.headline')}</FinaleHeadline>
      </RevealLine>
    </div>
  );
}

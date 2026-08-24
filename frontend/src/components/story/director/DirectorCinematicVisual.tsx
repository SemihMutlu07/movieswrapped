'use client';

import type { PersonSequenceData } from '../types';
import { MOTION_EASE } from '../motion/motionTokens';
import { PersonCinematicVisual } from '../person/PersonCinematicVisual';

export function DirectorCinematicVisual({
  sequence,
  accent,
}: {
  sequence: PersonSequenceData;
  accent: string;
}) {
  return (
    <PersonCinematicVisual
      sequence={sequence}
      accent={accent}
      portraitEase={MOTION_EASE.editorial}
    />
  );
}

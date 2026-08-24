/** Shared motion vocabulary for person-cinematic story slides.
 *  Durations come from the central tier system (motionTokens); eases stay local where they differ. */
import { MOTION_DURATION } from '../../motion/motionTokens';

export const REVEAL = {
  duration: MOTION_DURATION.reveal,
  ease: [0.22, 1, 0.36, 1] as const,
};

export const TRANSITION = {
  duration: MOTION_DURATION.transition,
  ease: [0.33, 1, 0.68, 1] as const,
};

export const EMPHASIS = {
  duration: MOTION_DURATION.emphasis,
  ease: [0.16, 1, 0.3, 1] as const,
};

/** Phase timeline (ms) for the staged person reveal. */
export const PHASE_MS = {
  identity: 0,
  portrait: 700,
  composition: 1600,
  posters: 2300,
  ambient: 3400,
  rewatch: 2800,
} as const;

export type CinematicPhase = 'identity' | 'portrait' | 'composition' | 'posters' | 'ambient';

export function phaseAt(elapsedMs: number, reduceMotion: boolean): CinematicPhase {
  if (reduceMotion) return 'ambient';
  if (elapsedMs < PHASE_MS.portrait) return 'identity';
  if (elapsedMs < PHASE_MS.composition) return 'portrait';
  if (elapsedMs < PHASE_MS.posters) return 'composition';
  if (elapsedMs < PHASE_MS.ambient) return 'posters';
  return 'ambient';
}

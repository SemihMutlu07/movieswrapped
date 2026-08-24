export const PERSON_STREAM_POSTER_CAP = 12;
export const PERSON_STREAM_MIN_FILL = 6;

export type PersonPhase =
  | 'textReveal'
  | 'portraitIntro'
  | 'compose'
  | 'streamBurst'
  | 'streamAmbient'
  | 'final';

export const PERSON_PHASE_ORDER: readonly PersonPhase[] = [
  'textReveal',
  'portraitIntro',
  'compose',
  'streamBurst',
  'streamAmbient',
  'final',
];

/** Wall-clock offsets from slide mount — navigation never waits on these. */
export const PERSON_PHASE_MS: Partial<Record<PersonPhase, number>> = {
  portraitIntro: 650,
  compose: 1300,
  streamBurst: 1900,
  streamAmbient: 3200,
  final: 3200,
};

export function personPhaseAt(elapsedMs: number): PersonPhase {
  let phase: PersonPhase = 'textReveal';
  for (const candidate of PERSON_PHASE_ORDER) {
    const threshold = PERSON_PHASE_MS[candidate];
    if (threshold != null && elapsedMs >= threshold) {
      phase = candidate;
    }
  }
  return phase;
}

export function showPersonRewatch(phase: PersonPhase, reduce: boolean): boolean {
  if (reduce) return true;
  return phase === 'streamBurst' || phase === 'streamAmbient' || phase === 'final';
}

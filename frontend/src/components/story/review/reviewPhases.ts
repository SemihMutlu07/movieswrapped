export const REVIEW_STREAM_POSTER_CAP = 12;
export const REVIEW_STREAM_MIN_FILL = 6;

export type ReviewPhase =
  | 'textReveal'
  | 'heroIntro'
  | 'compose'
  | 'streamBurst'
  | 'streamAmbient'
  | 'final';

export const REVIEW_PHASE_ORDER: readonly ReviewPhase[] = [
  'textReveal',
  'heroIntro',
  'compose',
  'streamBurst',
  'streamAmbient',
  'final',
];

/** Wall-clock offsets from slide mount — navigation never waits on these. */
export const REVIEW_PHASE_MS: Partial<Record<ReviewPhase, number>> = {
  heroIntro: 650,
  compose: 1300,
  streamBurst: 1900,
  streamAmbient: 3200,
  final: 3200,
};

export function reviewPhaseAt(elapsedMs: number): ReviewPhase {
  let phase: ReviewPhase = 'textReveal';
  for (const candidate of REVIEW_PHASE_ORDER) {
    const threshold = REVIEW_PHASE_MS[candidate];
    if (threshold != null && elapsedMs >= threshold) {
      phase = candidate;
    }
  }
  return phase;
}

export function showReviewInsight(phase: ReviewPhase, reduce: boolean): boolean {
  if (reduce) return true;
  return phase === 'streamBurst' || phase === 'streamAmbient' || phase === 'final';
}

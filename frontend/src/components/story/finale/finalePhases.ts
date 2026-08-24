export const FINALE_CURTAIN_POSTER_CAP = 8;
export const FINALE_CURTAIN_MIN_FILL = 4;

export type FinalePhase =
  | 'textReveal'
  | 'curtainFade'
  | 'cardReveal'
  | 'final';

export const FINALE_PHASE_ORDER: readonly FinalePhase[] = [
  'textReveal',
  'curtainFade',
  'cardReveal',
  'final',
];

/** Shorter wall-clock offsets than person beats — closing curtain only (cumulative deltas 500 / 1100 / 1100). */
export const FINALE_PHASE_MS: Partial<Record<FinalePhase, number>> = {
  curtainFade: 500,
  cardReveal: 1600,
  final: 2700,
};

export function finalePhaseAt(elapsedMs: number): FinalePhase {
  let phase: FinalePhase = 'textReveal';
  for (const candidate of FINALE_PHASE_ORDER) {
    const threshold = FINALE_PHASE_MS[candidate];
    if (threshold != null && elapsedMs >= threshold) {
      phase = candidate;
    }
  }
  return phase;
}

export function showFinaleCurtain(phase: FinalePhase, reduce: boolean): boolean {
  if (reduce) return true;
  return phase === 'curtainFade' || phase === 'cardReveal' || phase === 'final';
}

export function showFinaleCard(phase: FinalePhase, reduce: boolean): boolean {
  if (reduce) return true;
  return phase === 'cardReveal' || phase === 'final';
}

export function showFinaleCardHint(phase: FinalePhase, reduce: boolean): boolean {
  return showFinaleCard(phase, reduce);
}

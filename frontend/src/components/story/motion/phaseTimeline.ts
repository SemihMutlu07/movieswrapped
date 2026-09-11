/** Shared opening beat for staged story sequences. */

export function openingElapsedMs(paused: boolean, reduce: boolean, settledMs: number): number {
  return reduce || paused ? settledMs : 0;
}

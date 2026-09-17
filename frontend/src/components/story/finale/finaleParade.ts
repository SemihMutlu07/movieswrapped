import type { StoryMedia } from '../types';

/** One pass. Not a motion-token duration: the sequence is a clock, then it stops. */
export const FINALE_PARADE_MS = 4000;

export function paradeWaves(posters: StoryMedia[], slots: number): StoryMedia[][] {
  if (posters.length === 0 || slots < 1) return [];
  const waves: StoryMedia[][] = [];
  for (let index = 0; index < posters.length; index += slots) {
    waves.push(posters.slice(index, index + slots));
  }
  return waves;
}

export function paradeWaveAt(elapsedMs: number, waveCount: number, totalMs = FINALE_PARADE_MS): number {
  if (waveCount <= 1) return 0;
  const clamped = Math.min(Math.max(elapsedMs, 0), totalMs - 1);
  return Math.min(waveCount - 1, Math.floor((clamped / totalMs) * waveCount));
}

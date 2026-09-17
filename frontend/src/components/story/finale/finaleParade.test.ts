import { describe, expect, it } from 'vitest';

import { FINALE_PARADE_MS, paradeWaveAt, paradeWaves } from './finaleParade';

const posters = Array.from({ length: 20 }, (_, index) => ({
  type: 'poster' as const,
  url: `/p${index}.jpg`,
  alt: `Film ${index}`,
}));

describe('finale parade', () => {
  it('splits the sample into equal slots and finishes inside 4s', () => {
    const waves = paradeWaves(posters, 9);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toHaveLength(9);
    expect(waves[2]).toHaveLength(2);
    expect(paradeWaveAt(0, waves.length)).toBe(0);
    expect(paradeWaveAt(FINALE_PARADE_MS - 1, waves.length)).toBe(2);
    expect(FINALE_PARADE_MS).toBe(4000);
  });
});

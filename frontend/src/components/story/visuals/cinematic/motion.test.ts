import { describe, expect, it } from 'vitest';

import { phaseAt, PHASE_MS } from './motion';

describe('phaseAt', () => {
  it('jumps straight to ambient when reduced motion is on', () => {
    expect(phaseAt(0, true)).toBe('ambient');
    expect(phaseAt(PHASE_MS.ambient, true)).toBe('ambient');
  });

  it('walks the staged timeline in order', () => {
    expect(phaseAt(0, false)).toBe('identity');
    expect(phaseAt(PHASE_MS.portrait, false)).toBe('portrait');
    expect(phaseAt(PHASE_MS.composition, false)).toBe('composition');
    expect(phaseAt(PHASE_MS.posters, false)).toBe('posters');
    expect(phaseAt(PHASE_MS.ambient, false)).toBe('ambient');
  });
});

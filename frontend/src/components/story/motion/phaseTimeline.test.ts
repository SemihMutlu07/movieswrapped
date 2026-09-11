import { describe, expect, it } from 'vitest';

import { openingElapsedMs } from './phaseTimeline';

describe('openingElapsedMs', () => {
  it('starts the cinematic from zero while the story is playing', () => {
    expect(openingElapsedMs(false, false, 3200)).toBe(0);
  });

  it('opens on the settled beat when paused or reduced-motion', () => {
    expect(openingElapsedMs(true, false, 3200)).toBe(3200);
    expect(openingElapsedMs(false, true, 2700)).toBe(2700);
  });
});

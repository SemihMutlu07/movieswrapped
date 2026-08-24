import { describe, expect, it } from 'vitest';

import {
  ambientLoopTransition,
  MOTION_AMBIENT,
  MOTION_DURATION,
  MOTION_STAGGER,
  MOTION_TIER,
  SCENE_MOTION_BUDGET,
  scaledDuration,
  tierOf,
  verticalDriftTransition,
} from './motionTokens';

describe('motionTokens', () => {
  it('scales durations with poster-field motion scale', () => {
    expect(scaledDuration(MOTION_DURATION.reveal, 1.15)).toBeCloseTo(0.598);
  });

  it('disables ambient loops when inactive', () => {
    expect(ambientLoopTransition(MOTION_AMBIENT.verticalStrip, 1, false)).toEqual({ duration: 0 });
  });

  it('keeps the A1 supporting-copy delay in the 180-200ms window', () => {
    expect(MOTION_STAGGER.textSub).toBeGreaterThanOrEqual(0.18);
    expect(MOTION_STAGGER.textSub).toBeLessThanOrEqual(0.2);
  });

  it('places every named duration inside exactly one tier band', () => {
    for (const [name, seconds] of Object.entries(MOTION_DURATION)) {
      expect(tierOf(seconds), `${name}=${seconds}s sits outside every tier`).not.toBeNull();
    }
  });

  it('keeps every ambient loop inside the ambient band', () => {
    const { min, max } = MOTION_TIER.ambient;
    for (const seconds of Object.values(MOTION_AMBIENT)) {
      expect(seconds).toBeGreaterThanOrEqual(min);
      expect(seconds).toBeLessThanOrEqual(max);
    }
  });

  it('caps the scene composition budget at one primary, one secondary, one ambient', () => {
    expect(SCENE_MOTION_BUDGET.primary).toBe(1);
    expect(SCENE_MOTION_BUDGET.secondaryMax).toBe(1);
    expect(SCENE_MOTION_BUDGET.ambientMax).toBe(1);
  });

  it('staggers vertical drift by index', () => {
    const a = verticalDriftTransition(MOTION_AMBIENT.verticalCascade, 0, 1, true);
    const b = verticalDriftTransition(MOTION_AMBIENT.verticalCascade, 3, 1, true);
    expect(b.duration).toBeGreaterThan(a.duration!);
  });

  it('keeps staggered drift variants inside the ambient band', () => {
    const { min } = MOTION_TIER.ambient;
    for (const base of Object.values(MOTION_AMBIENT)) {
      for (const index of [0, 1, 2, 3]) {
        expect(verticalDriftTransition(base, index).duration!).toBeGreaterThanOrEqual(min);
      }
    }
  });
});

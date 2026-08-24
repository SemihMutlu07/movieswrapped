import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOTION_DURATION, tierOf } from './motionTokens';
import { createTransitionGate } from './transitionGate';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('transitionGate', () => {
  it('runs immediately when unlocked and stays locked for the scene duration', () => {
    const gate = createTransitionGate(600);
    const run = vi.fn();
    expect(gate.tryBegin(run)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(gate.isLocked()).toBe(true);

    vi.advanceTimersByTime(599);
    expect(gate.isLocked()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(gate.isLocked()).toBe(false);
  });

  it('queues a request made mid-transition and flushes it on release', () => {
    const gate = createTransitionGate(600);
    const first = vi.fn();
    const queued = vi.fn();
    gate.tryBegin(first);

    expect(gate.tryBegin(queued)).toBe(false);
    expect(queued).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(queued).toHaveBeenCalledTimes(1);
    // Flushed request re-locks the gate for its own scene duration.
    expect(gate.isLocked()).toBe(true);
    vi.advanceTimersByTime(600);
    expect(gate.isLocked()).toBe(false);
  });

  it('keeps only the latest queued target (no stacked crossfades)', () => {
    const gate = createTransitionGate(600);
    gate.tryBegin(vi.fn());
    const earlier = vi.fn();
    const latest = vi.fn();
    gate.tryBegin(earlier);
    gate.tryBegin(latest);

    vi.advanceTimersByTime(600);
    expect(earlier).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('drops everything on dispose', () => {
    const gate = createTransitionGate(600);
    const queued = vi.fn();
    gate.tryBegin(vi.fn());
    gate.tryBegin(queued);
    gate.dispose();

    vi.advanceTimersByTime(5000);
    expect(queued).not.toHaveBeenCalled();
    expect(gate.isLocked()).toBe(false);
  });

  it('pins the scene crossfade token inside the 480-620ms audit band', () => {
    expect(tierOf(MOTION_DURATION.transition)).toBe('scene');
    const ms = Math.round(MOTION_DURATION.transition * 1000);
    expect(ms).toBeGreaterThanOrEqual(480);
    expect(ms).toBeLessThanOrEqual(620);
  });
});

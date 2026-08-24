/**
 * Scene transition gate (audit 2026-08-22, decision 2):
 * a new scene crossfade must never start before the previous one finishes.
 * While the gate is locked, incoming navigation requests replace the queued
 * target (latest wins) and flush as soon as the lock releases.
 */

export type TransitionGate = {
  /** True while a scene transition is in flight. */
  isLocked(): boolean;
  /**
   * Run immediately when unlocked; otherwise queue (replacing any queued run)
   * until the current transition finishes. Returns true only when the run
   * started immediately.
   */
  tryBegin(run: () => void): boolean;
  /** Cancel the pending release timer and drop any queued run. */
  dispose(): void;
};

export function createTransitionGate(durationMs: number): TransitionGate {
  let locked = false;
  let queued: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const begin = (run: () => void): boolean => {
    if (locked) {
      queued = run;
      return false;
    }
    locked = true;
    run();
    timer = setTimeout(() => {
      timer = null;
      locked = false;
      const next = queued;
      queued = null;
      if (next) begin(next);
    }, durationMs);
    return true;
  };

  return {
    tryBegin: begin,
    isLocked: () => locked,
    dispose: () => {
      if (timer != null) clearTimeout(timer);
      timer = null;
      locked = false;
      queued = null;
    },
  };
}

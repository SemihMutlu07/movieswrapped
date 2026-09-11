'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useReducedMotion } from 'framer-motion';

import type { PersonSequenceData } from '../types';
import { openingElapsedMs } from '../motion/phaseTimeline';
import { PERSON_PHASE_MS, personPhaseAt, type PersonPhase } from './personPhases';

type PersonSlidePhaseValue = {
  phase: PersonPhase;
  reduce: boolean;
  sequence: PersonSequenceData | null;
  paused: boolean;
};

const PersonSlidePhaseContext = createContext<PersonSlidePhaseValue>({
  phase: 'textReveal',
  reduce: false,
  sequence: null,
  paused: false,
});

export function PersonSlidePhaseProvider({
  sequence,
  slideKey,
  paused,
  children,
}: {
  sequence: PersonSequenceData | null;
  slideKey: string;
  paused: boolean;
  children: ReactNode;
}) {
  const reduce = Boolean(useReducedMotion());
  const [phase, setPhase] = useState<PersonPhase>(reduce ? 'final' : 'textReveal');
  const elapsedRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);

  const syncPhase = useCallback((elapsedMs: number) => {
    const next = reduce ? 'final' : personPhaseAt(elapsedMs);
    setPhase((current) => (current === next ? current : next));
  }, [reduce]);

  useEffect(() => {
    lastTickRef.current = null;
    const settledMs = PERSON_PHASE_MS.final ?? 0;
    elapsedRef.current = openingElapsedMs(paused, reduce, settledMs);
    setPhase(reduce || paused ? 'final' : 'textReveal');
    // Sample paused only on slide change so a mid-slide pause freezes instead of skipping to final.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideKey, reduce]);

  useEffect(() => {
    if (!sequence || reduce) return undefined;

    let raf = 0;
    // Timer hygiene: stop the loop once the timeline completes — no idle rAF after settle.
    const terminalMs = PERSON_PHASE_MS.final ?? Number.POSITIVE_INFINITY;
    const tick = (now: number) => {
      if (lastTickRef.current != null && !paused) {
        elapsedRef.current += now - lastTickRef.current;
        syncPhase(elapsedRef.current);
      }
      lastTickRef.current = now;
      if (!paused && elapsedRef.current >= terminalMs) return;
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [sequence, reduce, paused, syncPhase]);

  const value = useMemo(
    () => ({ phase, reduce, sequence, paused }),
    [phase, reduce, sequence, paused],
  );

  return (
    <PersonSlidePhaseContext.Provider value={value}>
      {children}
    </PersonSlidePhaseContext.Provider>
  );
}

export function usePersonSlidePhase(): PersonSlidePhaseValue {
  return useContext(PersonSlidePhaseContext);
}

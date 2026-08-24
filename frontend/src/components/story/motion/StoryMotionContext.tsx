'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';

type StoryMotionValue = {
  paused: boolean;
  reduce: boolean;
  ambientActive: boolean;
};

const StoryMotionContext = createContext<StoryMotionValue>({
  paused: false,
  reduce: false,
  ambientActive: true,
});

export function StoryMotionProvider({
  paused,
  children,
}: {
  paused: boolean;
  children: ReactNode;
}) {
  const reduce = Boolean(useReducedMotion());
  const value = useMemo(
    () => ({
      paused,
      reduce,
      ambientActive: !paused && !reduce,
    }),
    [paused, reduce],
  );

  return (
    <StoryMotionContext.Provider value={value}>
      {children}
    </StoryMotionContext.Provider>
  );
}

export function useStoryMotion(): StoryMotionValue {
  return useContext(StoryMotionContext);
}

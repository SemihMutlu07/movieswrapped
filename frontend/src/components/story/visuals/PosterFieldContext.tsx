'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { DEFAULT_POSTER_FIELD, type PosterFieldConfig } from './posterFieldConfig';

const PosterFieldContext = createContext<PosterFieldConfig>(DEFAULT_POSTER_FIELD);

export function PosterFieldProvider({
  layout,
  children,
}: {
  layout: PosterFieldConfig;
  children: ReactNode;
}) {
  return <PosterFieldContext.Provider value={layout}>{children}</PosterFieldContext.Provider>;
}

export function usePosterField(): PosterFieldConfig {
  return useContext(PosterFieldContext);
}

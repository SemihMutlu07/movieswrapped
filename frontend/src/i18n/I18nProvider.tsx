'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { type MessageKey } from './catalogs';
import { createTranslator, type Translator } from './createTranslator';
import type { Locale } from './locales';
import type { MessageValues, PluralForms } from './interpolate';

export type I18nValue = Translator;

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => createTranslator(locale), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export type { MessageKey, MessageValues, PluralForms };

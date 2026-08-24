'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import LanguageSwitcher from '@/components/LanguageSwitcher';
import LoadingScreen from '@/components/landing/LoadingScreen';
import { I18nProvider } from '@/i18n/I18nProvider';
import { isLocale, type Locale } from '@/i18n/locales';
import { POSTER_GAME_MOVIES } from '@/lib/posterGameData';

function LoadingScreenPreviewInner() {
  const searchParams = useSearchParams();
  const requested = searchParams.get('locale');
  const locale: Locale = isLocale(requested) ? requested : 'en';

  const posterGame = useMemo(
    () => ({
      movie: POSTER_GAME_MOVIES[0],
      level: 2,
      maxLevel: 5,
      wrongGuesses: 1,
      score: 180,
      nextPoints: 80,
      onWrongGuess: () => undefined,
      onCorrectGuess: () => undefined,
      revealedAnswer: false,
    }),
    [],
  );

  return (
    <I18nProvider locale={locale}>
      <LanguageSwitcher />
      <LoadingScreen
        mode="scrape"
        onCancel={() => undefined}
        typicalSeconds={30}
        events={[{ metrics: { films: 1284 }, message: 'Reading diary page 12' }]}
        posterGame={posterGame}
      />
    </I18nProvider>
  );
}

/** Internal visual harness for loading-screen layout checks. */
export default function LoadingScreenPreviewPage() {
  return (
    <Suspense fallback={null}>
      <LoadingScreenPreviewInner />
    </Suspense>
  );
}

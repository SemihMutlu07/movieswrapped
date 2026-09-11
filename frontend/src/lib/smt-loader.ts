import { persistStats } from '@/lib/stats-storage';
import { resultPath, storyPath } from '@/lib/routes';
import { LOCALE_STORAGE_KEY, isLocale, localeFromLanguage, type Locale } from '@/i18n/locales';

type FixtureResponse = {
  username?: string;
  summary?: { details?: unknown };
  error?: string;
};

export type SmtDestination = 'story' | 'results';

export function resolveFixtureLocale(
  storage: Storage = globalThis.localStorage,
  navigatorLike: { languages?: readonly string[]; language?: string } = globalThis.navigator,
): Locale {
  try {
    const stored = storage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // storage unavailable (privacy mode) — fall through to system language
  }
  return localeFromLanguage(navigatorLike.languages?.[0] ?? navigatorLike.language);
}

export async function loadSmtFixture(
  fetchFixture: typeof fetch = fetch,
  storage: Storage = globalThis.localStorage,
  navigate: (url: string) => void = (url) => window.location.replace(url),
  locale?: Locale,
  destination: SmtDestination = 'story',
) {
  const resolvedLocale = locale ?? resolveFixtureLocale(storage);
  const response = await fetchFixture('/demo/smt-fixture.json', { cache: 'no-store' });
  const payload = (await response.json()) as FixtureResponse;
  const stats = payload.summary?.details;
  if (!response.ok || !stats || typeof stats !== 'object' || !payload.username) {
    throw new Error(payload.error || 'The local fixture response was incomplete.');
  }
  // Same quota-aware write as a live ZIP analysis, so /smt exercises the story path.
  persistStats(stats);
  sessionStorage.setItem('username', payload.username);
  sessionStorage.setItem('lb_username', payload.username);
  const path = destination === 'results'
    ? resultPath(payload.username, resolvedLocale)
    : storyPath(payload.username, resolvedLocale);
  navigate(path);
}

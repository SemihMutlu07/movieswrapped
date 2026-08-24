'use client';

import { usePathname, useSearchParams } from 'next/navigation';

import { isStoryPath } from '@/components/story/storyChrome';
import { useI18n } from '@/i18n/I18nProvider';
import { LOCALE_STORAGE_KEY, type Locale } from '@/i18n/locales';
import { localizePath } from '@/i18n/routing';

function isResultsPath(pathname: string): boolean {
  return /(?:^|\/)results(?:\/|$)/.test(pathname);
}

export function LanguageSwitchControl({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const { locale, t } = useI18n();

  const selectLocale = (nextLocale: Locale) => {
    if (nextLocale === locale) return;
    localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    const query = searchParams.toString();
    const hash = window.location.hash;
    window.location.assign(localizePath(`${pathname}${query ? `?${query}` : ''}${hash}`, nextLocale));
  };

  return (
    <>
      <span className="sr-only">{t('language.label')}</span>
      {(['en', 'tr'] as const).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => selectLocale(item)}
          aria-pressed={locale === item}
          aria-label={item === 'en' ? t('language.english') : t('language.turkish')}
          className={`rounded-full font-bold transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${
            compact
              ? 'min-h-7 min-w-8 px-2 text-[10px] tracking-[0.08em]'
              : 'min-h-9 min-w-11 px-3 text-xs'
          } ${
            locale === item
              ? compact
                ? 'bg-amber-300 text-stone-950'
                : 'bg-white text-[#17202a]'
              : 'text-white/60 hover:text-white'
          }`}
        >
          {item.toUpperCase()}
        </button>
      ))}
    </>
  );
}

export function StoryLanguageSwitch() {
  return (
    <div
      data-testid="story-language-switch"
      className="rounded-full border border-white/10 bg-black/55 p-0.5 shadow-md backdrop-blur-md"
    >
      <LanguageSwitchControl compact />
    </div>
  );
}

export default function LanguageSwitcher({
  variant = 'fixed',
}: {
  variant?: 'fixed' | 'inline';
}) {
  const pathname = usePathname() || '/';
  if (variant === 'fixed' && (isStoryPath(pathname) || isResultsPath(pathname))) {
    return null;
  }

  return (
    <div
      className={
        variant === 'fixed'
          ? 'fixed right-3 top-[var(--mw-top-chrome-offset)] z-[90] rounded-full border border-white/10 bg-[#111820]/90 p-1 shadow-lg backdrop-blur-md'
          : 'relative z-10 shrink-0 rounded-full border border-white/10 bg-[#111820]/90 p-1 shadow-lg backdrop-blur-md'
      }
    >
      <LanguageSwitchControl />
    </div>
  );
}

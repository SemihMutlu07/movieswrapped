'use client';

import type { LandingViewProps } from '@/components/landing/landingTypes';
import { useI18n } from '@/i18n/I18nProvider';

export default function UsernameScrapeSection({ view }: { view: LandingViewProps }) {
  const { t } = useI18n();
  return (
    <section aria-label={t('landing.username.section')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void view.handleScrape();
        }}
      >
        <div className="flex flex-col gap-2 min-[380px]:flex-row min-[380px]:items-stretch sm:gap-3">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t('landing.username.title')}</span>
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[#678]">@</span>
            <input
              type="text"
              name="username"
              value={view.usernameInput}
              onChange={(e) => view.setUsernameInput(e.target.value)}
              onFocus={() => view.setUsernameFocused(true)}
              onBlur={() => view.setUsernameFocused(false)}
              placeholder={view.usernamePlaceholder}
              autoComplete="username"
              spellCheck={false}
              className="w-full rounded-none border border-[#456] bg-[#1b2228] py-3 pl-8 pr-3 text-base text-white placeholder:text-[#678] focus:outline-none focus:ring-2 focus:ring-[#00e054]/70"
            />
          </label>
          <button
            type="submit"
            disabled={!view.usernameInput.trim()}
            className="min-h-12 w-full shrink-0 rounded-none bg-[#00e054] px-4 py-3 text-sm font-bold text-[#14181c] transition disabled:cursor-not-allowed disabled:bg-[#303840] disabled:text-[#678] min-[380px]:w-auto sm:px-5"
          >
            {t('landing.username.analyze')}
          </button>
        </div>
      </form>
    </section>
  );
}

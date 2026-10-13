'use client';

import type { LandingViewProps } from '@/components/landing/landingTypes';
import ErrorBanner from '@/components/ErrorBanner';
import { useI18n } from '@/i18n/I18nProvider';

export function LandingFeedback({
  view,
  bannerClassName,
}: {
  view: LandingViewProps;
  bannerClassName?: string;
}) {
  const { t } = useI18n();

  return (
    <>
      {view.translatedError && (
        <ErrorBanner
          error={view.translatedError}
          onDismiss={view.clearError}
          onRetry={view.handleRetry}
          onUpload={() => view.uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth' })}
        />
      )}

      {view.backendOffline && (
        <div
          className={
            bannerClassName ??
            'rounded-xl p-3 text-center'
          }
          style={
            bannerClassName
              ? undefined
              : { borderWidth: 1, borderColor: 'rgba(255, 127, 0, 0.4)', backgroundColor: 'rgba(255, 127, 0, 0.1)' }
          }
        >
          <p className="text-xs" style={{ color: '#ff7f00' }}>
            ⚠ {t('landing.error.backendUnreachable.message')} {t('landing.error.backendUnreachable.action')}
          </p>
        </div>
      )}
    </>
  );
}

export function LandingContributors({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <section aria-label={t('landing.contributors.label')} className={className ?? 'text-center space-y-1.5'}>
      <p className="text-xs font-medium tracking-wide text-white/55 uppercase">
        {t('landing.contributors.label')}
      </p>
      <p className="text-sm leading-relaxed text-white/70">
        {t('landing.contributors.withBerdan')}
      </p>
      <p className="text-xs leading-relaxed text-white/45">
        {t('landing.contributors.thanks')}
      </p>
    </section>
  );
}

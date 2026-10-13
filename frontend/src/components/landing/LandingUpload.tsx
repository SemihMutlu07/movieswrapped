'use client';

import { DesktopRequiredNotice } from '@/components/DesktopRequiredNotice';
import ExportInstructions from '@/components/landing/ExportInstructions';
import UploadZone from '@/components/landing/UploadZone';
import { useI18n } from '@/i18n/I18nProvider';
import type { LandingViewProps, UploadZoneTone } from '@/components/landing/landingTypes';

export function LandingUpload({
  view,
  tone = 'default',
  compact = false,
  hintClassName = 'mt-4 text-center text-xs text-white/40',
  className,
}: {
  view: LandingViewProps;
  tone?: UploadZoneTone;
  compact?: boolean;
  hintClassName?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const showUpload = !view.isPhone || view.allowPhoneUpload;
  const upload = showUpload ? (
    <>
      <UploadZone onFiles={view.handleFiles} tone={tone} />
      <p className={hintClassName}>{t('landing.upload.quickPath')}</p>
    </>
  ) : (
    <DesktopRequiredNotice surface="landing" />
  );
  const exportHelp = <ExportInstructions compact={compact} tone={tone} />;
  const ctaFirst = tone === 'wrapped';

  return (
    <section
      ref={view.uploadSectionRef}
      aria-label={t('landing.upload.modalTitle')}
      className={className}
    >
      {ctaFirst ? (
        <>
          {upload}
          <div className="mt-5">{exportHelp}</div>
        </>
      ) : (
        <>
          {exportHelp}
          <div className={compact ? 'mt-4' : 'mt-6'}>{upload}</div>
        </>
      )}
    </section>
  );
}

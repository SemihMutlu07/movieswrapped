'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Ref } from 'react';

import type { ShareCardData, ShareVariant } from '@/components/share/types';
import { useI18n } from '@/i18n/I18nProvider';

import { VariantPage } from './VariantPage';
import type { Orientation } from './types';

type CardPreviewProps = {
  previewRef: Ref<HTMLDivElement | null>;
  variantKey: ShareVariant;
  variantLabel: string;
  variantCount: number;
  activeIdx: number;
  pageW: number;
  pageH: number;
  target: { w: number; h: number };
  data: ShareCardData;
  orientation: Orientation;
  isSaving: boolean;
  onPrev: () => void;
  onNext: () => void;
};

export function CardPreview({
  previewRef,
  variantKey,
  variantLabel,
  variantCount,
  activeIdx,
  pageW,
  pageH,
  target,
  data,
  orientation,
  isSaving,
  onPrev,
  onNext,
}: CardPreviewProps) {
  const { t } = useI18n();
  const canPrev = activeIdx > 0;
  const canNext = activeIdx < variantCount - 1;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col md:bg-black/20">
      <div
        ref={previewRef}
        data-active="true"
        data-variant={variantKey}
        className="flex min-h-0 flex-1 items-center justify-center px-3 py-2 md:px-6 md:py-5"
        style={{ minHeight: 220 }}
      >
        {pageW > 0 && pageH > 0 && (
          <VariantPage
            variantKey={variantKey}
            target={target}
            pageW={pageW}
            pageH={pageH}
            data={data}
            orientation={orientation}
          />
        )}
      </div>

      {variantCount > 1 && (
        <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden items-center justify-between px-1 md:flex">
          <button
            type="button"
            onClick={onPrev}
            disabled={isSaving || !canPrev}
            aria-label={t('share.previousDesign')}
            className={`pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-[#1a1a1a]/90 text-white transition ${
              canPrev ? 'hover:bg-white/10' : 'cursor-default opacity-30'
            }`}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={isSaving || !canNext}
            aria-label={t('share.nextDesign')}
            className={`pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-[#1a1a1a]/90 text-white transition ${
              canNext ? 'hover:bg-white/10' : 'cursor-default opacity-30'
            }`}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      <p className="sr-only">
        {variantLabel} · {activeIdx + 1}/{variantCount}
      </p>
    </div>
  );
}

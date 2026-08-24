'use client';

import type { UIEventHandler, Ref } from 'react';

import type { ShareCardData, ShareVariant } from '@/components/share/types';
import { useI18n } from '@/i18n/I18nProvider';

import { VariantPage } from './VariantPage';
import type { Orientation } from './types';

type VariantRailProps = {
  railRef: Ref<HTMLDivElement | null>;
  availableVariants: ReadonlyArray<{ key: ShareVariant; label: string }>;
  activeIdx: number;
  pageW: number;
  pageH: number;
  target: { w: number; h: number };
  effectiveCardProps: ShareCardData;
  orientation: Orientation;
  isSaving: boolean;
  onScroll: UIEventHandler<HTMLDivElement>;
  onJumpTo: (idx: number) => void;
};

export function VariantRail({
  railRef,
  availableVariants,
  activeIdx,
  pageW,
  pageH,
  target,
  effectiveCardProps,
  orientation,
  isSaving,
  onScroll,
  onJumpTo,
}: VariantRailProps) {
  const { t } = useI18n();

  return (
  <>
    <div
      ref={railRef}
      onScroll={onScroll}
      className={`min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden ${
        isSaving ? 'pointer-events-none' : ''
      }`}
      style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', minHeight: 280 }}
    >
      <div className="flex h-full" style={{ width: pageW > 0 ? `${pageW * availableVariants.length}px` : '100%' }}>
        {availableVariants.map((v, i) => {
          const isActive = i === activeIdx;
          const inBudget = Math.abs(i - activeIdx) <= 1;
          return (
            <section
              key={v.key}
              data-variant={v.key}
              data-active={isActive}
              className="flex shrink-0 snap-center snap-always items-center justify-center px-4"
              style={{ width: pageW || '100%', height: '100%' }}
            >
              {inBudget && pageW > 0 && pageH > 0 && (
                <VariantPage
                  variantKey={v.key}
                  target={target}
                  pageW={pageW}
                  pageH={pageH}
                  data={effectiveCardProps}
                  orientation={orientation}
                />
              )}
            </section>
          );
        })}
      </div>
    </div>

    <div className="flex items-center justify-center gap-1.5 pb-3 pt-2 md:pb-5">
      {availableVariants.map((v, i) => (
        <button
          key={v.key}
          onClick={() => onJumpTo(i)}
          disabled={isSaving}
          aria-current={i === activeIdx ? 'true' : undefined}
          aria-label={t('share.goTo').replace('{variant}', v.label)}
          className={`relative h-1.5 rounded-full transition-all duration-300 after:absolute after:inset-x-0 after:-inset-y-[19px] after:content-[''] ${
            i === activeIdx ? 'w-5 bg-white' : 'w-1.5 bg-white/30 hover:bg-white/50'
          }`}
        />
      ))}
    </div>
  </>
  );
}

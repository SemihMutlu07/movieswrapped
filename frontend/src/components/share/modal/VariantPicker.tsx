'use client';

import type { ShareVariant } from '@/components/share/types';
import { useI18n } from '@/i18n/I18nProvider';

type VariantPickerProps = {
  variants: ReadonlyArray<{ key: ShareVariant; label: string }>;
  activeIdx: number;
  isSaving: boolean;
  onSelect: (idx: number) => void;
};

export function VariantPicker({
  variants,
  activeIdx,
  isSaving,
  onSelect,
}: VariantPickerProps) {
  const { t } = useI18n();

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {t('share.designs')}
      </p>
      <div
        role="radiogroup"
        aria-label={t('share.designs')}
        className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] md:flex-wrap md:overflow-visible"
      >
        {variants.map((variant, index) => {
          const active = index === activeIdx;
          return (
            <button
              key={variant.key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={isSaving}
              onClick={() => onSelect(index)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                active
                  ? 'bg-orange-400 text-black'
                  : 'bg-white/8 text-slate-300 hover:bg-white/12 hover:text-white'
              }`}
            >
              {variant.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

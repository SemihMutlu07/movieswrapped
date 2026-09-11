'use client';

import { X } from 'lucide-react';

import { useI18n } from '@/i18n/I18nProvider';

type ShareModalHeaderProps = {
  variantLabel: string;
  activeIdx: number;
  variantCount: number;
  isSaving: boolean;
  onClose: () => void;
};

export function ShareModalHeader({
  variantLabel,
  activeIdx,
  variantCount,
  isSaving,
  onClose,
}: ShareModalHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between border-b border-white/8 px-5 pb-2 pt-4 md:px-6 md:py-3">
      <div>
        <span id="share-modal-title" className="block text-sm font-semibold text-white/90">{t('share.title')}</span>
        <span className="block text-[11px] text-slate-500">
          {variantLabel} · {activeIdx + 1}/{variantCount}
        </span>
      </div>
      <button
        onClick={onClose}
        disabled={isSaving}
        className="grid place-items-center w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 transition text-white"
        aria-label={t('share.close')}
      >
        <X size={18} strokeWidth={2.5} />
      </button>
    </div>
  );
}

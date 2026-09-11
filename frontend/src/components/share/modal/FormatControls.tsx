'use client';

import { Monitor, Smartphone } from 'lucide-react';

import { useI18n } from '@/i18n/I18nProvider';

import type { Orientation } from './types';

type FormatControlsProps = {
  orientation: Orientation;
  setOrientation: (o: Orientation) => void;
  isSaving: boolean;
};

export function FormatControls({
  orientation,
  setOrientation,
  isSaving,
}: FormatControlsProps) {
  const { t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t('share.formatGroup')}
      className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1"
    >
      <button
        type="button"
        onClick={() => setOrientation('vertical')}
        disabled={isSaving}
        className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium transition ${
          orientation === 'vertical'
            ? 'bg-white/15 text-white'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Smartphone size={14} strokeWidth={2.25} />
        {t('share.portrait')}
      </button>
      <button
        type="button"
        onClick={() => setOrientation('horizontal')}
        disabled={isSaving}
        className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium transition ${
          orientation === 'horizontal'
            ? 'bg-white/15 text-white'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Monitor size={14} strokeWidth={2.25} />
        {t('share.landscape')}
      </button>
    </div>
  );
}

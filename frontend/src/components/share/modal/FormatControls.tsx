'use client';

import { useId, useRef, type ReactNode } from 'react';
import { X, Sliders } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { useI18n } from '@/i18n/I18nProvider';

import { SharePopover } from './SharePopover';
import type { Orientation } from './types';

type FormatControlsProps = {
  orientation: Orientation;
  setOrientation: (o: Orientation) => void;
  isSaving: boolean;
  showSwapTrigger: boolean;
  showSwapHint: boolean;
  hintFading: boolean;
  swapOpen: boolean;
  onSwapOpenChange: (open: boolean) => void;
  onDismissSwapHint: () => void;
  swapPanel: ReactNode;
};

export function FormatControls({
  orientation,
  setOrientation,
  isSaving,
  showSwapTrigger,
  showSwapHint,
  hintFading,
  swapOpen,
  onSwapOpenChange,
  onDismissSwapHint,
  swapPanel,
}: FormatControlsProps) {
  const { t } = useI18n();
  const tuneButtonRef = useRef<HTMLButtonElement>(null);
  const tunePanelId = useId();

  return (
    <div
      role="group"
      aria-label={t('share.formatGroup')}
      className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
    >
      <div className="grid min-w-0 grid-cols-2 gap-1 rounded-xl bg-white/5 p-1">
        <button
          type="button"
          onClick={() => setOrientation('vertical')}
          disabled={isSaving}
          className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
            orientation === 'vertical'
              ? 'bg-white/15 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {t('share.story')}
        </button>
        <button
          type="button"
          onClick={() => setOrientation('horizontal')}
          disabled={isSaving}
          className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
            orientation === 'horizontal'
              ? 'bg-white/15 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {t('share.landscape')}
        </button>
      </div>
      {showSwapTrigger && (
        <div className="relative">
          <AnimatePresence>
            {showSwapHint && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 4 }}
                animate={{ opacity: hintFading ? 0 : 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
                className="absolute bottom-full right-0 z-20 mb-2 flex max-w-[min(18rem,calc(100vw-2.5rem))] items-center gap-2 rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 shadow-lg backdrop-blur"
              >
                <span className="text-xs text-slate-300">{t('share.swapHint')}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDismissSwapHint(); }}
                  className="leading-none text-slate-500 transition-colors hover:text-white"
                  aria-label={t('share.dismissHint')}
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
                <div className="absolute -bottom-1.5 right-3 h-3 w-3 rotate-45 border-b border-r border-white/10 bg-[#1a1a1a]" />
              </motion.div>
            )}
          </AnimatePresence>
          <button
            ref={tuneButtonRef}
            type="button"
            onClick={() => {
              onSwapOpenChange(!swapOpen);
              onDismissSwapHint();
            }}
            disabled={isSaving}
            aria-label={t('share.tune')}
            aria-expanded={swapOpen}
            aria-controls={swapOpen ? tunePanelId : undefined}
            aria-haspopup="dialog"
            className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full transition ${
              swapOpen ? 'bg-white/15 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            {showSwapHint && !hintFading && (
              <span className="absolute inset-0 animate-ping rounded-full border border-white/20" />
            )}
            <Sliders size={16} />
          </button>
          <SharePopover
            open={swapOpen}
            onOpenChange={onSwapOpenChange}
            anchorRef={tuneButtonRef}
            panelId={tunePanelId}
            label={t('share.tune')}
          >
            {swapPanel}
          </SharePopover>
        </div>
      )}
    </div>
  );
}

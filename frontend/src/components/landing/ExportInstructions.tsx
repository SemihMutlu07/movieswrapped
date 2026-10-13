'use client';
import React, { useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useI18n } from '@/i18n/I18nProvider';

export const LETTERBOXD_DATA_SETTINGS_URL = 'https://letterboxd.com/settings/data/';

function ExportSteps({ accentClassName }: { accentClassName: string }) {
  const { t } = useI18n();
  return (
    <ol className="list-inside list-decimal space-y-2 pl-1">
      <li>{t('landing.export.step1.before')} <strong className={accentClassName}>{t('landing.export.step1.profile')}</strong> &rarr; <strong className={accentClassName}>{t('landing.export.step1.settings')}</strong></li>
      <li>{t('landing.export.step2.before')} <strong className={accentClassName}>{t('landing.export.step2.data')}</strong> {t('landing.export.step2.after')}</li>
      <li>{t('landing.export.step3.before')} <strong className={accentClassName}>{t('landing.export.step3.action')}</strong></li>
      <li>{t('landing.export.confirm.before')} <strong className={accentClassName}>{t('landing.export.confirm.action')}</strong></li>
      <li>{t('landing.export.step4.before')} <strong className={accentClassName}>{t('landing.export.step4.file')}</strong> {t('landing.export.step4.after')}</li>
      <li>{t('landing.export.step5')}</li>
    </ol>
  );
}

export default function ExportInstructions({
  compact = false,
  tone = 'default',
}: {
  compact?: boolean;
  tone?: 'default' | 'wrapped';
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useI18n();

  if (tone === 'wrapped') {
    return (
      <section className="w-full text-left">
        <p className="text-sm leading-relaxed text-[#9ab]">
          <a
            href={LETTERBOXD_DATA_SETTINGS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#00e054] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e054]/60"
          >
            {t('landing.export.open')}
          </a>
        </p>
        <details className="group mt-4 border-t border-[#303840] pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-white [&::-webkit-details-marker]:hidden">
            {t('landing.export.title')}
            <ChevronDown className="h-4 w-4 shrink-0 text-[#678] transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 text-sm leading-relaxed text-[#9ab]">
            <ExportSteps accentClassName="text-white" />
          </div>
        </details>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-2xl text-left">
      <a
        href={LETTERBOXD_DATA_SETTINGS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#00e054] px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#2ee36a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e054]/60"
      >
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        {t('landing.export.open')}
      </a>
      <p className={`mt-3 text-center text-xs leading-relaxed text-white/50 sm:text-sm ${compact ? 'hidden sm:block' : ''}`}>
        {t('landing.export.hint')}
      </p>
      <div className="mt-4 rounded-2xl border border-slate-700/60 bg-slate-800/40 px-4 py-3 sm:px-6 sm:py-4">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center justify-between text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50"
        >
          <span className="text-base font-semibold text-gray-200 sm:text-lg">{t('landing.export.title')}</span>
          <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.3 }}>
            <ChevronDown className="h-5 w-5 text-gray-400" />
          </motion.div>
        </button>
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-3 text-sm text-slate-300 sm:mt-4 sm:text-base">
                <ExportSteps accentClassName="text-orange-400" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

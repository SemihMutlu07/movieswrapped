'use client';

import type { ShareCardInput } from '@/components/share/types';
import { useI18n } from '@/i18n/I18nProvider';

import { lastName } from './lastName';

type SwapDrawerProps = {
  cardProps: ShareCardInput;
  hasActors: boolean;
  hasDirectors: boolean;
  actorIdx: number;
  directorIdx: number;
  isSaving: boolean;
  onActorIdxChange: (idx: number) => void;
  onDirectorIdxChange: (idx: number) => void;
};

/** Swap controls body — rendered inside SharePopover near the tune button. */
function chipClass(active: boolean, tone: 'actor' | 'director') {
  if (active && tone === 'actor') return 'bg-[#5c2438] text-rose-100';
  if (active && tone === 'director') return 'bg-[#1d4d5c] text-cyan-100';
  return 'bg-white/10 text-slate-300 hover:bg-white/15 hover:text-white';
}

export function SwapDrawer({
  cardProps,
  hasActors,
  hasDirectors,
  actorIdx,
  directorIdx,
  isSaving,
  onActorIdxChange,
  onDirectorIdxChange,
}: SwapDrawerProps) {
  const { t } = useI18n();

  return (
    <div
      data-testid="share-swap-drawer"
      className="w-full min-w-0 space-y-3 rounded-2xl border border-white/10 bg-[#141414] px-3 py-3 sm:min-w-[16rem] sm:px-4"
    >
      {hasActors && (
        <fieldset className="min-w-0 space-y-1.5">
          <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {t('share.actor')}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {cardProps.topActors!.slice(0, 3).map((a, i) => (
              <button
                key={a.name}
                type="button"
                onClick={() => onActorIdxChange(i)}
                disabled={isSaving}
                aria-pressed={actorIdx === i}
                className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${chipClass(actorIdx === i, 'actor')}`}
              >
                {lastName(a.name)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {hasDirectors && (
        <fieldset className="min-w-0 space-y-1.5">
          <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {t('share.director')}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {cardProps.topDirectors!.slice(0, 3).map((d, i) => (
              <button
                key={d.name}
                type="button"
                onClick={() => onDirectorIdxChange(i)}
                disabled={isSaving}
                aria-pressed={directorIdx === i}
                className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${chipClass(directorIdx === i, 'director')}`}
              >
                {lastName(d.name)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

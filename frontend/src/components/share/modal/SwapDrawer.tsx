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
    <div className="min-w-[16rem] max-w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-xs backdrop-blur space-y-2">
      {hasActors && (
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-slate-400">{t('share.actor')}</span>
          <div className="flex flex-wrap items-center gap-1">
            {cardProps.topActors!.slice(0, 3).map((a, i) => (
              <button
                key={a.name}
                type="button"
                onClick={() => onActorIdxChange(i)}
                disabled={isSaving}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  actorIdx === i
                    ? 'bg-pink-500/15 text-pink-300'
                    : 'bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                {lastName(a.name)}
              </button>
            ))}
          </div>
        </div>
      )}
      {hasDirectors && (
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-slate-400">{t('share.director')}</span>
          <div className="flex flex-wrap items-center gap-1">
            {cardProps.topDirectors!.slice(0, 3).map((d, i) => (
              <button
                key={d.name}
                type="button"
                onClick={() => onDirectorIdxChange(i)}
                disabled={isSaving}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  directorIdx === i
                    ? 'bg-cyan-500/15 text-cyan-300'
                    : 'bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                {lastName(d.name)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

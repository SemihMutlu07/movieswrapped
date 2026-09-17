'use client';

import type { ShareCardInput, SharePersonStat } from '@/components/share/types';
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

function chipClass(active: boolean) {
  return active
    ? 'bg-orange-400 text-black'
    : 'bg-white/8 text-slate-300 hover:bg-white/12 hover:text-white';
}

function PersonChip({
  person,
  active,
  disabled,
  onSelect,
}: {
  person: SharePersonStat;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const label = person.name.trim() || lastName(person.name);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      className={`flex max-w-full items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-semibold transition-colors ${chipClass(active)}`}
    >
      {person.headshotUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={person.headshotUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${
          active ? 'bg-black/15' : 'bg-white/10'
        }`}>
          {lastName(person.name).slice(0, 1)}
        </span>
      )}
      <span className="truncate">{label}</span>
    </button>
  );
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

  if (!hasActors && !hasDirectors) return null;

  return (
    <div data-testid="share-swap-drawer" className="min-w-0 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {t('share.people')}
      </p>
      {hasActors && (
        <fieldset className="min-w-0 space-y-1.5">
          <legend className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {t('share.actor')}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {cardProps.topActors!.map((person, index) => (
              <PersonChip
                key={person.name}
                person={person}
                active={actorIdx === index}
                disabled={isSaving}
                onSelect={() => onActorIdxChange(index)}
              />
            ))}
          </div>
        </fieldset>
      )}
      {hasDirectors && (
        <fieldset className="min-w-0 space-y-1.5">
          <legend className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {t('share.director')}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {cardProps.topDirectors!.map((person, index) => (
              <PersonChip
                key={person.name}
                person={person}
                active={directorIdx === index}
                disabled={isSaving}
                onSelect={() => onDirectorIdxChange(index)}
              />
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

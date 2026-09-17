'use client';

import type { ShareCardInput, ShareVariant } from '@/components/share/types';
import { useI18n } from '@/i18n/I18nProvider';

import { ShareSaveButton } from './ShareSaveButton';
import { SwapDrawer } from './SwapDrawer';
import { UsernameToggle } from './UsernameToggle';
import { VariantPicker } from './VariantPicker';

type ShareModalSidebarProps = {
  cardProps: ShareCardInput;
  isSaving: boolean;
  showPeople: boolean;
  peopleOpen: boolean;
  onTogglePeople: () => void;
  hasActors: boolean;
  hasDirectors: boolean;
  actorIdx: number;
  directorIdx: number;
  setActorIdx: (idx: number) => void;
  setDirectorIdx: (idx: number) => void;
  showUsername: boolean;
  setShowUsername: (value: boolean | ((prev: boolean) => boolean)) => void;
  exportError: string | null;
  onSave: () => void;
  variants: ReadonlyArray<{ key: ShareVariant; label: string }>;
  activeIdx: number;
  onSelectVariant: (idx: number) => void;
};

export function ShareModalSidebar({
  cardProps,
  isSaving,
  showPeople,
  peopleOpen,
  onTogglePeople,
  hasActors,
  hasDirectors,
  actorIdx,
  directorIdx,
  setActorIdx,
  setDirectorIdx,
  showUsername,
  setShowUsername,
  exportError,
  onSave,
  variants,
  activeIdx,
  onSelectVariant,
}: ShareModalSidebarProps) {
  const { t } = useI18n();

  return (
    <div
      data-share-controls="bottom"
      className="relative shrink-0 space-y-3 border-t border-white/8 px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-3 md:space-y-4 md:px-6 md:py-4"
    >
      <VariantPicker
        variants={variants}
        activeIdx={activeIdx}
        isSaving={isSaving}
        onSelect={onSelectVariant}
      />

      <div className="flex flex-wrap items-center gap-2">
        {showPeople && (
          <button
            type="button"
            aria-expanded={peopleOpen}
            aria-controls="share-people-picker"
            disabled={isSaving}
            onClick={onTogglePeople}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              peopleOpen
                ? 'bg-orange-400 text-black'
                : 'bg-white/8 text-slate-300 hover:bg-white/12 hover:text-white'
            }`}
          >
            {t('share.tune')}
          </button>
        )}
        {cardProps.username && (
          <UsernameToggle
            username={cardProps.username}
            showUsername={showUsername}
            isSaving={isSaving}
            onToggle={() => setShowUsername((value) => !value)}
          />
        )}
        <ShareSaveButton isSaving={isSaving} onSave={onSave} />
      </div>

      {showPeople && peopleOpen && (
        <div id="share-people-picker">
          <SwapDrawer
            cardProps={cardProps}
            hasActors={hasActors}
            hasDirectors={hasDirectors}
            actorIdx={actorIdx}
            directorIdx={directorIdx}
            isSaving={isSaving}
            onActorIdxChange={setActorIdx}
            onDirectorIdxChange={setDirectorIdx}
          />
        </div>
      )}

      {exportError && (
        <p role="alert" className="text-xs text-red-300">
          {exportError}
        </p>
      )}
    </div>
  );
}

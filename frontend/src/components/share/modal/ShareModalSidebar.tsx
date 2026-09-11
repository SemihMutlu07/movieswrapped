'use client';

import type { ShareCardInput } from '@/components/share/types';

import { ShareSaveButton } from './ShareSaveButton';
import { SwapDrawer } from './SwapDrawer';
import { UsernameToggle } from './UsernameToggle';

type ShareModalSidebarProps = {
  cardProps: ShareCardInput;
  isSaving: boolean;
  showPeople: boolean;
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
};

export function ShareModalSidebar({
  cardProps,
  isSaving,
  showPeople,
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
}: ShareModalSidebarProps) {
  return (
    <div className="relative shrink-0 space-y-3 border-t border-white/8 px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-3 md:w-[300px] md:space-y-5 md:overflow-y-auto md:border-l md:border-t-0 md:border-white/10 md:px-6 md:py-5 lg:w-[320px]">
      {showPeople && (
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
      )}

      {cardProps.username && (
        <UsernameToggle
          username={cardProps.username}
          showUsername={showUsername}
          isSaving={isSaving}
          onToggle={() => setShowUsername((value) => !value)}
        />
      )}

      {exportError && (
        <p role="alert" className="text-xs text-red-300">
          {exportError}
        </p>
      )}

      <ShareSaveButton isSaving={isSaving} onSave={onSave} />
    </div>
  );
}

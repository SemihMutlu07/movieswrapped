'use client';

import type { ShareCardInput } from '@/components/share/types';

import { FormatControls } from './FormatControls';
import { ShareSaveButton } from './ShareSaveButton';
import { SwapDrawer } from './SwapDrawer';
import { UsernameToggle } from './UsernameToggle';
import type { Orientation } from './types';

type ShareModalSidebarProps = {
  cardProps: ShareCardInput;
  orientation: Orientation;
  setOrientation: (o: Orientation) => void;
  isSaving: boolean;
  showSwapTrigger: boolean;
  hasActors: boolean;
  hasDirectors: boolean;
  swapOpen: boolean;
  setSwapOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  showSwapHint: boolean;
  hintFading: boolean;
  dismissSwapHint: () => void;
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
  orientation,
  setOrientation,
  isSaving,
  showSwapTrigger,
  hasActors,
  hasDirectors,
  swapOpen,
  setSwapOpen,
  showSwapHint,
  hintFading,
  dismissSwapHint,
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
    <div className="relative space-y-3 px-5 pb-6 pt-3 md:w-[300px] md:shrink-0 md:space-y-5 md:overflow-y-auto md:border-l md:border-white/10 md:px-6 md:py-5 lg:w-[340px]">
      <FormatControls
        orientation={orientation}
        setOrientation={setOrientation}
        isSaving={isSaving}
        showSwapTrigger={showSwapTrigger}
        showSwapHint={showSwapHint}
        hintFading={hintFading}
        swapOpen={swapOpen}
        onSwapOpenChange={setSwapOpen}
        onDismissSwapHint={dismissSwapHint}
        swapPanel={(
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
      />

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

'use client';

import { Suspense } from 'react';

import { StoryLanguageSwitch } from '@/components/LanguageSwitcher';

import { StoryPauseButton } from './StoryPauseButton';
import { StoryProgressBar } from './StoryProgressBar';
import type { Slide } from './types';

type StoryTopChromeProps = {
  slides: Slide[];
  index: number;
  progress: number;
  isPaused: boolean;
  isLast: boolean;
  onTogglePause: () => void;
};

export function StoryTopChrome({
  slides,
  index,
  progress,
  isPaused,
  isLast,
  onTogglePause,
}: StoryTopChromeProps) {
  return (
    <header
      data-testid="story-top-chrome"
      className="relative z-50 min-w-0 px-3 pb-2 pointer-events-auto md:px-5"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <StoryPauseButton isPaused={isPaused} isLast={isLast} onToggle={onTogglePause} />
        <div className="min-w-0 flex-1">
          <StoryProgressBar slides={slides} index={index} progress={progress} />
        </div>
        <Suspense fallback={<span className="inline-block h-7 w-[4.75rem]" aria-hidden />}>
          <StoryLanguageSwitch />
        </Suspense>
      </div>
    </header>
  );
}

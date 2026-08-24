'use client';

import type { Slide } from './types';

// Progress fill smoothing sits in the micro motion tier (120–180ms).
type StoryProgressBarProps = {
  slides: Slide[];
  index: number;
  progress: number;
};

export function StoryProgressBar({ slides, index, progress }: StoryProgressBarProps) {
  return (
    <div className="flex w-full min-w-0 gap-1" data-testid="story-progress-bar">
      {slides.map((slide, i) => (
        <div key={slide.key} className="h-0.5 min-w-0 flex-1 overflow-hidden bg-stone-700/70">
          {i < index && <div className="h-full w-full bg-amber-300" />}
          {i === index && (
            <div
              className="h-full bg-amber-300 transition-[width] duration-150 ease-linear"
              style={{ width: `${progress}%` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

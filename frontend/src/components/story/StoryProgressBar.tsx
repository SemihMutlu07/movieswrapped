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
    <div
      className="flex w-full min-w-0 gap-[3px]"
      data-testid="story-progress-bar"
      data-story-progress-count={slides.length}
    >
      {slides.map((slide, i) => (
        <div
          key={slide.key}
          className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/25"
        >
          {i < index && <div className="h-full w-full bg-amber-300" />}
          {i === index && (
            <div
              className="h-full bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.6)] transition-[width] duration-150 ease-linear"
              style={{ width: `${progress}%` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

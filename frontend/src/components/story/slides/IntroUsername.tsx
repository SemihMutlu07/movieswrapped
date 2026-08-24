'use client';

import { Big } from '../SlideTypography';

type IntroUsernameProps = {
  username: string;
};

/**
 * Intro headline for @username. Uses the shared Big type scale so long names
 * wrap inside the card instead of nowrap-clipping off the viewport edge.
 */
export function IntroUsername({ username }: IntroUsernameProps) {
  return (
    <div data-testid="intro-username-headline" className="min-w-0 max-w-full">
      <Big>@{username}</Big>
    </div>
  );
}

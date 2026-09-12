import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { I18nProvider } from '@/i18n/I18nProvider';
import { Big, Label, Sub } from '@/components/story/SlideTypography';
import { StoryMotionProvider } from '@/components/story/motion/StoryMotionContext';
import { StoryNavigation } from '@/components/story/StoryNavigation';
import { StoryTopChrome } from '@/components/story/StoryTopChrome';
import { MobileMediaRail } from '@/components/story/visuals/MobileMediaRail';
import type { Slide } from '@/components/story/types';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/story',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function wrap(ui: ReactNode) {
  return render(
    <I18nProvider locale="en">
      <StoryMotionProvider paused={false}>{ui}</StoryMotionProvider>
    </I18nProvider>,
  );
}

describe('story mobile layout primitives', () => {
  it('keeps story type wrapping inside the card width', () => {
    wrap(
      <>
        <Label>Movies Wrapped</Label>
        <Big>Woody Allen</Big>
        <Sub>A long supporting line that must reflow on a 320px card instead of clipping.</Sub>
      </>,
    );

    for (const node of [screen.getByText('Movies Wrapped'), screen.getByText('Woody Allen')]) {
      expect(node.className).toMatch(/min-w-0/);
      expect(node.className).toMatch(/break-words/);
      expect(node.className).not.toMatch(/whitespace-nowrap/);
      expect(node.className).not.toMatch(/tracking-\[0\.22em\]/);
    }
  });

  it('shows a single hero poster without a collapsing peek strip', () => {
    const media = [
      { type: 'poster' as const, url: '/a.jpg', alt: 'A poster' },
      { type: 'poster' as const, url: '/b.jpg', alt: 'B poster' },
      { type: 'poster' as const, url: '/c.jpg', alt: 'C poster' },
    ];
    const { container } = wrap(<MobileMediaRail media={media} accent="#f59e0b" />);
    const rail = screen.getByTestId('story-mobile-media-rail');
    const hero = rail.firstElementChild as HTMLElement;
    expect(hero).toHaveAttribute('data-story-peek', 'false');
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });
});

describe('story top chrome', () => {
  it('keeps locale off the progress segments and pause on the row below', () => {
    const slides = Array.from({ length: 12 }, (_, i) => ({ key: `slide-${i}` })) as Slide[];
    wrap(
      <StoryTopChrome
        slides={slides}
        index={2}
        progress={40}
        isPaused={false}
        isLast={false}
        onTogglePause={() => undefined}
      />,
    );
    const progress = screen.getByTestId('story-progress-bar');
    const locale = screen.getByTestId('story-language-switch');
    const row = progress.parentElement?.parentElement;
    expect(row).toContainElement(progress);
    expect(row).toContainElement(locale);
    expect(locale.className).toMatch(/shrink-0/);
    expect(screen.getByLabelText('English')).toHaveTextContent('EN');
    expect(screen.getByLabelText('Turkish')).toHaveTextContent('TR');
    expect(progress).toHaveAttribute('data-story-progress-count', '12');
    expect(progress.children).toHaveLength(12);
    expect(screen.getByLabelText('Pause story')).toBeInTheDocument();
  });
});

describe('story tap zones', () => {
  it('keeps Instagram-style hit targets without a visible amber outline', () => {
    wrap(
      <StoryNavigation
        isLast={false}
        locale="en"
        onPrevious={() => undefined}
        onNext={() => undefined}
        onReplay={() => undefined}
      />,
    );
    const previous = screen.getByLabelText('Previous slide');
    const next = screen.getByLabelText('Next slide');
    expect(previous).toHaveAttribute('data-story-tap', 'previous');
    expect(next).toHaveAttribute('data-story-tap', 'next');
    expect(previous.className).toMatch(/outline-none/);
    expect(next.className).toMatch(/outline-none/);
    expect(previous.className).not.toMatch(/outline-amber/);
    expect(next.className).not.toMatch(/outline-amber/);
    expect(next.className).toMatch(/w-2\/3/);
  });

  it('puts Open the dossier above Back and Replay on the finale', () => {
    wrap(
      <StoryNavigation
        isLast
        locale="en"
        onPrevious={() => undefined}
        onNext={() => undefined}
        onReplay={() => undefined}
      />,
    );
    const actions = screen.getByTestId('story-finale-actions');
    const labels = Array.from(actions.querySelectorAll('a, button')).map((node) => node.textContent);
    expect(labels[0]).toMatch(/Open the dossier/i);
    expect(labels.slice(1)).toEqual(['Back', 'Replay']);
  });
});

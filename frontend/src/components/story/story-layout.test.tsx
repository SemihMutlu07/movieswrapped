import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { I18nProvider } from '@/i18n/I18nProvider';
import { Big, Label, Sub } from '@/components/story/SlideTypography';
import { StoryMotionProvider } from '@/components/story/motion/StoryMotionContext';
import { MobileMediaRail } from '@/components/story/visuals/MobileMediaRail';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/story',
  useSearchParams: () => new URLSearchParams(),
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
    }
  });

  it('sizes the mobile poster rail with shrinking grid tracks', () => {
    const media = [
      { type: 'poster' as const, url: '/a.jpg', alt: 'A poster' },
      { type: 'poster' as const, url: '/b.jpg', alt: 'B poster' },
      { type: 'poster' as const, url: '/c.jpg', alt: 'C poster' },
      { type: 'poster' as const, url: '/d.jpg', alt: 'D poster' },
      { type: 'poster' as const, url: '/e.jpg', alt: 'E poster' },
    ];
    const { container } = wrap(<MobileMediaRail media={media} accent="#f59e0b" />);
    const rail = screen.getByTestId('story-mobile-media-rail');
    const grid = rail.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(container.querySelectorAll('img')).toHaveLength(3);
    expect(grid.className).toMatch(/min-w-0/);
  });
});

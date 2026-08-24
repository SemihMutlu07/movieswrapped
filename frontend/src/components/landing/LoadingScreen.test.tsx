import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import LoadingScreen from './LoadingScreen';
import { I18nProvider } from '@/i18n/I18nProvider';

vi.mock('@/lib/usePixelatedImage', () => ({
  usePixelatedImage: () => ({ canvasRef: { current: null }, loaded: true, error: false }),
}));

function renderLoading(
  locale: 'en' | 'tr',
  props: Partial<ComponentProps<typeof LoadingScreen>> = {},
) {
  return render(
    <I18nProvider locale={locale}>
      <LoadingScreen mode="scrape" onCancel={() => undefined} {...props} />
    </I18nProvider>,
  );
}

describe('LoadingScreen result transition', () => {
  it('keeps the loading state instead of exposing an early See Wrapped navigation button', () => {
    render(
      <I18nProvider locale="en">
        <LoadingScreen mode="scrape" resultReady="/results?u=alice" />
      </I18nProvider>,
    );

    expect(screen.queryByRole('button', { name: /see wrapped/i })).not.toBeInTheDocument();
  });

  it('uses the active locale for scrape progress copy', () => {
    renderLoading('tr');

    expect(screen.getByRole('heading', { name: 'Profilin taranıyor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'İptal' })).toBeInTheDocument();
  });

  it('shows the queued degraded-state message instead of normal progress when worker fleet is empty', () => {
    render(
      <I18nProvider locale="en">
        <LoadingScreen mode="scrape" queued />
      </I18nProvider>,
    );

    expect(screen.getByText(/Queued — the analysis worker is starting up/i)).toBeInTheDocument();
    // Normal "almost there" / elapsed copy must not appear in degraded mode.
    expect(screen.queryByText(/Almost there/i)).not.toBeInTheDocument();
  });

  it('hides the queued message when the fleet is healthy', () => {
    render(
      <I18nProvider locale="en">
        <LoadingScreen mode="scrape" queued={false} />
      </I18nProvider>,
    );

    expect(screen.queryByText(/Queued — the analysis worker is starting up/i)).not.toBeInTheDocument();
  });
});

describe('LoadingScreen mobile layout robustness', () => {
  it('keeps Cancel in document flow instead of overlaying the heading', () => {
    renderLoading('en');

    const heading = screen.getByRole('heading', { level: 1, name: 'Scanning your profile' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    expect(cancel.className).not.toMatch(/\babsolute\b/);
    expect(cancel.className).not.toMatch(/\bfixed\b/);
    expect(cancel.className).not.toMatch(/\btop-/);
    expect(cancel.className).not.toMatch(/\bright-/);

    const header = heading.closest('header');
    expect(header).not.toBeNull();
    expect(header).toContainElement(cancel);
    expect(header!.className).toMatch(/flex-col/);
    expect(header!.className).toMatch(/sm:grid-cols-\[minmax\(0,1fr\)_auto\]/);
    expect(heading.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('reserves top chrome space and lets the heading wrap instead of shrinking', () => {
    const { container } = renderLoading('en');
    const root = container.firstElementChild as HTMLElement;

    expect(root.className).toMatch(/pt-\[var\(--mw-top-chrome-reserve\)\]/);
    expect(root.className).toMatch(/min-w-0/);
    expect(root.className).toMatch(/overflow-x-hidden/);
    expect(root.className).toMatch(/px-4/);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.className).toMatch(/min-w-0/);
    expect(heading.className).toMatch(/break-words/);
    expect(heading.className).toMatch(/text-balance/);
    expect(heading.className).toMatch(/text-2xl/);
  });

  it('keeps long English and Turkish status copy wrappable', () => {
    const { rerender } = render(
      <I18nProvider locale="en">
        <LoadingScreen mode="scrape" queued />
      </I18nProvider>,
    );

    const englishQueued = screen.getByText(/Queued — the analysis worker is starting up/i);
    expect(englishQueued.className).toMatch(/break-words/);
    expect(englishQueued.className).toMatch(/text-pretty/);

    rerender(
      <I18nProvider locale="tr">
        <LoadingScreen mode="scrape" queued />
      </I18nProvider>,
    );

    const turkishQueued = screen.getByText(/Sıraya alındı/i);
    expect(turkishQueued.className).toMatch(/break-words/);
  });

  it('renders the poster game inside the loading card without overlay controls', () => {
    renderLoading('en', {
      events: [{ metrics: { films: 1284 }, message: 'Reading diary' }],
      posterGame: {
        movie: { title: 'The Godfather', poster_path: '/poster.jpg' },
        level: 2,
        maxLevel: 5,
        wrongGuesses: 1,
        score: 80,
        nextPoints: 60,
        onWrongGuess: () => undefined,
        onCorrectGuess: () => undefined,
        revealedAnswer: false,
      },
    });

    expect(screen.getByText('1,284')).toBeInTheDocument();
    expect(screen.getByText('films found')).toBeInTheDocument();
    expect(screen.getByText('Guess the poster')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guess' })).toHaveClass('shrink-0');
  });
});

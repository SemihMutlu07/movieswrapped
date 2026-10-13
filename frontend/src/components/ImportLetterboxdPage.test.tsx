import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';

const apiMocks = vi.hoisted(() => ({
  importScrape: vi.fn(),
}));

const analyticsMocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  trackConsentedEvent: vi.fn(),
  trackFilmStats: vi.fn(),
}));

const routerMocks = vi.hoisted(() => ({
  prefetch: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMocks,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, importScrape: apiMocks.importScrape };
});

vi.mock('@/lib/analytics', () => analyticsMocks);
vi.mock('@/lib/supabase/analysis_runs', () => ({
  startAnalysis: vi.fn().mockResolvedValue({ id: 'run-1' }),
  finishAnalysis: vi.fn(),
  buildSummaryForPersistence: vi.fn((stats: Record<string, unknown>) => ({ details: stats })),
}));
vi.mock('@/lib/supabase/sessions', () => ({
  upsertUserSession: vi.fn(),
}));

import ImportLetterboxdPage from './ImportLetterboxdPage';

describe('ImportLetterboxdPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    apiMocks.importScrape.mockResolvedValue({
      status: 'success',
      stats: { scraped_username: 'dave', total_films: 2, scraped_film_count: 2, scraped_diary_count: 1 },
    });
  });

  it('accepts bookmarklet postMessage JSON and analyzes', async () => {
    render(
      <I18nProvider locale="en">
        <ImportLetterboxdPage />
      </I18nProvider>,
    );
    expect(screen.getByText(/Use the bookmarklet/i)).toBeInTheDocument();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'mw-letterboxd',
          data: {
            user: 'dave',
            films: [{ title: 'Heat', year: 1995 }],
            diary: [{ title: 'Heat', watchedDate: '2024-01-02' }],
          },
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Got @dave: 1 films, 1 diary entries/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Analyze this export/i }));
    await waitFor(() => {
      expect(apiMocks.importScrape).toHaveBeenCalledWith(
        expect.objectContaining({ user: 'dave' }),
        expect.any(AbortSignal),
        expect.any(Function),
      );
    });
    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith('scrape_started', { method: 'bookmarklet' });
  });

  it('exposes a drag-and-copy bookmarklet React does not strip', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <I18nProvider locale="en">
        <ImportLetterboxdPage />
      </I18nProvider>,
    );

    const drag = screen.getByRole('link', { name: /movieswrapped export/i });
    const href = drag.getAttribute('href') ?? '';
    expect(href.startsWith('javascript:')).toBe(true);
    expect(href).toMatch(/LazyPoster/);
    expect(href).not.toMatch(/blocked a javascript/i);

    await userEvent.click(screen.getByRole('button', { name: /copy bookmarklet/i }));
    expect(writeText).toHaveBeenCalledWith(href);
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();
  });
});

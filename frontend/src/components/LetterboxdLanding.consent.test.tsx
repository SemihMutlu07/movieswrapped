import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/i18n/I18nProvider';

const apiMocks = vi.hoisted(() => ({
  scrapeProfile: vi.fn(),
  testBackend: vi.fn(),
}));

const analysisRunMocks = vi.hoisted(() => ({
  startAnalysis: vi.fn(),
  finishAnalysis: vi.fn(),
  buildSummaryForPersistence: vi.fn((stats: Record<string, unknown>) => ({ details: stats })),
}));

const sessionMocks = vi.hoisted(() => ({
  upsertUserSession: vi.fn(),
}));

const routerMocks = vi.hoisted(() => ({
  prefetch: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMocks,
}));

vi.mock('@/lib/api', () => ({
  analyzeFiles: vi.fn(),
  parseLetterboxdUsername: vi.fn(),
  scrapeProfile: apiMocks.scrapeProfile,
  testBackend: apiMocks.testBackend,
  isWorkerFleetEmpty: vi.fn().mockResolvedValue(false),
  ERROR_CODE_HINTS: {},
}));

vi.mock('@/lib/supabase/analysis_runs', () => analysisRunMocks);
vi.mock('@/lib/supabase/sessions', () => sessionMocks);
vi.mock('@/lib/analytics', () => ({
  getTmdbImageUrl: vi.fn(() => null),
  trackEvent: vi.fn(),
  trackConsentedEvent: vi.fn(),
  trackFilmStats: vi.fn(),
}));

import LetterboxdLanding from './LetterboxdLanding';

describe('LetterboxdLanding persistence consent gate', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
    apiMocks.testBackend.mockResolvedValue(undefined);
    apiMocks.scrapeProfile.mockResolvedValue({
      status: 'success',
      stats: {
        scraped_username: 'alice',
        total_films: 12,
        favorite_genre: { name: 'Drama', count: 4 },
      },
    });
    analysisRunMocks.startAnalysis.mockResolvedValue({ id: 'run-1' });
    analysisRunMocks.finishAnalysis.mockResolvedValue(undefined);
    sessionMocks.upsertUserSession.mockResolvedValue(undefined);
  });

  async function submitUsername() {
    const user = userEvent.setup();
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    await user.type(document.querySelector('input[name="username"]')!, 'alice');
    await user.click(screen.getByRole('button', { name: /analyze/i }));
    await waitFor(() => expect(apiMocks.scrapeProfile).toHaveBeenCalled());
  }

  it('does not persist an analysis or user session before explicit acceptance', async () => {
    await submitUsername();

    expect(analysisRunMocks.startAnalysis).not.toHaveBeenCalled();
    expect(analysisRunMocks.finishAnalysis).not.toHaveBeenCalled();
    expect(sessionMocks.upsertUserSession).not.toHaveBeenCalled();
  });

  it('persists the analysis and user session after explicit acceptance', async () => {
    sessionStorage.setItem('consent_decision', 'accept');

    await submitUsername();

    await waitFor(() => {
      expect(analysisRunMocks.startAnalysis).toHaveBeenCalledOnce();
      expect(analysisRunMocks.finishAnalysis).toHaveBeenCalledOnce();
      expect(sessionMocks.upsertUserSession).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'alice', consent: 'accept' }),
      );
    });
  });

  it('opens the story with persisted final stats even when no progress event arrives', async () => {
    let storedAtNavigation: Record<string, unknown> | null = null;
    routerMocks.push.mockImplementationOnce(() => {
      storedAtNavigation = JSON.parse(sessionStorage.getItem('letterboxdStats') ?? 'null');
    });

    await submitUsername();

    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith('/en/story?u=alice'));
    expect(storedAtNavigation).toMatchObject({ scraped_username: 'alice', total_films: 12 });
  });

  it('does not open an unfinished profile on analysis or postback traces', async () => {
    const { promise, resolve: finish } = Promise.withResolvers<unknown>();
    let reportProgress!: (progress: { trace_events: { stage: string }[] }) => void;
    apiMocks.scrapeProfile.mockImplementation((_username, _period, _signal, onProgress) => {
      reportProgress = onProgress;
      return promise;
    });
    await submitUsername();
    vi.useFakeTimers();
    try {
      await act(async () => {
        reportProgress({ trace_events: [{ stage: 'analysis_done' }, { stage: 'postback_started' }] });
      });
      await act(async () => { vi.advanceTimersByTime(3000); });
      expect(routerMocks.push).not.toHaveBeenCalled();
      expect(sessionStorage.getItem('letterboxdStats')).toBeNull();
      await act(async () => {
        finish({ stats: { scraped_username: 'alice', total_films: 12 } });
      });
      expect(routerMocks.push).toHaveBeenCalledWith('/en/story?u=alice');
      expect(JSON.parse(sessionStorage.getItem('letterboxdStats')!)).toMatchObject({
        scraped_username: 'alice',
        total_films: 12,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not store or open a cancelled result that completes later', async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    apiMocks.scrapeProfile.mockReturnValue(promise);
    await submitUsername();
    await userEvent.setup().click(screen.getByRole('button', { name: /cancel/i }));

    await act(async () => {
      resolve({ stats: { scraped_username: 'alice', total_films: 12 } });
    });

    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('letterboxdStats')).toBeNull();
    expect(document.querySelector('input[name="username"]')).toBeInTheDocument();
  });
});

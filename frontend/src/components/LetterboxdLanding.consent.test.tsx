import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('always scrapes lifetime — there is no period selector on the landing page', async () => {
    await submitUsername();

    expect(apiMocks.scrapeProfile).toHaveBeenCalledWith(
      'alice',
      'lifetime',
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it('renders the FAQ section with all six questions from the catalog', () => {
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);

    expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument();
    expect(screen.getByText('What is Movies Wrapped?')).toBeInTheDocument();
    expect(screen.getByText('How do I find my Letterboxd username?')).toBeInTheDocument();
    expect(screen.getByText('Is my data stored?')).toBeInTheDocument();
    expect(screen.getByText('How long does it take?')).toBeInTheDocument();
    expect(screen.getByText('Is it free?')).toBeInTheDocument();
    expect(screen.getByText('Can I upload a CSV?')).toBeInTheDocument();
  });
});

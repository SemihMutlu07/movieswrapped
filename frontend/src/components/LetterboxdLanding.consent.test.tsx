import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/i18n/I18nProvider';

const apiMocks = vi.hoisted(() => ({
  analyzeFiles: vi.fn(),
  parseLetterboxdUsername: vi.fn(),
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

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    analyzeFiles: apiMocks.analyzeFiles,
    parseLetterboxdUsername: apiMocks.parseLetterboxdUsername,
    testBackend: apiMocks.testBackend,
  };
});

vi.mock('@/lib/supabase/analysis_runs', () => analysisRunMocks);
vi.mock('@/lib/supabase/sessions', () => sessionMocks);
vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(),
  trackConsentedEvent: vi.fn(),
  trackFilmStats: vi.fn(),
}));

import LetterboxdLanding from './LetterboxdLanding';

describe('LetterboxdLanding persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    apiMocks.testBackend.mockResolvedValue(undefined);
    apiMocks.parseLetterboxdUsername.mockResolvedValue({ username: 'alice' });
    apiMocks.analyzeFiles.mockResolvedValue({
      status: 'success',
      stats: {
        total_films: 12,
        favorite_genre: { name: 'Drama', count: 4 },
      },
    });
    analysisRunMocks.startAnalysis.mockResolvedValue({ id: 'run-1' });
    analysisRunMocks.finishAnalysis.mockResolvedValue(undefined);
    sessionMocks.upsertUserSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a kind desktop-required notice on a phone user agent', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      userAgentData: undefined,
    });
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    const hint = screen.getByTestId('desktop-required-landing');
    expect(hint).toHaveTextContent(/desktop/i);
    expect(hint.textContent).not.toMatch(/computer/i);
    expect(document.getElementById('upload-zone-input')).toBeNull();
  });

  it('keeps drag-and-drop upload on a desktop user agent', () => {
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    expect(document.getElementById('upload-zone-input')).toBeTruthy();
    expect(screen.queryByTestId('desktop-required-landing')).not.toBeInTheDocument();
  });

  async function uploadExport() {
    const user = userEvent.setup();
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    const file = new File(['Name,Year\nAftersun,2022\n'], 'letterboxd-alice.zip', { type: 'application/zip' });
    const input = document.getElementById('upload-zone-input') as HTMLInputElement;
    await user.upload(input, file);
    await waitFor(() => expect(apiMocks.analyzeFiles).toHaveBeenCalled());
  }

  it('persists the analysis and user session without a stored consent decision', async () => {
    await uploadExport();

    await waitFor(() => {
      expect(analysisRunMocks.startAnalysis).toHaveBeenCalledOnce();
      expect(analysisRunMocks.finishAnalysis).toHaveBeenCalledOnce();
      expect(sessionMocks.upsertUserSession).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'alice', consent: 'accept' }),
      );
    });
  });

  it('stops the loading screen when analyze cannot reach the backend', async () => {
    apiMocks.analyzeFiles.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    const file = new File(['Name,Year\nAftersun,2022\n'], 'letterboxd-alice.zip', { type: 'application/zip' });
    const input = document.getElementById('upload-zone-input') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.queryByText(/Analyzing your films/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/analysis server appears to be offline/i)).toBeInTheDocument();
  });

  it('renders the FAQ section with all six questions from the catalog', () => {
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);

    expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument();
    expect(screen.getByText('What is Movies Wrapped?')).toBeInTheDocument();
    expect(screen.getByText('How do I get my Letterboxd export?')).toBeInTheDocument();
    expect(screen.getByText('Is my data stored?')).toBeInTheDocument();
    expect(screen.getByText('How long does it take?')).toBeInTheDocument();
    expect(screen.getByText('Is it free?')).toBeInTheDocument();
    expect(screen.getByText('Can I upload a CSV?')).toBeInTheDocument();
  });
});

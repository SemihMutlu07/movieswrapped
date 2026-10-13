import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/i18n/I18nProvider';

const apiMocks = vi.hoisted(() => ({
  analyzeFiles: vi.fn(),
  parseLetterboxdUsername: vi.fn(),
  scrapeProfile: vi.fn(),
  testBackend: vi.fn(),
}));

const analyticsMocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  trackConsentedEvent: vi.fn(),
  trackFilmStats: vi.fn(),
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
    scrapeProfile: apiMocks.scrapeProfile,
    testBackend: apiMocks.testBackend,
  };
});

vi.mock('@/lib/supabase/analysis_runs', () => analysisRunMocks);
vi.mock('@/lib/supabase/sessions', () => sessionMocks);
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>();
  return {
    ...actual,
    trackEvent: analyticsMocks.trackEvent,
    trackConsentedEvent: analyticsMocks.trackConsentedEvent,
    trackFilmStats: analyticsMocks.trackFilmStats,
  };
});


import LetterboxdLanding from './LetterboxdLanding';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
    apiMocks.scrapeProfile.mockResolvedValue({
      status: 'success',
      stats: {
        scraped_username: 'alice',
        total_films: 12,
        favorite_genre: { name: 'Drama', count: 4 },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('links the homepage to the bookmarklet import page', () => {
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    expect(screen.getByRole('link', { name: /use the bookmarklet instead/i })).toHaveAttribute('href', '/import');
  });

  it('keeps ZIP upload on a phone user agent', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      userAgentData: undefined,
    });
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    expect(screen.getByRole('button', { name: /wrap my year/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /have a zip instead/i })).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-required-landing')).not.toBeInTheDocument();
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
  async function submitUsername(username = 'alice') {
    const user = userEvent.setup();
    render(<I18nProvider locale="en"><LetterboxdLanding showUsernameScrape /></I18nProvider>);
    const input = document.querySelector('input[name="username"]') as HTMLInputElement;
    await user.type(input, username);
    await user.click(screen.getByRole('button', { name: /Wrap my year/i }));
    return { user, input };
  }

  it('persists final stats to session storage and navigates to story on successful scrape', async () => {
    let storedAtNavigation: Record<string, unknown> | null = null;
    routerMocks.push.mockImplementationOnce(() => {
      storedAtNavigation = JSON.parse(sessionStorage.getItem('letterboxdStats') ?? 'null');
    });

    await submitUsername('alice');

    await waitFor(() => {
      expect(apiMocks.scrapeProfile).toHaveBeenCalledWith(
        'alice',
        'lifetime',
        expect.any(AbortSignal),
        expect.any(Function),
      );
    });

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      'analyze_started',
      expect.not.objectContaining({ username: expect.anything() }),
    );
    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      'analyze_started',
      { method: 'scrape', analysis_period: 'lifetime' },
    );
    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      'scrape_started',
      { method: 'scrape' },
    );
    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      'scrape_done',
      expect.objectContaining({ method: 'scrape', films: 12, diary: 0, queue_wait_ms: 0 }),
    );

    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith('/en/story?u=alice'));
    expect(storedAtNavigation).toMatchObject({ scraped_username: 'alice', total_films: 12 });
    expect(sessionStorage.getItem('username')).toBe('alice');

    expect(analysisRunMocks.startAnalysis).toHaveBeenCalledOnce();
    expect(analysisRunMocks.finishAnalysis).toHaveBeenCalledOnce();
    expect(sessionMocks.upsertUserSession).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'alice', consent: 'accept' }),
    );
  });

  it('displays submitted normalized username in ScrapeStoryWait without changing stored identity before success', async () => {
    sessionStorage.setItem('username', 'bob');
    sessionStorage.setItem('lb_username', 'bob');

    const { promise, resolve: resolveScrape } = deferred<unknown>();
    apiMocks.scrapeProfile.mockReturnValue(promise);

    await submitUsername('https://letterboxd.com/alice/');

    await waitFor(() => {
      expect(screen.getByTestId('scrape-story-wait')).toBeInTheDocument();
    });
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.queryByText('@bob')).not.toBeInTheDocument();

    expect(sessionStorage.getItem('username')).toBe('bob');

    await act(async () => {
      resolveScrape({
        status: 'success',
        stats: { scraped_username: 'alice', total_films: 12 },
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith('/en/story?u=alice'));
    expect(sessionStorage.getItem('username')).toBe('alice');
  });

  it('suppresses late stats and navigation when scrape is cancelled', async () => {
    const { promise, resolve: resolveScrape } = deferred<unknown>();
    let signal: AbortSignal | undefined;
    apiMocks.scrapeProfile.mockImplementation((_u: string, _p: string, s?: AbortSignal) => {
      signal = s;
      return promise;
    });

    const { user } = await submitUsername('alice');

    await waitFor(() => expect(screen.getByTestId('scrape-story-wait')).toBeInTheDocument());
    expect(signal?.aborted).toBe(false);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId('scrape-story-wait')).not.toBeInTheDocument();
    expect(document.querySelector('input[name="username"]')).toBeInTheDocument();

    await act(async () => {
      resolveScrape({
        status: 'success',
        stats: { scraped_username: 'alice', total_films: 12 },
      });
      await Promise.resolve();
    });

    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('letterboxdStats')).toBeNull();
  });

  it('rejects returned username that does not match requested username', async () => {
    apiMocks.scrapeProfile.mockResolvedValue({
      status: 'success',
      stats: {
        scraped_username: 'eve',
        total_films: 12,
      },
    });

    await submitUsername('alice');

    await waitFor(() => {
      expect(screen.getByText(/Username mismatch/i)).toBeInTheDocument();
    });

    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('letterboxdStats')).toBeNull();
    expect(document.querySelector('input[name="username"]')).toBeInTheDocument();
  });

  it('displays localized error banner when scrape fails with known error', async () => {
    const error = new Error('Letterboxd returned 404');
    (error as Error & { code?: string }).code = 'user_not_found';
    apiMocks.scrapeProfile.mockRejectedValue(error);

    await submitUsername('nonexistent_user');

    await waitFor(() => {
      expect(screen.getByText(/Profile not found/i)).toBeInTheDocument();
    });

    expect(screen.queryByTestId('scrape-story-wait')).not.toBeInTheDocument();
    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('letterboxdStats')).toBeNull();
  });

  it('does not open story on intermediate trace events without final result', async () => {
    const { promise, resolve: resolveScrape } = deferred<unknown>();
    let reportProgress!: (progress: { trace_events: { stage: string }[] }) => void;
    apiMocks.scrapeProfile.mockImplementation(
      (_u: string, _p: string, _s?: AbortSignal, onProgress?: (p: { trace_events: { stage: string }[] }) => void) => {
        reportProgress = onProgress!;
        return promise;
      },
    );

    await submitUsername('alice');
    await waitFor(() => expect(screen.getByTestId('scrape-story-wait')).toBeInTheDocument());

    await act(async () => {
      reportProgress({ trace_events: [{ stage: 'analysis_done' }, { stage: 'postback_started' }] });
      await Promise.resolve();
    });

    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('letterboxdStats')).toBeNull();

    await act(async () => {
      resolveScrape({
        status: 'success',
        stats: { scraped_username: 'alice', total_films: 12 },
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith('/en/story?u=alice'));
    expect(sessionStorage.getItem('letterboxdStats')).not.toBeNull();
  });

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

  it('does not open the story when analysis finishes after cancel', async () => {
    const { promise, resolve: resolveAnalyze } = deferred<unknown>();
    let signal: AbortSignal | undefined;
    apiMocks.analyzeFiles.mockImplementation((_form: FormData, opts?: { signal?: AbortSignal }) => {
      signal = opts?.signal;
      return promise;
    });
    const user = userEvent.setup();
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    const file = new File(['Name,Year\nAftersun,2022\n'], 'letterboxd-alice.zip', { type: 'application/zip' });
    const input = document.getElementById('upload-zone-input') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(apiMocks.analyzeFiles).toHaveBeenCalled());
    expect(signal?.aborted).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      resolveAnalyze({ status: 'success', stats: { total_films: 12 } });
      await Promise.resolve();
    });

    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('letterboxdStats')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(document.getElementById('upload-zone-input')).toBeTruthy();
  });

  it('restarts analysis when Try again is clicked', async () => {
    apiMocks.analyzeFiles
      .mockRejectedValueOnce(new Error('Analysis failed'))
      .mockResolvedValueOnce({ status: 'success', stats: { total_films: 12 } });
    const user = userEvent.setup();
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    const file = new File(['Name,Year\nAftersun,2022\n'], 'letterboxd-alice.zip', { type: 'application/zip' });
    const input = document.getElementById('upload-zone-input') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument());
    expect(apiMocks.analyzeFiles).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(apiMocks.analyzeFiles).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(routerMocks.push).toHaveBeenCalled());
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

  it('shows the username wrap CTA by default, with ZIP as a secondary path', () => {
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    expect(document.querySelector('input[name="username"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /wrap my year/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /have a zip instead/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /or try a public username/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/how it works/i)).not.toBeInTheDocument();
  });

  it('keeps Letterboxd Wrapped 2026 as the page heading', () => {
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    expect(screen.getByRole('heading', { level: 1, name: 'Letterboxd Wrapped 2026' })).toBeInTheDocument();
  });

  it('sends a blocked scrape to ZIP upload without a retry loop', async () => {
    const error = new Error('Letterboxd is blocking automated access to this profile.');
    (error as Error & { code?: string }).code = 'scrape_blocked';
    apiMocks.scrapeProfile.mockRejectedValue(error);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    await submitUsername('alice');

    await waitFor(() => {
      expect(screen.getByText(/Letterboxd access blocked/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /upload export zip/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('scrape-story-wait')).not.toBeInTheDocument();
    expect(apiMocks.scrapeProfile).toHaveBeenCalledTimes(1);
    expect(document.getElementById('upload-zone-input')).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalled();
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

  it('promotes the wrapped landing with a collage, sample share card, and username wrap CTA', () => {
    render(<I18nProvider locale="en"><LetterboxdLanding /></I18nProvider>);
    expect(document.querySelector('[data-landing-variant="wrapped"]')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Letterboxd Wrapped 2026' })).toBeInTheDocument();
    expect(screen.getByText(/woody allen on a loop/i)).toBeInTheDocument();
    expect(document.querySelector('input[name="username"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /wrap my year/i })).toBeInTheDocument();
    expect(screen.getByTestId('landing-sample-share-card')).toBeInTheDocument();
    expect(screen.getByTestId('landing-sample-share-card')).toHaveTextContent('Woody Allen');
    expect(screen.getByTestId('landing-sample-share-card')).toHaveTextContent('711');
  });
});

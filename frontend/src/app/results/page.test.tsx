import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResultsPage from './page';
import { I18nProvider } from '@/i18n/I18nProvider';

const feedbackSpies = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/results',
  useSearchParams: () => new URLSearchParams('u=alice'),
}));
vi.mock('@/components/LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher" />,
}));

vi.mock('@/lib/analytics', () => ({
  getTmdbImageUrl: (path?: string) => path || null,
  trackEvent: vi.fn(),
  trackConsentedEvent: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ searchPerson: vi.fn() }));
vi.mock('@/lib/posthog', () => ({
  initPostHog: vi.fn(),
  flushQueue: vi.fn(),
  clearQueue: vi.fn(),
  captureEvent: vi.fn(),
  getFlagVariant: vi.fn(() => Promise.resolve('control')),
}));
vi.mock('@/hooks/useRafThrottle', () => ({ useRafThrottle: (fn: () => void) => fn }));
vi.mock('@/hooks/useIntersectionObserver', () => ({ useLazyMount: () => ({ ref: null, shouldMount: true }) }));
vi.mock('@/components/ThemeWrapper', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/FeedbackFab', () => ({
  default: React.forwardRef(function FeedbackFabMock(_props, ref) {
    React.useImperativeHandle(ref, () => ({ open: feedbackSpies.open }));
    return null;
  }),
}));

vi.mock('@/containers/results/HeroStats', () => ({
  default: (props: {
    hoursWatched: number;
    timePct: string;
    onClickFilms?: () => void;
    onClickAvgRating?: () => void;
    onClickGenre?: () => void;
  }) => (
    <section>
      <output data-testid="hero-values">{`${props.hoursWatched}|${props.timePct}`}</output>
      <button onClick={props.onClickFilms}>Open all films</button>
      <button onClick={props.onClickAvgRating}>Open rated films</button>
      <button onClick={props.onClickGenre}>Open genre films</button>
    </section>
  ),
}));
vi.mock('@/containers/results/sections/PersonFilmsModal', () => ({
  default: ({ open, name, films, genre }: { open: boolean; name: string; films: { title: string }[]; genre?: string }) => open ? (
    <section data-testid="film-modal">
      <h2>{name}</h2>
      <output data-testid="modal-genre">{genre || ''}</output>
      <ol>{films.map((film) => <li key={film.title}>{film.title}</li>)}</ol>
    </section>
  ) : null,
}));
vi.mock('@/components/ShareModal', () => ({
  default: ({ open, cardProps, onDownloadSuccess }: { open: boolean; cardProps: { spentHours: number; spentDays: number; timePercent: number; username?: string }; onDownloadSuccess: () => void }) => open ? (
    <section>
      <output data-testid="share-card">{`${cardProps.spentHours}|${cardProps.spentDays}|${cardProps.timePercent}|${cardProps.username}`}</output>
      <button onClick={onDownloadSuccess}>Complete share download</button>
    </section>
  ) : null,
}));

vi.mock('@/containers/results/LanguagesLeaderboard', () => ({ default: () => <div data-testid="section-marker">languages</div> }));
vi.mock('@/containers/results/sections/RatingDeviation', () => ({ default: () => <div data-testid="section-marker">rating-deviation</div> }));
vi.mock('@/containers/results/sections/ReviewAnalysisSection', () => ({ default: () => <div data-testid="section-marker">reviews</div> }));
vi.mock('@/containers/results/sections/CastGrid', () => ({ default: () => <div data-testid="section-marker">cast</div> }));
vi.mock('@/containers/results/sections/DirectorsGrid', () => ({ default: () => <div data-testid="section-marker">directors</div> }));
vi.mock('@/containers/results/FilmAndRatings', () => ({
  FilmHistory: () => <div data-testid="section-marker">film-history</div>,
  RatingsBar: () => <div data-testid="section-marker">ratings-bar</div>,
}));
vi.mock('@/containers/results/RewatchChampions', () => ({ default: () => <div data-testid="section-marker">rewatches</div> }));
vi.mock('@/containers/results/CinemaScale', () => ({ default: () => <div data-testid="section-marker">cinema-scale</div> }));

const storedStats = {
  scraped_username: 'Alice',
  total_films: 3,
  average_rating: 4,
  total_runtime: 300,
  average_runtime: 100,
  top_genres: [{ name: 'Drama', count: 2 }],
  top_directors: [{ name: 'Director', count: 2 }],
  top_actors: [{ name: 'Actor', count: 2 }],
  top_countries: [],
  top_languages: [],
  decades: [],
  rating_distribution: {},
  favorite_decade: { name: '2020s', count: 2 },
  hours_watched: 99,
  days_watched: 9,
  data_timeline: { earliest_date: '2024-01-01', latest_date: '2024-01-05', total_days: 5 },
  monthly_viewing_habits: [{ month: '2020-01', count: 1 }, { month: '2025-01', count: 1 }],
  review_analysis: { word_frequency: [] },
  all_films: [
    { title: 'Zulu', year: 2020, rating: 3, genres: ['Drama'] },
    { title: 'Alpha', year: 2024, rating: 5, genres: ['Drama'] },
    { title: 'Unrated', year: 2023, genres: ['Comedy'] },
  ],
};

function storeStats(stats = storedStats) {
  sessionStorage.setItem('letterboxdStats', JSON.stringify(stats));
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/results');
  feedbackSpies.open.mockClear();
});

describe('ResultsPage stored-result contracts', () => {
  it('loads matching route data and passes date/runtime/share values to rendered children', async () => {
    window.history.replaceState(null, '', '/results?u=alice');
    storeStats();
    render(<I18nProvider locale="en"><ResultsPage /></I18nProvider>);

    expect(await screen.findByText('Analysed from Jan 1, 2024 to Jan 5, 2024')).toBeInTheDocument();
    expect(screen.getByTestId('hero-values')).toHaveTextContent('5|4%');

    await userEvent.click(screen.getAllByRole('button', { name: /share your wrapped/i })[0]);
    expect(await screen.findByTestId('share-card')).toHaveTextContent('5|0|4|alice');
  });

  it('canonicalizes a route-less stored username into the results URL', async () => {
    storeStats();
    render(<I18nProvider locale="en"><ResultsPage /></I18nProvider>);

    await screen.findByTestId('hero-values');
    expect(`${window.location.pathname}${window.location.search}`).toBe('/results?u=alice');
  });

  it('keeps timeline and total-runtime values ahead of monthly and legacy runtime fallbacks', async () => {
    window.history.replaceState(null, '', '/results?u=alice');
    storeStats();
    render(<I18nProvider locale="en"><ResultsPage /></I18nProvider>);

    expect(await screen.findByText('Analysed from Jan 1, 2024 to Jan 5, 2024')).toBeInTheDocument();
    expect(screen.getByTestId('hero-values')).toHaveTextContent('5|4%');
  });

  it('does not load stored data for a different results route', async () => {
    window.history.replaceState(null, '', '/results?u=other');
    storeStats();
    render(<I18nProvider locale="en"><ResultsPage /></I18nProvider>);

    expect(await screen.findByText('No data found')).toBeInTheDocument();
    expect(screen.getByText('No local result data found for @other.')).toBeInTheDocument();
  });

  it('shows the upload fallback when there is no stored result or route username', async () => {
    render(<I18nProvider locale="en"><ResultsPage /></I18nProvider>);

    expect(await screen.findByText('No data found')).toBeInTheDocument();
    expect(screen.getByText('Please upload your Letterboxd data first.')).toBeInTheDocument();
  });

  it('selects the requested film set and sorts rated films before unrated films', async () => {
    storeStats();
    render(<I18nProvider locale="en"><ResultsPage /></I18nProvider>);
    await screen.findByTestId('hero-values');

    await userEvent.click(screen.getByRole('button', { name: 'Open all films' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'All Watched Films' })).toBeInTheDocument());
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Alpha', 'Zulu', 'Unrated']);

    await userEvent.click(screen.getByRole('button', { name: 'Open genre films' }));
    expect(screen.getByRole('heading', { name: 'Drama Films' })).toBeInTheDocument();
    expect(screen.getByTestId('modal-genre')).toHaveTextContent('Drama');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Alpha', 'Zulu']);
  });

  it('renders the primary results sections in their slide order', async () => {
    storeStats();
    render(<I18nProvider locale="en"><ResultsPage /></I18nProvider>);

    await screen.findByTestId('hero-values');
    expect(screen.getAllByTestId('section-marker').map((marker) => marker.textContent)).toEqual([
      'directors',
      'cast',
      'rating-deviation',
      'reviews',
      'film-history',
      'ratings-bar',
      'languages',
    ]);
  });

  it('renders a scrollspy nav for the results sections', async () => {
    storeStats();
    render(<I18nProvider locale="en"><ResultsPage /></I18nProvider>);

    await screen.findByTestId('hero-values');
    const spy = screen.getByRole('navigation', { name: 'On this page' });
    expect(spy).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reviews' })).toBeInTheDocument();
    expect(within(spy).queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('opens feedback only once after repeated completed share downloads', async () => {
    storeStats();
    render(<I18nProvider locale="en"><ResultsPage /></I18nProvider>);
    await screen.findByTestId('hero-values');

    await userEvent.click(screen.getAllByRole('button', { name: /share your wrapped/i })[0]);
    const completeDownload = await screen.findByRole('button', { name: 'Complete share download' });
    await userEvent.click(completeDownload);
    await userEvent.click(completeDownload);

    expect(feedbackSpies.open).toHaveBeenCalledTimes(1);
  });
});

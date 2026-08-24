import { beforeEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({
  default: ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>{children}</a>
  ),
}));

import StoryPage from '@/app/story/page';
import { AUTO_MIN_MS, buildSlides } from '@/components/StoryExperience';
import StoryFinaleCard from '@/components/story/StoryFinaleCard';
import type { StatsData } from '@/containers/results/sections/types';
import { I18nProvider } from '@/i18n/I18nProvider';
import { createTranslator } from '@/i18n/createTranslator';
import { readySlideKeys, slideMeta } from '@/components/story/manifest';
import { buildStoryShareCard, pickFinaleOrientation } from '@/components/story/viewModel';
import { ReviewSlideBody } from '@/components/story/review/ReviewSlideBody';
import { ReviewSlidePhaseProvider } from '@/components/story/review/ReviewSlidePhaseContext';
import { FinaleSlideBody } from '@/components/story/finale/FinaleSlideBody';
import { FinaleSlidePhaseProvider } from '@/components/story/finale/FinaleSlidePhaseContext';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/story',
  useSearchParams: () => new URLSearchParams(),
}));

const enI18n = createTranslator('en');

const renderStory = () => render(<I18nProvider locale="en"><StoryPage /></I18nProvider>);

/** Wait for RAF dwell on auto-min slides so goNext is unlocked. */
async function waitAutoMin() {
  await new Promise((r) => setTimeout(r, AUTO_MIN_MS + 150));
}

async function clickNextWhenReady(next: HTMLElement) {
  await waitAutoMin();
  await userEvent.click(next);
}

/** Multi-slide walks need wall-clock dwell on each auto-min slide. */
const LONG_STORY_TIMEOUT_MS = 45_000;

const STATS = {
  scraped_username: 'semihmutsuz',
  total_films: 692,
  days_watched: 61,
  average_rating: 3.44,
  total_countries: 56,
  favorite_genre: { name: 'Drama', count: 301 },
  most_watched_director: { name: 'Denis Villeneuve', count: 9 },
  sinefil_meter: { score: 68, type: 'Explorer' },
  cinematic_persona: { persona: 'Emotional Masochist', description: 'You seek out what hurts.' },
};

describe('StoryPage', () => {
  beforeEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it('shows the empty state when no stats are stored', async () => {
    renderStory();
    expect(await screen.findByText(/No result data in this session/i)).toBeInTheDocument();
  });

  it('renders the intro slide from stored stats and advances on tap', async () => {
    sessionStorage.setItem('letterboxdStats', JSON.stringify(STATS));
    renderStory();

    expect(await screen.findByText('@semihmutsuz')).toBeInTheDocument();

    await clickNextWhenReady(screen.getByLabelText('Next slide'));
    expect(await screen.findByText('692 films')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Previous slide'));
    expect(await screen.findByText('@semihmutsuz')).toBeInTheDocument();
  }, LONG_STORY_TIMEOUT_MS);

  it('blocks early next on auto-min slides until the min dwell elapses', async () => {
    sessionStorage.setItem('letterboxdStats', JSON.stringify(STATS));
    renderStory();
    expect(await screen.findByText('@semihmutsuz')).toBeInTheDocument();

    const next = screen.getByLabelText('Next slide');
    await userEvent.click(next);
    // Still on intro — skip lock held.
    expect(screen.getByText('@semihmutsuz')).toBeInTheDocument();
    expect(screen.queryByText('692 films')).not.toBeInTheDocument();

    await clickNextWhenReady(next);
    expect(await screen.findByText('692 films')).toBeInTheDocument();
  }, LONG_STORY_TIMEOUT_MS);

  it('allows early next on manual enrichment slides', async () => {
    sessionStorage.setItem('letterboxdStats', JSON.stringify(STATS));
    renderStory();
    await screen.findByText('@semihmutsuz');

    const next = screen.getByLabelText('Next slide');
    // intro → volume → genre → director (manual)
    await clickNextWhenReady(next);
    await clickNextWhenReady(next);
    await clickNextWhenReady(next);
    expect(await screen.findByText(/Denis Villeneuve/i)).toBeInTheDocument();

    // director is manual — immediate next must advance without waiting.
    await userEvent.click(next);
    expect(await screen.findByText(/3\.44 ★/)).toBeInTheDocument();
  }, LONG_STORY_TIMEOUT_MS);

  it('walks through to the persona and outro slides', async () => {
    sessionStorage.setItem('letterboxdStats', JSON.stringify(STATS));
    renderStory();
    await screen.findByText('@semihmutsuz');

    const next = screen.getByLabelText('Next slide');
    for (let i = 0; i < 6; i++) await clickNextWhenReady(next);
    expect(await screen.findByText('Emotional Masochist')).toBeInTheDocument();

    await userEvent.click(next);
    expect(await screen.findByText(/Open the dossier/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the dossier/i })).toHaveAttribute(
      'href',
      '/en/results?u=semihmutsuz',
    );
    expect(screen.getByText('Back')).toBeInTheDocument();
    expect(screen.getByLabelText('Pause story')).toBeDisabled();
    expect(screen.getByTestId('story-finale-actions')).toBeInTheDocument();
    expect(screen.getByTestId('story-top-chrome')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Back'));
    expect(await screen.findByText('Emotional Masochist')).toBeInTheDocument();
    await userEvent.click(next);
    // Outro is the last slide — further taps must not crash or move past it.
    await userEvent.click(next);
    expect(screen.getByText(/Open the dossier/i)).toBeInTheDocument();
  }, LONG_STORY_TIMEOUT_MS);

  it('can pause and resume the story timeline', async () => {
    sessionStorage.setItem('letterboxdStats', JSON.stringify(STATS));
    renderStory();
    expect(await screen.findByText('@semihmutsuz')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Pause story'));
    expect(screen.getByLabelText('Resume story')).toBeInTheDocument();
    expect(screen.getByText('@semihmutsuz')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Resume story'));
    expect(screen.getByLabelText('Pause story')).toBeInTheDocument();
  });

  it('renders story media in the mobile slide flow', async () => {
    sessionStorage.setItem('letterboxdStats', JSON.stringify({
      ...STATS,
      all_films: [
        { title: 'Aftersun', rating: 5, poster_path: '/aftersun.jpg' },
        { title: 'Heat', rating: 4.5, poster_path: '/heat.jpg' },
      ],
    }));
    renderStory();

    expect(await screen.findByText('@semihmutsuz')).toBeInTheDocument();
    expect(screen.getAllByAltText('Aftersun poster').length).toBeGreaterThan(0);
    expect(screen.getByTestId('story-mobile-media-rail')).toBeInTheDocument();
    expect(screen.getByTestId('story-language-switch')).toBeInTheDocument();
  });
});

describe('buildSlides', () => {
  it('caps the volume slide at 24 posters instead of the full film list', () => {
    const allFilms = Array.from({ length: 80 }, (_, index) => ({
      title: `Film ${index}`,
      poster_path: `/film-${index}.jpg`,
    }));
    const slides = buildSlides({ ...STATS, total_films: 80, all_films: allFilms } as unknown as StatsData, enI18n);
    const volume = slides.find((slide) => slide.key === 'volume')!;
    expect((volume.media ?? []).length).toBeLessThanOrEqual(24);
  });
  it('normalizes object story analytics without rendering object placeholders', () => {
    const slides = buildSlides({
      ...STATS,
      story_analytics: {
        viewing_season: { season: 'Summer', percentage: 42, story: 'Summer story' },
        most_active_day: { date: 'August 12', films: 4, story: 'August 12 was a four-film marathon.' },
      },
    } as unknown as StatsData, enI18n);
    const rhythm = slides.find((slide) => slide.key === 'rhythm');
    render(<>{rhythm!.body}</>);
    expect(screen.getByText('Summer')).toBeInTheDocument();
    expect(screen.getByText(/August 12 was a four-film marathon/i)).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it('uses only the selected director profile and films in the director visual', () => {
    const slides = buildSlides({
      ...STATS,
      top_directors: [{ name: 'Denis Villeneuve', count: 2, profile_path: '/denis.jpg' }],
      top_actors: [{
        name: 'Jake Gyllenhaal',
        count: 18,
        profile_path: '/jake.jpg',
        films: [{ title: 'Nightcrawler', poster_path: '/night.jpg' }],
      }],
      rewatch_champions: [{ title: 'Nightcrawler', watch_count: 4 }],
      all_films: [
        { title: 'Arrival', director: 'Denis Villeneuve', poster_path: '/arrival.jpg' },
        { title: 'Heat', director: 'Michael Mann', poster_path: '/heat.jpg' },
        { title: 'Nightcrawler', director: 'Dan Gilroy', poster_path: '/night.jpg', cast: ['Jake Gyllenhaal'] },
      ],
    } as unknown as StatsData, enI18n);
    const director = slides.find((slide) => slide.key === 'director')!;
    expect(director.visual).toBe('director');
    expect(director.directorSequence?.streamPosters.map((item) => item.alt)).toEqual(['Arrival poster']);
    expect(director.media?.map((item) => item.alt)).toEqual([
      'Denis Villeneuve portrait',
      'Arrival poster',
    ]);
    const actor = slides.find((slide) => slide.key === 'actor')!;
    expect(actor.visual).toBe('actor');
    expect(actor.media?.map((item) => item.alt)).toEqual([
      'Jake Gyllenhaal portrait',
      'Nightcrawler poster',
    ]);
  });

  it('keeps local /demo media paths intact for story visuals', () => {
    const slides = buildSlides({
      ...STATS,
      top_directors: [{ name: 'Denis Villeneuve', count: 1, profile_path: '/demo/smt-media/denis.jpg' }],
      most_watched_director: { name: 'Denis Villeneuve', count: 1 },
      all_films: [
        { title: 'Arrival', director: 'Denis Villeneuve', poster_path: '/demo/smt-media/arrival.jpg' },
      ],
    } as unknown as StatsData, enI18n);
    const director = slides.find((slide) => slide.key === 'director')!;
    expect(director.media?.map((item) => item.url)).toEqual([
      '/demo/smt-media/denis.jpg',
      '/demo/smt-media/arrival.jpg',
    ]);
  });

  it('builds the actor slide after director with rose accent and deduped posters', () => {
    const slides = buildSlides({
      ...STATS,
      top_directors: [{ name: 'Denis Villeneuve', count: 2, profile_path: '/denis.jpg' }],
      top_actors: [{ name: 'Jake Gyllenhaal', count: 18, profile_path: '/jake.jpg' }],
      all_films: [
        { title: 'Nightcrawler', cast: ['Jake Gyllenhaal'], poster_path: '/night.jpg', rating: 5 },
        { title: 'Arrival', director: 'Denis Villeneuve', cast: ['Amy Adams'], poster_path: '/arrival.jpg', rating: 4 },
        { title: 'Heat', director: 'Michael Mann', cast: ['Jake Gyllenhaal'], poster_path: '/heat.jpg', rating: 3 },
      ],
      rewatch_champions: [{ title: 'Nightcrawler', watch_count: 4 }],
    } as unknown as StatsData, enI18n);
    const directorIndex = slides.findIndex((slide) => slide.key === 'director');
    const actor = slides.find((slide) => slide.key === 'actor')!;
    expect(directorIndex).toBeGreaterThan(-1);
    expect(slides.findIndex((slide) => slide.key === 'actor')).toBe(directorIndex + 1);
    expect(actor.visual).toBe('actor');
    expect(actor.accent).toBe('#f472b6');
    expect(actor.actorSequence?.streamPosters.map((item) => item.alt)).toEqual(['Nightcrawler poster', 'Heat poster']);
    expect(actor.actorSequence?.streamPosters.length).toBeLessThanOrEqual(12);
    expect(actor.actorSequence?.rewatch).toEqual({ title: 'Nightcrawler', watchCount: 4 });
    expect(actor.insight).toEqual({ kind: 'actor-rewatch', title: 'Nightcrawler', watchCount: 4 });
    expect(actor.actorSequence?.streamPosters.some((item) => item.alt === 'Arrival poster')).toBe(false);
  });


  it('shows every five-star film for the generous critic', () => {
    const allFilms = Array.from({ length: 11 }, (_, index) => ({
      title: `Five ${index}`,
      rating: 5,
      poster_path: `/five-${index}.jpg`,
    }));
    const slides = buildSlides({ ...STATS, rating_personality: 'The Generous Critic', all_films: allFilms } as unknown as StatsData, enI18n);
    const rating = slides.find((slide) => slide.key === 'rating-personality')!;
    expect(rating.visual).toBe('poster-wall');
    expect(rating.media).toHaveLength(11);
  });

  it('explains the signal behind the cinematic persona', () => {
    const slides = buildSlides({
      ...STATS,
      cinematic_persona_basis: { genre: 'Drama', decade: '2010s', country: 'France', match_type: 'genre' },
    } as unknown as StatsData, enI18n);
    const persona = slides.find((slide) => slide.key === 'persona')!;
    render(<>{persona.body}</>);
    expect(screen.getByText(/Drama was your most-watched genre/i)).toBeInTheDocument();
  });

  it('omits the review-personality slide when review_analysis has no reviews', () => {
    const slides = buildSlides(STATS as unknown as StatsData, enI18n);
    expect(slides.some((s) => s.key === 'review-personality')).toBe(false);
  });



  it('builds the outro finale with capped poster curtain and no profile media', () => {
    const stats = {
      ...STATS,
      top_directors: [{ name: 'Denis Villeneuve', count: 2, profile_path: '/denis.jpg' }],
      top_actors: [{ name: 'Jake Gyllenhaal', count: 18, profile_path: '/jake.jpg' }],
      review_analysis: {
        total_words_written: 500,
        reviews: [
          { title: 'Aftersun', text: 'short', text_length: 5000, likes: 3, poster_path: '/after.jpg' },
          { title: 'Memories of Underdevelopment', text: 'longer review body', text_length: 10, likes: 0, poster_path: '/mem.jpg' },
        ],
      },
      all_films: [
        { title: 'Nightcrawler', cast: ['Jake Gyllenhaal'], poster_path: '/night.jpg', rating: 5 },
        { title: 'Arrival', director: 'Denis Villeneuve', cast: ['Amy Adams'], poster_path: '/arrival.jpg', rating: 4 },
        { title: 'Heat', director: 'Michael Mann', cast: ['Jake Gyllenhaal'], poster_path: '/heat.jpg', rating: 3 },
        { title: 'Aftersun', poster_path: '/after.jpg', rating: 4 },
        { title: 'Memories of Underdevelopment', poster_path: '/mem.jpg', rating: 5 },
        { title: 'Film F', poster_path: '/f.jpg', rating: 2 },
        { title: 'Film G', poster_path: '/g.jpg', rating: 1 },
        { title: 'Film H', poster_path: '/h.jpg', rating: 4 },
        { title: 'Film I', poster_path: '/i.jpg', rating: 4 },
        { title: 'Film J', poster_path: '/j.jpg', rating: 4 },
        { title: 'Film K', poster_path: '/k.jpg', rating: 4 },
      ],
    };
    const slides = buildSlides(stats as unknown as StatsData, enI18n);
    const outro = slides.find((slide) => slide.key === 'outro')!;
    expect(outro.visual).toBe('finale');
    expect(outro.finaleSequence).toBeTruthy();
    expect(outro.media?.length).toBeLessThanOrEqual(8);
    expect(outro.media?.every((item) => item.type === 'poster')).toBe(true);
    expect(outro.media?.some((item) => item.type === 'profile')).toBe(false);
    expect(outro.body).toBeNull();
    render(
      <I18nProvider locale="en">
        <FinaleSlidePhaseProvider sequence={outro.finaleSequence ?? null} slideKey="outro" paused={false}>
          <FinaleSlideBody />
        </FinaleSlidePhaseProvider>
      </I18nProvider>,
    );
    expect(screen.getByText('That\'s the short version')).toBeInTheDocument();
    expect(screen.getByText('The full picture waits.')).toBeInTheDocument();

    render(
      <I18nProvider locale="tr">
        <FinaleSlidePhaseProvider sequence={outro.finaleSequence ?? null} slideKey="outro" paused={false}>
          <FinaleSlideBody />
        </FinaleSlidePhaseProvider>
      </I18nProvider>,
    );
    expect(screen.getByText('Kısa versiyon buydu')).toBeInTheDocument();
    expect(screen.getByText('Tüm resim seni bekliyor.')).toBeInTheDocument();
  });

  it('builds the review-personality slide with cinematic sequence and i18n body', () => {
    const stats = {
      ...STATS,
      review_analysis: {
        total_words_written: 500,
        reviews: [
          { title: 'Aftersun', text: 'short actual text', text_length: 5000, likes: 3, poster_path: '/after.jpg' },
          { title: 'Memories of Underdevelopment', text: 'a much longer review body by actual character count', text_length: 10, likes: 0, poster_path: '/mem.jpg' },
        ],
      },
      all_films: [
        { title: 'Aftersun', poster_path: '/after.jpg', rating: 4 },
        { title: 'Memories of Underdevelopment', poster_path: '/mem.jpg', rating: 5 },
      ],
    };
    const slides = buildSlides(stats as unknown as StatsData, enI18n);
    const reviewSlide = slides.find((s) => s.key === 'review-personality')!;
    expect(reviewSlide.visual).toBe('review');
    expect(reviewSlide.reviewSequence?.filmTitle).toBe('Memories of Underdevelopment');
    expect(reviewSlide.reviewSequence?.streamPosters.length).toBeLessThanOrEqual(12);
    expect(reviewSlide.reviewSequence?.heroPoster?.alt).toBe('Memories of Underdevelopment poster');
    expect(
      reviewSlide.reviewSequence?.streamPosters.some((poster) => poster.url === reviewSlide.reviewSequence?.heroPoster?.url),
    ).toBe(false);

    render(
      <I18nProvider locale="en">
        <ReviewSlidePhaseProvider sequence={reviewSlide.reviewSequence ?? null} slideKey="review-personality" paused={false}>
          <ReviewSlideBody />
        </ReviewSlidePhaseProvider>
      </I18nProvider>,
    );
    expect(screen.getByText('Your longest review')).toBeInTheDocument();
    expect(screen.getByText('Memories of Underdevelopment')).toBeInTheDocument();
    expect(screen.getByText(/500 words written total/i)).toBeInTheDocument();
  });



});

describe('story readiness + manifest', () => {
  beforeEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it('classifies core vs enrichment slides', () => {
    expect(slideMeta('intro').tier).toBe('core');
    expect(slideMeta('intro').interaction).toBe('auto-min');
    expect(slideMeta('persona').tier).toBe('enrichment');
    expect(slideMeta('persona').interaction).toBe('manual');
  });

  it('resolves the dependency plan from available data', () => {
    const core = readySlideKeys({ total_films: 10 } as StatsData);
    expect(core).toEqual(expect.arrayContaining(['intro', 'volume', 'outro']));
    expect(core).not.toContain('persona');

    const enriched = readySlideKeys({
      total_films: 10,
      favorite_genre: { name: 'Drama', count: 3 },
      cinematic_persona: { persona: 'X', description: 'y' },
      sinefil_meter: { score: 50, type: 'z' },
    } as StatsData);
    expect(enriched).toEqual(expect.arrayContaining(['genre', 'persona', 'sinefil']));
  });

  it('recovers from a corrupt payload with the empty state instead of crashing', async () => {
    sessionStorage.setItem('letterboxdStats', '{not json');
    renderStory();
    expect(await screen.findByText(/No result data in this session/i)).toBeInTheDocument();
  });

  it('picks up stats written after mount (late data / race)', async () => {
    renderStory();
    expect(await screen.findByText(/No result data in this session/i)).toBeInTheDocument();

    sessionStorage.setItem('letterboxdStats', JSON.stringify(STATS));
    window.dispatchEvent(new StorageEvent('storage', { key: 'letterboxdStats' }));

    expect(await screen.findByText('@semihmutsuz')).toBeInTheDocument();
  });
});

describe('story finale', () => {
  beforeEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it('renders a device-aware share-card finale on the last slide', async () => {
    sessionStorage.setItem('letterboxdStats', JSON.stringify(STATS));
    const { container } = renderStory();
    await screen.findByText('@semihmutsuz');

    const next = screen.getByLabelText('Next slide');
    for (let i = 0; i < 7; i++) await clickNextWhenReady(next);

    expect(await screen.findByText(/Open the dossier/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('[data-finale-orientation]')).not.toBeNull();
    });
  }, LONG_STORY_TIMEOUT_MS);

  it('picks portrait when the container is narrow even if the window is wide', async () => {
    // Wide window, but finale frame reports a phone-width box.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    class FakeResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        const rect = {
          width: 360,
          height: 440,
          top: 0,
          left: 0,
          bottom: 440,
          right: 360,
          x: 0,
          y: 0,
          toJSON() { return {}; },
        };
        Object.defineProperty(target, 'getBoundingClientRect', {
          configurable: true,
          value: () => rect,
        });
        this.cb(
          [{
            target,
            contentRect: rect as DOMRectReadOnly,
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          }],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const { container } = render(<I18nProvider locale="en"><StoryFinaleCard stats={STATS as unknown as StatsData} /></I18nProvider>);
    await waitFor(() => {
      const el = container.querySelector('[data-finale-orientation]');
      expect(el).not.toBeNull();
      expect(el?.getAttribute('data-finale-orientation')).toBe('vertical');
    });

    vi.unstubAllGlobals();
  });
});

describe('pickFinaleOrientation', () => {
  it('uses container width, not an implied window', () => {
    expect(pickFinaleOrientation(360)).toBe('vertical');
    expect(pickFinaleOrientation(767)).toBe('vertical');
    expect(pickFinaleOrientation(768)).toBe('horizontal');
    expect(pickFinaleOrientation(1200)).toBe('horizontal');
  });
});

describe('buildStoryShareCard', () => {
  it('maps stats into a share-card input with de-duplicated people', () => {
    const card = buildStoryShareCard({
      total_films: 100,
      top_genres: [{ name: 'Drama', count: 5 }, { name: 'Noir', count: 3 }],
      top_actors: [{ name: 'Greta Lee', count: 8 }],
      top_directors: [{ name: 'Greta Lee', count: 2 }, { name: 'Wim Wenders', count: 6 }],
    } as StatsData);

    expect(card.onScreenCrush.name).toBe('Greta Lee');
    expect(card.favoriteDirector?.name).toBe('Wim Wenders');
    expect(card.genres).toEqual(['Drama', 'Noir']);
  });

  it('returns a null director when none remain after de-duplication', () => {
    const card = buildStoryShareCard({
      total_films: 5,
      top_actors: [{ name: 'Solo', count: 1 }],
      top_directors: [{ name: 'Solo', count: 1 }],
    } as StatsData);
    expect(card.favoriteDirector).toBeNull();
  });

  it('includes Results-only fields (milestones, review words, outlier)', () => {
    const card = buildStoryShareCard({
      total_films: 200,
      review_analysis: {
        reviews_with_text: 12,
        word_frequency: [{ word: 'haunting', count: 4 }, { word: '', count: 1 }],
      },
      milestones: [{ ordinal: 100, title: 'Film X', year: 1999, poster_path: '/x.jpg' }],
      rating_outlier_film: {
        title: 'Odd',
        year: 2001,
        poster_path: '/o.jpg',
        user_rating: 5,
        avg_rating: 2.1,
        delta: 2.9,
      },
    } as StatsData);

    expect(card.writtenReviews).toBe(12);
    expect(card.topReviewWords).toEqual([{ word: 'haunting', count: 4 }]);
    expect(card.milestones).toEqual([
      { ordinal: 100, title: 'Film X', year: '1999', posterPath: '/x.jpg' },
    ]);
    expect(card.ratingOutlierFilm?.title).toBe('Odd');
  });
});

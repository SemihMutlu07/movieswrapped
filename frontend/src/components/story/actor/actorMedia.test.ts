import { describe, expect, it } from 'vitest';

import {
  PERSON_STREAM_POSTER_CAP,
  PERSON_STREAM_MIN_FILL,
  actorFilmsByName,
  actorRewatchInsight,
  actorStreamPosters,
  buildActorSequence,
  buildDirectorSequence,
  directorStreamPosters,
} from '../media';
import type { StatsData } from '@/containers/results/sections/types';

describe('actor stream media', () => {
  it('caps unique stream posters at twelve for large actor libraries', () => {
    const films = Array.from({ length: 100 }, (_, index) => ({
      title: `Film ${index}`,
      cast: ['Jake Gyllenhaal'],
      poster_path: `/poster-${index}.jpg`,
      rating: index,
    }));
    const stats = { all_films: films } as StatsData;
    const posters = actorStreamPosters(stats, 'Jake Gyllenhaal');
    expect(posters).toHaveLength(PERSON_STREAM_POSTER_CAP);
    expect(new Set(posters.map((poster) => poster.url)).size).toBe(PERSON_STREAM_POSTER_CAP);
  });

  it('excludes overlapping director poster URLs and prefers actor-only films', () => {
    const stats = {
      all_films: [
        { title: 'Nightcrawler', cast: ['Jake Gyllenhaal'], poster_path: '/night.jpg', rating: 5 },
        { title: 'Heat', director: 'Michael Mann', cast: ['Jake Gyllenhaal'], poster_path: '/heat.jpg', rating: 4 },
        { title: 'Arrival', director: 'Denis Villeneuve', poster_path: '/arrival.jpg', rating: 3 },
      ],
    } as StatsData;
    const directorUrls = directorStreamPosters(stats, 'Denis Villeneuve').map((poster) => poster.url);
    const actorPosters = actorStreamPosters(stats, 'Jake Gyllenhaal', {
      excludeUrls: new Set(directorUrls),
      directorClaimedUrls: directorUrls,
    });
    expect(actorPosters.map((poster) => poster.alt)).toEqual(['Nightcrawler poster', 'Heat poster']);
    expect(actorPosters.some((poster) => poster.alt === 'Arrival poster')).toBe(false);
  });

  it('soft-refills excluded posters when unique actor posters fall below the minimum fill', () => {
    const stats = {
      all_films: [
        { title: 'Shared One', cast: ['Jake Gyllenhaal'], poster_path: '/shared-1.jpg', rating: 1 },
        { title: 'Shared Two', cast: ['Jake Gyllenhaal'], poster_path: '/shared-2.jpg', rating: 2 },
        { title: 'Shared Three', cast: ['Jake Gyllenhaal'], poster_path: '/shared-3.jpg', rating: 3 },
        { title: 'Shared Four', cast: ['Jake Gyllenhaal'], poster_path: '/shared-4.jpg', rating: 4 },
        { title: 'Shared Five', cast: ['Jake Gyllenhaal'], poster_path: '/shared-5.jpg', rating: 5 },
        { title: 'Shared Six', cast: ['Jake Gyllenhaal'], poster_path: '/shared-6.jpg', rating: 6 },
      ],
    } as StatsData;
    const directorClaimedUrls = [
      'https://image.tmdb.org/t/p/w500/shared-1.jpg',
      'https://image.tmdb.org/t/p/w500/shared-2.jpg',
      'https://image.tmdb.org/t/p/w500/shared-3.jpg',
      'https://image.tmdb.org/t/p/w500/shared-4.jpg',
      'https://image.tmdb.org/t/p/w500/shared-5.jpg',
      'https://image.tmdb.org/t/p/w500/shared-6.jpg',
    ];
    const posters = actorStreamPosters(stats, 'Jake Gyllenhaal', {
      excludeUrls: new Set(directorClaimedUrls),
      directorClaimedUrls,
    });
    expect(posters.length).toBeGreaterThanOrEqual(PERSON_STREAM_MIN_FILL);
    expect(posters.length).toBeLessThanOrEqual(PERSON_STREAM_POSTER_CAP);
  });

  it('surfaces the strongest rewatch champion within the actor set with title tie-break', () => {
    const stats = {
      all_films: [
        { title: 'Nightcrawler', cast: ['Jake Gyllenhaal'] },
        { title: 'Heat', cast: ['Jake Gyllenhaal'] },
      ],
      rewatch_champions: [
        { title: 'Heat', watch_count: 3 },
        { title: 'Nightcrawler', watch_count: 3 },
      ],
    } as StatsData;
    expect(actorRewatchInsight(stats, 'Jake Gyllenhaal')).toEqual({
      title: 'Heat',
      watchCount: 3,
    });
  });

  it('builds an actor sequence with capped stream posters and actor films only', () => {
    const stats = {
      top_actors: [{ name: 'Jake Gyllenhaal', count: 18, profile_path: '/jake.jpg' }],
      all_films: [
        { title: 'Nightcrawler', cast: ['Jake Gyllenhaal'], poster_path: '/night.jpg', rating: 5 },
        { title: 'Arrival', director: 'Denis Villeneuve', poster_path: '/arrival.jpg', rating: 4 },
      ],
      rewatch_champions: [{ title: 'Nightcrawler', watch_count: 4 }],
    } as StatsData;
    const directorSequence = buildDirectorSequence(stats, 'Denis Villeneuve', 2);
    const actorSequence = buildActorSequence(
      stats,
      'Jake Gyllenhaal',
      18,
      undefined,
      {
        excludeUrls: new Set(directorSequence.streamPosters.map((poster) => poster.url)),
        directorClaimedUrls: directorSequence.streamPosters.map((poster) => poster.url),
      },
    );
    expect(actorSequence.streamPosters.length).toBeLessThanOrEqual(PERSON_STREAM_POSTER_CAP);
    expect(actorSequence.streamPosters.every((poster) => poster.alt !== 'Arrival poster')).toBe(true);
    expect(actorFilmsByName(stats, 'Jake Gyllenhaal').map((film) => film.title)).toEqual(['Nightcrawler']);
    expect(actorSequence.profile?.alt).toBe('Jake Gyllenhaal portrait');
    expect(actorSequence.rewatch).toEqual({ title: 'Nightcrawler', watchCount: 4 });
  });
});

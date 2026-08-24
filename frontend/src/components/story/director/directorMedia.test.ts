import { describe, expect, it } from 'vitest';

import {
  DIRECTOR_STREAM_POSTER_CAP,
  buildDirectorSequence,
  directorRewatchInsight,
  directorStreamPosters,
} from '../media';
import type { StatsData } from '@/containers/results/sections/types';

describe('director stream media', () => {
  it('caps unique stream posters at twelve for large director libraries', () => {
    const films = Array.from({ length: 100 }, (_, index) => ({
      title: `Film ${index}`,
      director: 'Denis Villeneuve',
      poster_path: `/poster-${index}.jpg`,
      rating: index,
    }));
    const stats = { all_films: films } as StatsData;
    const posters = directorStreamPosters(stats, 'Denis Villeneuve');
    expect(posters).toHaveLength(DIRECTOR_STREAM_POSTER_CAP);
    expect(new Set(posters.map((poster) => poster.url)).size).toBe(DIRECTOR_STREAM_POSTER_CAP);
  });

  it('surfaces the strongest rewatch champion within the director set', () => {
    const stats = {
      all_films: [
        { title: 'Arrival', director: 'Denis Villeneuve' },
        { title: 'Heat', director: 'Michael Mann' },
      ],
      rewatch_champions: [
        { title: 'Heat', watch_count: 5 },
        { title: 'Arrival', watch_count: 3 },
      ],
    } as StatsData;
    expect(directorRewatchInsight(stats, 'Denis Villeneuve')).toEqual({
      title: 'Arrival',
      watchCount: 3,
    });
  });

  it('builds a director sequence with capped stream posters', () => {
    const stats = {
      top_directors: [{ name: 'Denis Villeneuve', count: 9, profile_path: '/denis.jpg' }],
      all_films: [
        { title: 'Arrival', director: 'Denis Villeneuve', poster_path: '/arrival.jpg', rating: 5 },
        { title: 'Dune', director: 'Denis Villeneuve', poster_path: '/dune.jpg', rating: 4 },
      ],
      rewatch_champions: [{ title: 'Arrival', watch_count: 3 }],
    } as StatsData;
    const sequence = buildDirectorSequence(stats, 'Denis Villeneuve', 9);
    expect(sequence.streamPosters.length).toBeLessThanOrEqual(DIRECTOR_STREAM_POSTER_CAP);
    expect(sequence.profile?.alt).toBe('Denis Villeneuve portrait');
    expect(sequence.rewatch).toEqual({ title: 'Arrival', watchCount: 3 });
  });
});

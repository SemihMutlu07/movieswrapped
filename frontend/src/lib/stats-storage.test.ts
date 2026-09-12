import { describe, it, expect } from 'vitest';
import { persistStats, StatsTooLargeError, STATS_STORAGE_KEY } from '@/lib/stats-storage';
import { STORY_PLAYBACK_KEY } from '@/lib/story-playback';

/**
 * Storage double that rejects writes above `limit` characters, the way a real
 * browser rejects a setItem that would exceed the per-origin quota.
 */
function makeStorage(limit: number): Storage & { size(): number } {
  const map = new Map<string, string>();
  const used = (skip?: string) =>
    [...map].reduce((n, [k, v]) => (k === skip ? n : n + k.length + v.length), 0);
  return {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    setItem(k: string, v: string) {
      if (used(k) + k.length + v.length > limit) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      map.set(k, v);
    },
    size: () => used(),
  };
}

const heavy = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Film ${i}`, pad: 'x'.repeat(50) }));

function statsFixture() {
  return {
    total_films: 823,
    favorite_genre: { name: 'Drama' },
    all_films: heavy(200),
    actors_with_ratings: heavy(150),
    review_analysis: { reviews: heavy(100) },
    rated_films: heavy(80),
  };
}

describe('persistStats', () => {
  it('stores the full payload when it fits', () => {
    const storage = makeStorage(10_000_000);
    const result = persistStats(statsFixture(), storage);

    expect(result.dropped).toEqual([]);
    const stored = JSON.parse(storage.getItem(STATS_STORAGE_KEY)!);
    expect(stored.all_films).toHaveLength(200);
    expect(stored.total_films).toBe(823);
  });

  it('frees the previous payload before writing so a rerun is not blocked by its own leftovers', () => {
    const storage = makeStorage(60_000);
    persistStats(statsFixture(), storage);
    const first = storage.size();

    // A second analysis of the same size must fit even though the quota could
    // not hold both blobs at once.
    const result = persistStats(statsFixture(), storage);

    expect(result.dropped).toEqual([]);
    expect(storage.size()).toBe(first);
  });

  it('clears a saved story cursor so a new analysis cannot resume mid-wrap', () => {
    const storage = makeStorage(10_000_000);
    storage.setItem(STORY_PLAYBACK_KEY, JSON.stringify({
      username: 'semihmutsuz',
      fingerprint: 'old',
      index: 6,
      paused: true,
    }));

    persistStats(statsFixture(), storage);

    expect(storage.getItem(STORY_PLAYBACK_KEY)).toBeNull();
  });

  it('sheds heavy optional fields instead of losing a successful analysis', () => {
    // Enough room for the core summary, not for the film-level arrays.
    const storage = makeStorage(20_000);

    const result = persistStats(statsFixture(), storage);

    expect(result.dropped.length).toBeGreaterThan(0);
    expect(result.dropped[0]).toBe('all_films');
    const stored = JSON.parse(storage.getItem(STATS_STORAGE_KEY)!);
    expect(stored.total_films).toBe(823);
    expect(stored.favorite_genre).toEqual({ name: 'Drama' });
    expect(stored.all_films).toBeUndefined();
  });

  it('sheds heavy fields from the nested last_12_months window too', () => {
    // Enough room for both core summaries, not for either window's film-level arrays.
    const storage = makeStorage(35_000);
    const fixture = { ...statsFixture(), last_12_months: statsFixture() };

    const result = persistStats(fixture, storage);

    expect(result.dropped).toContain('all_films');
    const stored = JSON.parse(storage.getItem(STATS_STORAGE_KEY)!);
    expect(stored.total_films).toBe(823);
    expect(stored.all_films).toBeUndefined();
    expect(stored.last_12_months.total_films).toBe(823);
    expect(stored.last_12_months.all_films).toBeUndefined();
  });

  it('throws StatsTooLargeError when even the core summary does not fit', () => {
    const storage = makeStorage(10);

    expect(() => persistStats(statsFixture(), storage)).toThrow(StatsTooLargeError);
  });

  it('propagates non-quota storage failures untouched', () => {
    const storage = makeStorage(10_000_000);
    storage.setItem = () => { throw new DOMException('denied', 'SecurityError'); };

    expect(() => persistStats(statsFixture(), storage)).toThrow(/denied/);
  });
});

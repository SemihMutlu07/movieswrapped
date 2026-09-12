import { beforeEach, describe, expect, it } from 'vitest';

import {
  STORY_PLAYBACK_KEY,
  clearStoryPlayback,
  readStoryPlayback,
  storyFingerprint,
  writeStoryPlayback,
} from './story-playback';

describe('story playback cursor', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('round-trips a valid cursor', () => {
    writeStoryPlayback({
      username: 'semihmutsuz',
      fingerprint: 'semihmutsuz|711|Woody Allen|Woody Allen|12',
      index: 5,
      paused: true,
    });
    expect(readStoryPlayback()).toEqual({
      username: 'semihmutsuz',
      fingerprint: 'semihmutsuz|711|Woody Allen|Woody Allen|12',
      index: 5,
      paused: true,
    });
  });

  it('rejects a corrupt payload', () => {
    sessionStorage.setItem(STORY_PLAYBACK_KEY, '{nope');
    expect(readStoryPlayback()).toBeNull();
  });

  it('fingerprints the wrap so a new analysis cannot resume the old index', () => {
    const woody = storyFingerprint({
      scraped_username: 'semihmutsuz',
      total_films: 711,
      most_watched_director: { name: 'Woody Allen' },
      top_actors: [{ name: 'Woody Allen' }],
    }, 12);
    const other = storyFingerprint({
      scraped_username: 'semihmutsuz',
      total_films: 712,
      most_watched_director: { name: 'Woody Allen' },
      top_actors: [{ name: 'Woody Allen' }],
    }, 12);
    expect(woody).not.toBe(other);
  });

  it('clears the cursor', () => {
    writeStoryPlayback({
      username: 'semihmutsuz',
      fingerprint: 'x',
      index: 2,
      paused: false,
    });
    clearStoryPlayback();
    expect(readStoryPlayback()).toBeNull();
  });
});

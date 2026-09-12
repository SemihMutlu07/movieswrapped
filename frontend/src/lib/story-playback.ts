export const STORY_PLAYBACK_KEY = 'mwStoryPlayback';

export type StoryPlayback = {
  username: string;
  fingerprint: string;
  index: number;
  paused: boolean;
};

type PlaybackStats = {
  scraped_username?: string;
  total_films?: number;
  most_watched_director?: { name?: string } | null;
  top_actors?: Array<{ name?: string }> | null;
};

export function storyFingerprint(stats: PlaybackStats, slideCount: number): string {
  return [
    stats.scraped_username ?? '',
    stats.total_films ?? 0,
    stats.most_watched_director?.name ?? '',
    stats.top_actors?.[0]?.name ?? '',
    slideCount,
  ].join('|');
}

export function readStoryPlayback(storage: Storage = sessionStorage): StoryPlayback | null {
  try {
    const raw = storage.getItem(STORY_PLAYBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoryPlayback>;
    if (
      typeof parsed.username !== 'string'
      || typeof parsed.fingerprint !== 'string'
      || typeof parsed.index !== 'number'
      || !Number.isFinite(parsed.index)
      || typeof parsed.paused !== 'boolean'
    ) {
      return null;
    }
    return {
      username: parsed.username,
      fingerprint: parsed.fingerprint,
      index: parsed.index,
      paused: parsed.paused,
    };
  } catch {
    return null;
  }
}

export function writeStoryPlayback(playback: StoryPlayback, storage: Storage = sessionStorage): void {
  storage.setItem(STORY_PLAYBACK_KEY, JSON.stringify(playback));
}

export function clearStoryPlayback(storage: Storage = sessionStorage): void {
  storage.removeItem(STORY_PLAYBACK_KEY);
}

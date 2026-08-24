import type { StatsData } from '@/containers/results/sections/types';
import { compareReviewsByCharLength, reviewCharLength, selectLongestReview } from '@/lib/reviews';
import type { StoryMedia } from './types';

export function tmdbCdn(path: string | null | undefined, size = 'w780'): string | null {
  if (!path) return null;
  // Local SMT fixture / app-relative assets must not be rewritten to TMDB CDN.
  if (path.startsWith('/demo/') || path.startsWith('demo/')) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  if (path.startsWith('http')) return path;
  const clean = path.replace(/^\/+/, '').replace(/^t\/p\/[^/]+\//, '');
  return `https://image.tmdb.org/t/p/${size}/${clean}`;
}

export function posterMedia(film: { title?: string; poster_path?: string | null } | null | undefined, size = 'w780'): StoryMedia | null {
  const url = tmdbCdn(film?.poster_path, size);
  if (!url) return null;
  return { type: 'poster', url, alt: `${film?.title ?? 'Film'} poster`, objectPosition: 'center center' };
}

export function profileMedia(person: { name?: string; profile_path?: string | null } | null | undefined): StoryMedia | null {
  const url = tmdbCdn(person?.profile_path, 'h632');
  if (!url) return null;
  return { type: 'profile', url, alt: `${person?.name ?? 'Person'} portrait`, objectPosition: '50% 28%' };
}

export function compactMedia(items: Array<StoryMedia | null | undefined>, limit = 8): StoryMedia[] {
  const seen = new Set<string>();
  const output: StoryMedia[] = [];
  for (const item of items) {
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

export function allPosterMedia(stats: StatsData, limit = 24): StoryMedia[] {
  return compactMedia((stats.all_films ?? []).map((film) => posterMedia(film, 'w342')), limit);
}

export function filmByTitle(stats: StatsData, title?: string | null) {
  if (!title) return null;
  const clean = title.toLowerCase();
  return (stats.all_films ?? []).find((film) => film.title?.toLowerCase() === clean) ?? null;
}

export function topRatedPosters(stats: StatsData, limit = 8) {
  return compactMedia(
    [...(stats.all_films ?? [])]
      .filter((film) => film.poster_path)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .map((film) => posterMedia(film)),
    limit,
  );
}

export function genrePosters(stats: StatsData, genre?: string, limit = 8) {
  return compactMedia(
    (stats.all_films ?? [])
      .filter((film) => !genre || film.genres?.includes(genre))
      .map((film) => posterMedia(film)),
    limit,
  );
}

export function personFilms(
  stats: StatsData,
  name?: string,
  role: 'director' | 'actor' = 'director',
) {
  const clean = name?.toLowerCase();
  if (!clean) return [];
  const seen = new Set<string>();
  const films: NonNullable<StatsData['all_films']> = [];
  for (const film of stats.all_films ?? []) {
    const match = role === 'director'
      ? film.director?.toLowerCase() === clean
      : film.cast?.some((actor) => actor.toLowerCase() === clean);
    if (!match || !film.title) continue;
    const key = film.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    films.push(film);
  }
  return films;
}

function personAttachedFilms(
  stats: StatsData,
  name?: string,
  role: 'director' | 'actor' = 'director',
) {
  const clean = name?.toLowerCase();
  if (!clean) return [];
  const people = role === 'director' ? stats.top_directors : stats.top_actors;
  return people?.find((person) => person.name?.toLowerCase() === clean)?.films ?? [];
}

export function personFilmPosters(stats: StatsData, name?: string, role: 'director' | 'actor' = 'director', limit = 6) {
  // Prefer the person's attached film list (exact credit set) when present.
  const attached = personAttachedFilms(stats, name, role);
  if (attached.length > 0) {
    return compactMedia(attached.map((film) => posterMedia(film, 'w500')), limit);
  }
  return compactMedia(
    personFilms(stats, name, role).map((film) => posterMedia(film, 'w500')),
    limit,
  );
}

/** Rewatches among films tied to a director/actor — most-watched first. */
export function personRewatches(
  stats: StatsData,
  name?: string,
  role: 'director' | 'actor' = 'director',
) {
  const titles = new Set([
    ...personFilms(stats, name, role).map((film) => film.title.toLowerCase()),
    ...personAttachedFilms(stats, name, role).map((film) => film.title.toLowerCase()),
  ]);
  if (titles.size === 0) return [];
  return [...(stats.rewatch_champions ?? [])]
    .filter((entry) => titles.has(entry.title.toLowerCase()))
    .sort((a, b) => b.watch_count - a.watch_count);
}

export function storySeason(value: string | { season?: string; percentage?: number; story?: string } | undefined): string | null {
  if (typeof value === 'string') return value;
  return value?.season ?? null;
}

export function activeDayCopy(
  value: string | { date?: string; films?: number; story?: string } | undefined,
  t?: (key: 'story.rhythm.activeDay', values: { date: string; count: number }) => string,
): string | null {
  if (typeof value === 'string') return value;
  if (!value) return null;
  if (value.story) return value.story;
  if (value.date && value.films && t) {
    return t('story.rhythm.activeDay', { date: value.date, count: value.films });
  }
  return value.date ?? null;
}

export function generousCriticPosters(stats: StatsData): StoryMedia[] {
  const films = (stats.all_films ?? []).filter((film) => film.poster_path);
  const fiveStar = films.filter((film) => film.rating === 5);
  const featured = fiveStar.length > 0 ? fiveStar : films.filter((film) => film.rating === 4.5);
  return compactMedia(featured.map((film) => posterMedia(film, 'w500')), Number.POSITIVE_INFINITY);
}

export const PERSON_STREAM_POSTER_CAP = 12;
export const PERSON_STREAM_MIN_FILL = 6;
export const DIRECTOR_STREAM_POSTER_CAP = PERSON_STREAM_POSTER_CAP;

function personFilmsByRole(
  stats: StatsData,
  personName: string,
  role: 'director' | 'actor',
) {
  const clean = personName.toLowerCase();
  return (stats.all_films ?? []).filter((film) =>
    role === 'director'
      ? film.director?.toLowerCase() === clean
      : film.cast?.some((actor) => actor.toLowerCase() === clean),
  );
}

export function directorFilmsByName(stats: StatsData, directorName: string) {
  return personFilmsByRole(stats, directorName, 'director');
}

export function actorFilmsByName(stats: StatsData, actorName: string) {
  return personFilmsByRole(stats, actorName, 'actor');
}

function titleSetForFilms(films: StatsData['all_films']) {
  return new Set(
    (films ?? [])
      .map((film) => film.title?.toLowerCase())
      .filter(Boolean) as string[],
  );
}

function rewatchTitleSet(stats: StatsData, titles: Set<string>) {
  return new Set(
    (stats.rewatch_champions ?? [])
      .filter((entry) => titles.has(entry.title?.toLowerCase() ?? '') && entry.watch_count >= 2)
      .map((entry) => entry.title?.toLowerCase() ?? '')
      .filter(Boolean),
  );
}

function sortFilmsForStream(
  films: StatsData['all_films'],
  rewatchTitles: Set<string>,
  prioritizeRewatch: boolean,
) {
  return [...(films ?? [])]
    .filter((film) => film.poster_path)
    .sort((a, b) => {
      if (prioritizeRewatch) {
        const aRewatch = rewatchTitles.has(a.title?.toLowerCase() ?? '');
        const bRewatch = rewatchTitles.has(b.title?.toLowerCase() ?? '');
        if (aRewatch !== bRewatch) return aRewatch ? -1 : 1;
      }
      const ratingDelta = (b.rating ?? 0) - (a.rating ?? 0);
      if (ratingDelta !== 0) return ratingDelta;
      return (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' });
    });
}

/** Deterministic capped poster stream — one node per unique film poster. */
export function directorStreamPosters(
  stats: StatsData,
  directorName: string,
  limit = DIRECTOR_STREAM_POSTER_CAP,
): StoryMedia[] {
  const films = directorFilmsByName(stats, directorName);
  const rewatchTitles = rewatchTitleSet(stats, titleSetForFilms(films));
  return compactMedia(
    sortFilmsForStream(films, rewatchTitles, false).map((film) => posterMedia(film, 'w500')),
    limit,
  );
}

export function actorStreamPosters(
  stats: StatsData,
  actorName: string,
  options?: {
    limit?: number;
    excludeUrls?: Set<string>;
    directorClaimedUrls?: string[];
  },
): StoryMedia[] {
  const limit = options?.limit ?? PERSON_STREAM_POSTER_CAP;
  const excludeUrls = options?.excludeUrls ?? new Set<string>();
  const films = actorFilmsByName(stats, actorName);
  const rewatchTitles = rewatchTitleSet(stats, titleSetForFilms(films));
  const sorted = sortFilmsForStream(films, rewatchTitles, true);

  const seen = new Set<string>();
  const primary: StoryMedia[] = [];
  const excludedPool: StoryMedia[] = [];

  for (const film of sorted) {
    const media = posterMedia(film, 'w500');
    if (!media || seen.has(media.url)) continue;
    seen.add(media.url);
    if (excludeUrls.has(media.url)) {
      excludedPool.push(media);
      continue;
    }
    primary.push(media);
    if (primary.length >= limit) break;
  }

  let result = primary;
  if (result.length < PERSON_STREAM_MIN_FILL) {
    const excludedByUrl = new Map(excludedPool.map((item) => [item.url, item]));
    const refill: StoryMedia[] = [];
    const directorOrder = options?.directorClaimedUrls ?? [];

    for (let index = directorOrder.length - 1; index >= 0; index -= 1) {
      const item = excludedByUrl.get(directorOrder[index]);
      if (!item || result.some((poster) => poster.url === item.url)) continue;
      if (refill.some((poster) => poster.url === item.url)) continue;
      refill.push(item);
    }

    for (const item of excludedPool) {
      if (result.some((poster) => poster.url === item.url)) continue;
      if (refill.some((poster) => poster.url === item.url)) continue;
      refill.push(item);
    }

    result = [...result, ...refill].slice(0, limit);
  }

  return result.slice(0, limit);
}

export function personRewatchInsight(
  stats: StatsData,
  titles: Set<string>,
): { title: string; watchCount: number } | null {
  const champion = (stats.rewatch_champions ?? [])
    .filter((entry) => titles.has(entry.title?.toLowerCase() ?? ''))
    .sort((a, b) => {
      const countDelta = b.watch_count - a.watch_count;
      if (countDelta !== 0) return countDelta;
      return (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' });
    })[0];
  if (!champion || champion.watch_count < 2) return null;
  return { title: champion.title, watchCount: champion.watch_count };
}

export function directorRewatchInsight(
  stats: StatsData,
  directorName: string,
): { title: string; watchCount: number } | null {
  return personRewatchInsight(stats, titleSetForFilms(directorFilmsByName(stats, directorName)));
}

export function actorRewatchInsight(
  stats: StatsData,
  actorName: string,
): { title: string; watchCount: number } | null {
  return personRewatchInsight(stats, titleSetForFilms(actorFilmsByName(stats, actorName)));
}

export function buildDirectorSequence(
  stats: StatsData,
  directorName: string,
  filmCount: number,
  profilePerson?: { name?: string; profile_path?: string | null } | null,
) {
  return {
    personName: directorName,
    filmCount,
    profile: profileMedia(profilePerson ?? stats.top_directors?.find((d) => d.name === directorName)),
    streamPosters: directorStreamPosters(stats, directorName),
    rewatch: directorRewatchInsight(stats, directorName),
  };
}

export function buildActorSequence(
  stats: StatsData,
  actorName: string,
  filmCount: number,
  profilePerson?: { name?: string; profile_path?: string | null } | null,
  options?: {
    excludeUrls?: Set<string>;
    directorClaimedUrls?: string[];
  },
) {
  return {
    personName: actorName,
    filmCount,
    profile: profileMedia(profilePerson ?? stats.top_actors?.find((actor) => actor.name === actorName)),
    streamPosters: actorStreamPosters(stats, actorName, options),
    rewatch: actorRewatchInsight(stats, actorName),
  };
}


type ReviewRecord = {
  title?: string | null;
  year?: string | number | null;
  likes?: number | null;
  text?: string | null;
  poster_path?: string | null;
};

export const REVIEW_STREAM_POSTER_CAP = 12;
export const REVIEW_STREAM_MIN_FILL = PERSON_STREAM_MIN_FILL;

export function collectCinematicClaimedUrls(
  entries: Array<{
    profile?: StoryMedia | null;
    heroPoster?: StoryMedia | null;
    streamPosters?: StoryMedia[];
  }>,
): { urls: string[]; set: Set<string> } {
  const urls: string[] = [];
  for (const entry of entries) {
    if (entry.profile) urls.push(entry.profile.url);
    if (entry.heroPoster) urls.push(entry.heroPoster.url);
    for (const poster of entry.streamPosters ?? []) urls.push(poster.url);
  }
  return { urls, set: new Set(urls) };
}

function reviewPosterForRecord(stats: StatsData, review: ReviewRecord): StoryMedia | null {
  if (review.poster_path) {
    const url = tmdbCdn(review.poster_path, 'w500');
    if (url) {
      return {
        type: 'poster',
        url,
        alt: `${review.title ?? 'Film'} poster`,
        objectPosition: 'center center',
      };
    }
  }
  return posterMedia(filmByTitle(stats, review.title), 'w500');
}

function softFillReviewFilms(
  stats: StatsData,
  heroFilm: ReturnType<typeof filmByTitle>,
  heroTitleLower: string,
) {
  const films = (stats.all_films ?? []).filter(
    (film) => film.poster_path && film.title?.toLowerCase() !== heroTitleLower,
  );
  const heroDirector = heroFilm?.director?.toLowerCase();
  const heroGenres = heroFilm?.genres ?? [];
  const sameDirector = films.filter((film) => film.director?.toLowerCase() === heroDirector);
  const sameDirectorTitles = new Set(sameDirector.map((film) => film.title));
  const sameGenre = films.filter(
    (film) => !sameDirectorTitles.has(film.title)
      && film.genres?.some((genre) => heroGenres.includes(genre)),
  );
  const usedTitles = new Set([
    ...sameDirector.map((film) => film.title),
    ...sameGenre.map((film) => film.title),
  ]);
  const topRated = [...films]
    .filter((film) => !usedTitles.has(film.title))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  return [...sameDirector, ...sameGenre, ...topRated];
}

function applyReviewStreamDedupe(
  primary: StoryMedia[],
  excludedPool: StoryMedia[],
  claimedUrls: string[],
  limit: number,
): StoryMedia[] {
  let result = primary;
  if (result.length < REVIEW_STREAM_MIN_FILL) {
    const excludedByUrl = new Map(excludedPool.map((item) => [item.url, item]));
    const refill: StoryMedia[] = [];

    for (let index = claimedUrls.length - 1; index >= 0; index -= 1) {
      const item = excludedByUrl.get(claimedUrls[index]);
      if (!item || result.some((poster) => poster.url === item.url)) continue;
      if (refill.some((poster) => poster.url === item.url)) continue;
      refill.push(item);
    }

    for (const item of excludedPool) {
      if (result.some((poster) => poster.url === item.url)) continue;
      if (refill.some((poster) => poster.url === item.url)) continue;
      refill.push(item);
    }

    result = [...result, ...refill].slice(0, limit);
  }
  return result.slice(0, limit);
}

export function reviewStreamPosters(
  stats: StatsData,
  options: {
    heroTitle: string;
    heroUrl?: string | null;
    heroFilm?: ReturnType<typeof filmByTitle>;
    excludeUrls?: Set<string>;
    claimedUrls?: string[];
    limit?: number;
  },
): StoryMedia[] {
  const limit = options.limit ?? REVIEW_STREAM_POSTER_CAP;
  const excludeUrls = options.excludeUrls ?? new Set<string>();
  const heroTitleLower = options.heroTitle.toLowerCase();
  const reviews = (stats.review_analysis?.reviews ?? []) as ReviewRecord[];

  const poolA = reviews
    .filter((review) => review.title?.toLowerCase() !== heroTitleLower)
    .slice()
    .sort(compareReviewsByCharLength);

  const seen = new Set<string>();
  if (options.heroUrl) seen.add(options.heroUrl);
  const primary: StoryMedia[] = [];
  const excludedPool: StoryMedia[] = [];

  for (const review of poolA) {
    const media = reviewPosterForRecord(stats, review);
    if (!media || seen.has(media.url)) continue;
    seen.add(media.url);
    if (excludeUrls.has(media.url)) {
      excludedPool.push(media);
      continue;
    }
    primary.push(media);
    if (primary.length >= limit) break;
  }

  if (primary.length < limit) {
    for (const film of softFillReviewFilms(stats, options.heroFilm ?? null, heroTitleLower)) {
      const media = posterMedia(film, 'w500');
      if (!media || seen.has(media.url)) continue;
      seen.add(media.url);
      if (excludeUrls.has(media.url)) {
        excludedPool.push(media);
        continue;
      }
      primary.push(media);
      if (primary.length >= limit) break;
    }
  }

  return applyReviewStreamDedupe(primary, excludedPool, options.claimedUrls ?? [], limit);
}

export function buildReviewSequence(
  stats: StatsData,
  options?: {
    excludeUrls?: Set<string>;
    claimedUrls?: string[];
  },
) {
  const reviews = (stats.review_analysis?.reviews ?? []) as ReviewRecord[];
  const longest = selectLongestReview(reviews);
  if (!longest?.title) return null;

  const heroFilm = filmByTitle(stats, longest.title);
  const heroPoster = reviewPosterForRecord(stats, longest)
    ?? posterMedia(heroFilm ?? { title: longest.title, poster_path: longest.poster_path }, 'w500');
  const heroUrl = heroPoster?.url ?? null;

  const streamPosters = reviewStreamPosters(stats, {
    heroTitle: longest.title,
    heroUrl,
    heroFilm,
    excludeUrls: options?.excludeUrls,
    claimedUrls: options?.claimedUrls,
  }).filter((poster) => poster.url !== heroUrl);

  return {
    filmTitle: longest.title,
    year: longest.year ?? heroFilm?.year,
    charLength: reviewCharLength(longest),
    totalWordsWritten: stats.review_analysis?.total_words_written,
    likes: longest.likes ?? 0,
    heroPoster,
    streamPosters,
  };
}


export const FINALE_CURTAIN_POSTER_CAP = 8;
export const FINALE_CURTAIN_MIN_FILL = 4;

function applyFinaleCurtainDedupe(
  primary: StoryMedia[],
  excludedPool: StoryMedia[],
  claimedUrls: string[],
  limit: number,
): StoryMedia[] {
  let result = primary;
  if (result.length < FINALE_CURTAIN_MIN_FILL) {
    const excludedByUrl = new Map(excludedPool.map((item) => [item.url, item]));
    const refill: StoryMedia[] = [];

    for (let index = claimedUrls.length - 1; index >= 0; index -= 1) {
      const item = excludedByUrl.get(claimedUrls[index]);
      if (!item || result.some((poster) => poster.url === item.url)) continue;
      if (refill.some((poster) => poster.url === item.url)) continue;
      refill.push(item);
    }

    for (const item of excludedPool) {
      if (result.some((poster) => poster.url === item.url)) continue;
      if (refill.some((poster) => poster.url === item.url)) continue;
      refill.push(item);
    }

    result = [...result, ...refill].slice(0, limit);
  }
  return result.slice(0, limit);
}

export function buildFinaleCurtainMedia(
  stats: StatsData,
  options?: {
    excludeUrls?: Set<string>;
    claimedUrls?: string[];
    limit?: number;
  },
): StoryMedia[] {
  const limit = options?.limit ?? FINALE_CURTAIN_POSTER_CAP;
  const excludeUrls = options?.excludeUrls ?? new Set<string>();
  const sorted = [...(stats.all_films ?? [])]
    .filter((film) => film.poster_path)
    .sort((a, b) => {
      const ratingDelta = (b.rating ?? 0) - (a.rating ?? 0);
      if (ratingDelta !== 0) return ratingDelta;
      return (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' });
    });

  const seen = new Set<string>();
  const primary: StoryMedia[] = [];
  const excludedPool: StoryMedia[] = [];

  for (const film of sorted) {
    const item = posterMedia(film, 'w500');
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    if (excludeUrls.has(item.url)) {
      excludedPool.push(item);
      continue;
    }
    primary.push(item);
    if (primary.length >= limit) break;
  }

  return applyFinaleCurtainDedupe(primary, excludedPool, options?.claimedUrls ?? [], limit);
}

export function buildFinaleSequence(
  stats: StatsData,
  options?: {
    excludeUrls?: Set<string>;
    claimedUrls?: string[];
  },
) {
  return {
    curtainPosters: buildFinaleCurtainMedia(stats, options),
  };
}

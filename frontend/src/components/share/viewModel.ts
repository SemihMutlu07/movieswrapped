import { buildAnalysisRange, getRuntimeHours } from '@/containers/results/results-model';
import type { StatsData } from '@/containers/results/sections/types';
import { getTmdbImageUrl } from '@/lib/analytics';

import type { ShareCardData, ShareCardInput, SharePersonStat } from './types';

export const DIRECTOR_UNAVAILABLE = {
  name: '',
  headshotUrl: '',
  count: 0,
} as const;

export type BuildShareCardFromStatsOptions = {
  /** Prefer explicit username (Results session); else stats.scraped_username. */
  username?: string;
  /** i18n fallback when no actor remains. */
  unknownActor?: string;
  /**
   * i18n fallback when no director remains after actor de-dupe.
   * When omitted, favoriteDirector stays null (normalize fills DIRECTOR_UNAVAILABLE).
   */
  unknownDirector?: string;
  /** Override computed waking-hours share; Story/Results can pass a precomputed value. */
  timePercent?: number;
  year?: number;
};

function mapPeople(
  people: Array<{ name: string; count: number; profile_path?: string | null }> | undefined,
  limit = 5,
): SharePersonStat[] {
  return (people ?? []).slice(0, limit).map((person) => ({
    name: person.name,
    headshotUrl: getTmdbImageUrl(person.profile_path) || '',
    count: person.count,
  }));
}

/** Same waking-hours formula ResultsPage used inline for share cards. */
export function computeShareTimePercent(stats: StatsData | null): number {
  const runtimeHours = getRuntimeHours(stats);
  const { actualRangeDays } = buildAnalysisRange(stats);
  const safeRangeDays = Math.max(1, actualRangeDays);
  const wakingHoursPerDay = 16;
  const totalWakingHours = safeRangeDays * wakingHoursPerDay;
  let percentage = Math.round((runtimeHours / totalWakingHours) * 100);
  if (safeRangeDays <= 30) {
    const totalAvailableHours = safeRangeDays * 24;
    percentage = Math.round((runtimeHours / totalAvailableHours) * 100);
  }
  return Math.min(percentage, 100);
}

/**
 * Single StatsData → ShareCardInput mapping for Results + Story finale.
 * Callers may pass i18n fallbacks; normalizeShareCardData still runs at render.
 */
export function buildShareCardFromStats(
  stats: StatsData | null | undefined,
  options: BuildShareCardFromStatsOptions = {},
): ShareCardInput {
  const topActors = mapPeople(stats?.top_actors);
  const actorNames = new Set(topActors.map((actor) => actor.name));
  const topDirectors = mapPeople(stats?.top_directors)
    .filter((director) => !actorNames.has(director.name));

  const actorIdx = 0;
  let directorIdx = 0;
  if (
    topActors.length > 0 &&
    topDirectors.length > 0 &&
    topActors[0].name === topDirectors[0].name
  ) {
    directorIdx = topDirectors.length > 1 ? 1 : 0;
  }

  const filmSource = stats?.favorite_films?.length
    ? stats.favorite_films
    : (stats?.rated_films ?? []);
  const topFilms = filmSource.slice(0, 5).map((film) => ({
    title: film.title,
    year: film.year ? String(film.year) : '',
    posterPath: film.poster_path && film.poster_path.length > 0 ? film.poster_path : null,
  }));

  const topReviewWords = (stats?.review_analysis?.word_frequency ?? [])
    .filter(({ word }) => word && word.trim().length > 0)
    .slice(0, 3)
    .map(({ word, count }) => ({ word, count }));

  const milestones = (stats?.milestones ?? []).map((milestone) => ({
    ordinal: milestone.ordinal,
    title: milestone.title,
    year: milestone.year != null ? String(milestone.year) : '',
    posterPath:
      milestone.poster_path && milestone.poster_path.length > 0 ? milestone.poster_path : null,
  }));

  const outlier = stats?.rating_outlier_film;
  const ratingOutlierFilm = outlier
    ? {
        title: outlier.title,
        year: outlier.year != null ? String(outlier.year) : '',
        posterPath:
          outlier.poster_path && outlier.poster_path.length > 0 ? outlier.poster_path : null,
        userRating: outlier.user_rating,
        avgRating: outlier.avg_rating,
        delta: outlier.delta,
      }
    : undefined;

  const runtimeHours = getRuntimeHours(stats ?? null);
  const cineRaw = stats?.sinefil_meter?.score;
  const cinemaScale =
    cineRaw == null ? 0 : Math.max(0, Math.min(100, cineRaw));

  const crushFallback = options.unknownActor
    ? { name: options.unknownActor, headshotUrl: '', count: 0 }
    : { name: '', headshotUrl: '', count: 0 };

  const director = topDirectors[directorIdx];
  const favoriteDirector = director
    ?? (options.unknownDirector
      ? { name: options.unknownDirector, headshotUrl: '', count: 0 }
      : null);

  const timePercent =
    options.timePercent ?? computeShareTimePercent(stats ?? null);

  const username =
    options.username ||
    stats?.scraped_username ||
    undefined;

  return {
    year: options.year ?? new Date().getFullYear(),
    writtenReviews: stats?.review_analysis?.reviews_with_text ?? 0,
    genres: (stats?.top_genres ?? []).slice(0, 5).map(({ name }) => name),
    onScreenCrush: topActors[actorIdx] || crushFallback,
    favoriteDirector,
    watchedFilms: stats?.total_films || 0,
    spentDays: Math.round(runtimeHours / 24),
    spentHours: Math.round(runtimeHours),
    timePercent,
    cinemaScale,
    personaLabel: stats?.cinematic_persona?.persona || '',
    minutesAverage: Math.round(stats?.average_runtime || 0),
    mostCommonRating: stats?.most_common_rating || 3.5,
    peakDecade: stats?.favorite_decade?.name || '2020s',
    peakDecadeCount: stats?.favorite_decade?.count || 0,
    topActors,
    topDirectors,
    topFilms,
    topReviewWords,
    ratingOutlierFilm,
    milestones,
    username: username || undefined,
  };
}

export function normalizeShareCardData(data: ShareCardInput): ShareCardData {
  return {
    ...data,
    favoriteDirector: data.favoriteDirector ?? { ...DIRECTOR_UNAVAILABLE },
    genres: data.genres.filter(Boolean).slice(0, 5),
    topFilms: (data.topFilms ?? []).slice(0, 5),
  };
}

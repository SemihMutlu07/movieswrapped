'use client';

import type { StatsData } from '@/containers/results/sections/types';
import { findReviewForSummary, selectLongestReview } from '@/lib/reviews';
import type { Translator } from '@/i18n/createTranslator';
import { formatActiveDay, formatStoryTimeline } from '@/i18n/story-timeline';

import type { Slide } from '../types';
import {
  allPosterMedia,
  compactMedia,
  filmByTitle,
  genrePosters,
  generousCriticPosters,
  personFilmPosters,
  personRewatches,
  posterMedia,
  storySeason,
  topRatedPosters,
  buildDirectorSequence,
  buildActorSequence,
  buildReviewSequence,
  buildFinaleSequence,
  collectCinematicClaimedUrls,
} from '../media';
import { IntroUsername } from './IntroUsername';
import { RewatchInsight } from './RewatchInsight';
import { Big, Label, Sub } from '../SlideTypography';

export function buildSlides(stats: StatsData, i18n: Translator): Slide[] {
  const { t, formatNumber, plural } = i18n;
  const slides: Slide[] = [];
  const username = stats.scraped_username;
  const broadPosters = topRatedPosters(stats, 10);
  const directorName = stats.most_watched_director?.name ?? stats.top_directors?.[0]?.name;
  const topActor = stats.top_actors?.[0];
  const viewingSeason = storySeason(stats.story_analytics?.viewing_season);
  const mostActiveDay = formatActiveDay(stats.story_analytics?.most_active_day, i18n);
  const periodLine = formatStoryTimeline(stats.data_timeline, i18n);

  slides.push({
    key: 'intro',
    media: broadPosters,
    accent: '#f59e0b',
    visual: 'mosaic',
    body: (
      <>
        <Label>{t('story.slide.intro.brand')}</Label>
        {username ? <IntroUsername username={username} /> : <Big>{t('story.slide.intro.fallbackHeadline')}</Big>}
        {periodLine ? <Sub>{periodLine}</Sub> : null}
        <Sub className="mt-6">{t('story.slide.intro.tagline')}</Sub>
      </>
    ),
  });

  if (stats.total_films) {
    const d = stats.days_watched;
    const fastForwardPosters = allPosterMedia(stats, 24);
    slides.push({
      key: 'volume',
      media: compactMedia([
        posterMedia(stats.longest_film ? filmByTitle(stats, stats.longest_film.title) : null, 'w342'),
        ...fastForwardPosters,
        ...broadPosters,
      ], 24),
      accent: '#f97316',
      visual: 'cascade',
      body: (
        <>
          <Label>{t('story.slide.volume.label')}</Label>
          <Big>
            {plural(stats.total_films, {
              one: t('story.slide.volume.films_one'),
              other: t('story.slide.volume.films_other'),
            }, { count: formatNumber(stats.total_films) })}
          </Big>
          {d || stats.hours_watched ? (
            <Sub>
              {d
                ? t('story.slide.volume.daysSub', { days: formatNumber(d) })
                : stats.hours_watched
                  ? t('story.slide.volume.hoursSub', { hours: formatNumber(Math.round(stats.hours_watched)) })
                  : null}
            </Sub>
          ) : null}
        </>
      ),
    });
  }

  const peakMonth = (stats.monthly_viewing_habits ?? []).reduce<{ month: string; count: number } | null>(
    (best, m) => (!best || m.count > best.count ? m : best),
    null,
  );
  if (peakMonth || viewingSeason) {
    slides.push({
      key: 'rhythm',
      media: broadPosters.slice(1, 9),
      accent: '#22c55e',
      visual: 'mosaic',
      body: (
        <>
          <Label>{t('story.slide.rhythm.label')}</Label>
          <Big>{peakMonth ? peakMonth.month : viewingSeason}</Big>
          <Sub>
            {peakMonth
              ? t('story.slide.rhythm.peakMonth', { count: formatNumber(peakMonth.count) })
              : null}
            {mostActiveDay ? ` ${mostActiveDay}` : ''}
          </Sub>
        </>
      ),
    });
  }

  if (stats.favorite_genre?.name) {
    slides.push({
      key: 'genre',
      media: genrePosters(stats, stats.favorite_genre.name, 8),
      accent: '#38bdf8',
      visual: 'mosaic',
      body: (
        <>
          <Label>{t('story.slide.genre.label')}</Label>
          <Big>{stats.favorite_genre.name}</Big>
          <Sub>
            {t('story.slide.genre.sub', { count: formatNumber(stats.favorite_genre.count) })}
          </Sub>
        </>
      ),
    });
  }

  if (stats.most_watched_director?.name) {
    const directorProfile = stats.top_directors?.find((d) => d.name === stats.most_watched_director?.name);
    const directorSequence = buildDirectorSequence(
      stats,
      stats.most_watched_director.name,
      stats.most_watched_director.count,
      directorProfile,
    );
    slides.push({
      key: 'director',
      media: compactMedia([directorSequence.profile, ...directorSequence.streamPosters], 6),
      accent: '#ef4444',
      visual: 'director',
      posterLayout: { contentX: '-8%', rotation: 2 },
      directorSequence,
      body: null,
    });
  }

  if (topActor?.name) {
    const directorClaimedUrls = slides.find((slide) => slide.key === 'director')?.directorSequence?.streamPosters.map(
      (poster) => poster.url,
    ) ?? [];
    const actorProfile = stats.top_actors?.find((actor) => actor.name === topActor.name);
    const actorSequence = buildActorSequence(
      stats,
      topActor.name,
      topActor.count,
      actorProfile,
      {
        excludeUrls: new Set(directorClaimedUrls),
        directorClaimedUrls,
      },
    );
    slides.push({
      key: 'actor',
      media: compactMedia([actorSequence.profile, ...actorSequence.streamPosters], 6),
      accent: '#f472b6',
      visual: 'actor',
      posterLayout: { contentX: '-8%', rotation: 2 },
      actorSequence,
      insight: actorSequence.rewatch
        ? {
          kind: 'actor-rewatch',
          title: actorSequence.rewatch.title,
          watchCount: actorSequence.rewatch.watchCount,
        }
        : undefined,
      body: null,
    });
  }


  if (stats.average_rating != null) {
    slides.push({
      key: 'taste',
      media: compactMedia([
        posterMedia(stats.rating_outlier_film),
        ...broadPosters,
      ], 7),
      accent: '#eab308',
      visual: 'hero',
      body: (
        <>
          <Label>{t('story.slide.taste.label')}</Label>
          <Big>{stats.average_rating.toFixed(2)} ★</Big>
          {stats.total_countries
            ? (
              <Sub>
                {t('story.slide.taste.subWithCountries', { count: formatNumber(stats.total_countries) })}
              </Sub>
            )
            : <Sub>{t('story.slide.taste.sub')}</Sub>}
        </>
      ),
    });
  }

  if (stats.rating_personality || stats.most_common_rating != null) {
    const generousPosters = stats.rating_personality === 'The Generous Critic'
      ? generousCriticPosters(stats)
      : [];
    const commonRating = stats.most_common_rating;
    slides.push({
      key: 'rating-personality',
      media: generousPosters.length > 0
        ? generousPosters
        : compactMedia([posterMedia(stats.rating_outlier_film), ...topRatedPosters(stats, 8)], 9),
      accent: '#a3e635',
      visual: generousPosters.length > 0 ? 'poster-wall' : 'strip',
      body: (
        <>
          <Label>{t('story.slide.rating.label')}</Label>
          <Big>
            {stats.rating_personality ?? (
              commonRating != null
                ? t('story.slide.rating.mostly', { rating: commonRating })
                : ''
            )}
          </Big>
          {commonRating != null ? (
            <Sub>
              {commonRating <= 2.5
                ? t('story.slide.rating.low', { rating: commonRating })
                : commonRating >= 4
                  ? t('story.slide.rating.high', { rating: commonRating })
                  : t('story.slide.rating.mid', { rating: commonRating })}
            </Sub>
          ) : null}
        </>
      ),
    });
  }

  const reviews = stats.review_analysis?.reviews ?? [];
  if (reviews.length > 0) {
    const claimed = collectCinematicClaimedUrls([
      slides.find((slide) => slide.key === 'director')?.directorSequence ?? {},
      slides.find((slide) => slide.key === 'actor')?.actorSequence ?? {},
    ]);
    const reviewSequence = buildReviewSequence(stats, {
      excludeUrls: claimed.set,
      claimedUrls: claimed.urls,
    });
    if (reviewSequence) {
      slides.push({
        key: 'review-personality',
        media: compactMedia([reviewSequence.heroPoster, ...reviewSequence.streamPosters], 6),
        accent: '#fb7185',
        visual: 'review',
        posterLayout: { contentX: '-10%', rotation: 3 },
        reviewSequence,
        body: null,
      });
    }
  }

  if (stats.sinefil_meter?.score != null) {
    slides.push({
      key: 'sinefil',
      media: compactMedia([
        ...genrePosters(stats, undefined, 10),
      ], 10),
      accent: '#67e8f9',
      visual: 'mosaic',
      body: (
        <>
          <Label>{t('story.slide.sinefil.label')}</Label>
          <Big>{t('story.slide.sinefil.score', { score: formatNumber(stats.sinefil_meter.score) })}</Big>
          {stats.sinefil_meter.type && (
            <Sub>
              {t('story.slide.sinefil.prefix')}
              <strong>{stats.sinefil_meter.type}</strong>
              {t('story.slide.sinefil.suffix')}
            </Sub>
          )}
        </>
      ),
    });
  }

  if (stats.cinematic_persona?.persona) {
    const basis = stats.cinematic_persona_basis;
    slides.push({
      key: 'persona',
      media: genrePosters(stats, basis?.genre ?? stats.favorite_genre?.name, 12),
      accent: '#c084fc',
      visual: 'poster-wall',
      body: (
        <>
          <Label>{t('story.slide.persona.label')}</Label>
          <Big>{stats.cinematic_persona.persona}</Big>
          {stats.cinematic_persona.description && <Sub>{stats.cinematic_persona.description}</Sub>}
          {basis?.genre && (
            <Sub className="text-stone-300">
              {t('story.slide.persona.genreMostWatched', { genre: basis.genre })}
              {basis.match_type === 'genre_decade_country'
                ? t('story.slide.persona.basisFull', { decade: basis.decade ?? '', country: basis.country ?? '' })
                : t('story.slide.persona.basisGenre')}
            </Sub>
          )}
        </>
      ),
    });
  }

  const reviewSlide = slides.find((slide) => slide.key === 'review-personality');
  const claimed = collectCinematicClaimedUrls([
    slides.find((slide) => slide.key === 'director')?.directorSequence ?? {},
    slides.find((slide) => slide.key === 'actor')?.actorSequence ?? {},
    reviewSlide?.reviewSequence
      ? {
        streamPosters: reviewSlide.reviewSequence.streamPosters,
        heroPoster: reviewSlide.reviewSequence.heroPoster,
      }
      : {},
  ]);
  const finaleSequence = buildFinaleSequence(stats, {
    excludeUrls: claimed.set,
    claimedUrls: claimed.urls,
  });

  slides.push({
    key: 'outro',
    media: finaleSequence.curtainPosters,
    accent: '#fbbf24',
    visual: 'finale',
    posterLayout: { contentX: '-5%', rotation: -2 },
    finaleSequence,
    body: null,
  });

  return slides;
}

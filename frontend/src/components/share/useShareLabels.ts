'use client';

import { useMemo } from 'react';

import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/catalogs';
import type { ShareVariant } from './types';

export type ShareLabels = {
  yearInFilm: string;
  yourWrapped: string;
  shortWrapped: string;
  youWatched: string;
  filmsThisYear: string;
  filmsSoFar: string;
  onScreenCrush: string;
  favoriteDirector: string;
  moviesTogether: string;
  moviesDirected: string;
  days: string;
  daysSpent: string;
  rating: string;
  commonRating: string;
  scale: string;
  review: string;
  reviewWords: string;
  peakDecade: string;
  topGenres: string;
  writtenReviews: string;
  daysWatching: string;
  unknown: string;
  directorUnavailable: string;
  yearInCinema: string;
  letterboxdWrapped: string;
  headline: string;
  auteur: string;
  muse: string;
  yearAtPictures: string;
  filmsWatched: string;
  peak: string;
  mostCommon: string;
  timeWatched: string;
  scaleOutOf: string;
  topRating: string;
  daysUnit: string;
  writtenShort: string;
  runtime: string;
  letterboxdDashboard: string;
  letterboxdVertical: string;
  filmsShapedYear: (count: number, year: number | string) => string;
  wroteReviewsDays: (reviews: number, days: number) => string;
  yearInFilmShort: (year: number | string) => string;
  yearWrapped: (year: number | string) => string;
  filmsInYear: (year: number | string) => string;
  reviewsDaysHours: (reviews: number, days: number, hours: number) => string;
  volumeHeader: (year: number | string) => string;
  watchedFilmsStory: (count: number) => string;
  wroteReviewsSummary: (reviews: number, days: number, score: number) => string;
  peakDecadeFilms: (decade: string, count: number) => string;
  peakDecadeInline: (decade: string, count: number) => string;
  filmsCount: (count: number) => string;
  reviewsWrittenInline: (reviews: number) => string;
  hoursDetail: (hours: number) => string;
  daysShort: (days: number) => string;
  minAverage: (minutes: number) => string;
  personFilmsTogether: (count: number) => string;
  personFilmsDirected: (count: number) => string;
  variantLabel: (key: ShareVariant) => string;
};

const VARIANT_LABEL_KEYS: Record<ShareVariant, MessageKey> = {
  default: 'share.variant.default',
  'apple-hig': 'share.variant.appleHig',
  editorial: 'share.variant.editorial',
  'variant-3': 'share.variant.variant3',
  'double-feature': 'share.variant.doubleFeature',
  'contact-sheet': 'share.variant.contactSheet',
  'admit-one': 'share.variant.admitOne',
};

export function useShareLabels(): ShareLabels {
  const { t, formatNumber, plural } = useI18n();

  return useMemo(() => ({
    yearInFilm: t('share.card.yearInFilm'),
    yourWrapped: t('share.card.yourWrapped'),
    shortWrapped: t('share.card.shortWrapped'),
    youWatched: t('share.card.youWatched'),
    filmsThisYear: t('share.card.filmsThisYear'),
    filmsSoFar: t('share.card.filmsSoFar'),
    onScreenCrush: t('share.card.onScreenCrush'),
    favoriteDirector: t('share.card.favoriteDirector'),
    moviesTogether: t('share.card.moviesTogether'),
    moviesDirected: t('share.card.moviesDirected'),
    days: t('share.card.days'),
    daysSpent: t('share.card.daysSpent'),
    rating: t('share.card.rating'),
    commonRating: t('share.card.commonRating'),
    scale: t('share.card.scale'),
    review: t('share.card.review'),
    reviewWords: t('share.card.reviewWords'),
    peakDecade: t('share.card.peakDecade'),
    topGenres: t('share.card.topGenres'),
    writtenReviews: t('share.card.writtenReviews'),
    daysWatching: t('share.card.daysWatching'),
    unknown: t('share.card.unknown'),
    directorUnavailable: t('share.card.directorUnavailable'),
    yearInCinema: t('share.card.yearInCinema'),
    letterboxdWrapped: t('share.card.letterboxdWrapped'),
    headline: t('share.card.headline'),
    auteur: t('share.card.auteur'),
    muse: t('share.card.muse'),
    yearAtPictures: t('share.card.yearAtPictures'),
    filmsWatched: t('share.card.filmsWatched'),
    peak: t('share.card.peak'),
    mostCommon: t('share.card.mostCommon'),
    timeWatched: t('share.card.timeWatched'),
    scaleOutOf: t('share.card.scaleOutOf'),
    topRating: t('share.card.topRating'),
    daysUnit: t('share.card.daysUnit'),
    writtenShort: t('share.card.writtenShort'),
    runtime: t('share.card.runtime'),
    letterboxdDashboard: t('share.card.letterboxdDashboard'),
    letterboxdVertical: t('share.card.letterboxdVertical'),
    filmsShapedYear: (count, year) => t('share.card.filmsShapedYear', {
      count: formatNumber(count),
      year,
    }),
    wroteReviewsDays: (reviews, days) => t('share.card.wroteReviewsDays', {
      reviews: formatNumber(reviews),
      days: formatNumber(days),
    }),
    yearInFilmShort: (year) => t('share.card.yearInFilmShort', { year }),
    yearWrapped: (year) => t('share.card.yearWrapped', { year }),
    filmsInYear: (year) => t('share.card.filmsInYear', { year }),
    reviewsDaysHours: (reviews, days, hours) => t('share.card.reviewsDaysHours', {
      reviews: formatNumber(reviews),
      days: formatNumber(days),
      hours: formatNumber(hours),
    }),
    volumeHeader: (year) => t('share.card.volumeHeader', { year }),
    watchedFilmsStory: (count) => t('share.card.watchedFilmsStory', { count: formatNumber(count) }),
    wroteReviewsSummary: (reviews, days, score) => t('share.card.wroteReviewsSummary', {
      reviews: formatNumber(reviews),
      days: formatNumber(days),
      score: formatNumber(score),
    }),
    peakDecadeFilms: (decade, count) => plural(count, {
      one: t('share.card.peakDecadeFilms_one'),
      other: t('share.card.peakDecadeFilms_other'),
    }, { decade, count: formatNumber(count) }),
    peakDecadeInline: (decade, count) => plural(count, {
      one: t('share.card.peakDecadeInline_one'),
      other: t('share.card.peakDecadeInline_other'),
    }, { decade, count: formatNumber(count) }),
    filmsCount: (count) => plural(count, {
      one: t('share.card.filmsCount_one'),
      other: t('share.card.filmsCount_other'),
    }, { count: formatNumber(count) }),
    reviewsWrittenInline: (reviews) => t('share.card.reviewsWrittenInline', {
      reviews: formatNumber(reviews),
    }),
    hoursDetail: (hours) => t('share.card.hoursDetail', { hours: formatNumber(hours) }),
    daysShort: (days) => t('share.card.daysShort', { days: formatNumber(days) }),
    minAverage: (minutes) => t('share.card.minAverage', { minutes: formatNumber(minutes) }),
    personFilmsTogether: (count) => plural(count, {
      one: t('share.card.personFilmsTogether_one'),
      other: t('share.card.personFilmsTogether_other'),
    }, { count: formatNumber(count) }),
    personFilmsDirected: (count) => plural(count, {
      one: t('share.card.personFilmsDirected_one'),
      other: t('share.card.personFilmsDirected_other'),
    }, { count: formatNumber(count) }),
    variantLabel: (key) => t(VARIANT_LABEL_KEYS[key]),
  }), [t, formatNumber, plural]);
}

import type { StatsData } from '@/containers/results/sections/types';
import type { Translator } from './createTranslator';

function formatTimelineDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

/** Localized period line for the intro slide (replaces backend English period_description). */
export function formatStoryTimeline(
  timeline: StatsData['data_timeline'] | undefined,
  { t, locale, formatNumber }: Pick<Translator, 't' | 'locale' | 'formatNumber'>,
): string | null {
  if (!timeline) return null;

  const totalDays = timeline.total_days;
  if (totalDays == null || totalDays <= 0) {
    return timeline.period_description ?? null;
  }

  if (totalDays === 1 && timeline.earliest_date) {
    return t('story.slide.timeline.singleDay', {
      date: formatTimelineDate(timeline.earliest_date, locale),
    });
  }

  if (totalDays <= 365) {
    return t('story.slide.timeline.recentDays', { days: formatNumber(totalDays) });
  }

  if (totalDays <= 730) {
    return t('story.slide.timeline.journeyDays', { days: formatNumber(totalDays) });
  }

  const years = Math.floor(totalDays / 365);
  return t('story.slide.timeline.legacyYears', { years: formatNumber(years) });
}

/** Localized most-active-day line for the rhythm slide. */
export function formatActiveDay(
  value: string | { date?: string; films?: number; story?: string } | undefined,
  { t, locale, formatNumber }: Pick<Translator, 't' | 'locale' | 'formatNumber'>,
): string | null {
  if (typeof value === 'string') return value;
  if (!value) return null;
  if (value.story) return value.story;
  if (value.date && value.films != null) {
    return t('story.slide.rhythm.activeDay', {
      date: formatTimelineDate(value.date, locale),
      count: formatNumber(value.films),
    });
  }
  return value.date ?? null;
}

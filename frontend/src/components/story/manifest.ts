import type { StatsData } from '@/containers/results/sections/types';

/**
 * Slide dependency manifest — single source of truth for which slide depends on
 * which StatsData field, and how the viewer moves past it.
 *
 * - tier 'core'        → always played; `auto-min` interaction auto-advances and
 *                        also blocks early tap/→ until the min dwell elapses
 *                        (viewer cannot passively or hastily miss headlines).
 * - tier 'enrichment'  → only appears when its data is present; `manual`
 *                        interaction does NOT auto-advance, so the viewer stays
 *                        in control.
 *
 * buildSlides() already gates each slide on the same predicate; this manifest
 * makes the dependency explicit and drives autoplay + readiness in one place.
 */

export type SlideTier = 'core' | 'enrichment';
export type SlideInteraction = 'auto-min' | 'manual';

export type SlideManifestEntry = {
  key: string;
  tier: SlideTier;
  interaction: SlideInteraction;
  /** True when the data this slide renders is present in stats. */
  isReady: (stats: StatsData) => boolean;
};

export const SLIDE_MANIFEST: readonly SlideManifestEntry[] = [
  { key: 'intro', tier: 'core', interaction: 'auto-min', isReady: () => true },
  { key: 'volume', tier: 'core', interaction: 'auto-min', isReady: (s) => Boolean(s.total_films) },
  {
    key: 'rhythm',
    tier: 'enrichment',
    interaction: 'manual',
    isReady: (s) => Boolean(s.monthly_viewing_habits?.length) || Boolean(s.story_analytics?.viewing_season),
  },
  { key: 'genre', tier: 'core', interaction: 'auto-min', isReady: (s) => Boolean(s.favorite_genre?.name) },
  { key: 'director', tier: 'enrichment', interaction: 'manual', isReady: (s) => Boolean(s.most_watched_director?.name) },
  { key: 'actor', tier: 'enrichment', interaction: 'manual', isReady: (s) => Boolean(s.top_actors?.[0]?.name) },
  { key: 'taste', tier: 'core', interaction: 'auto-min', isReady: (s) => s.average_rating != null },
  {
    key: 'rating-personality',
    tier: 'enrichment',
    interaction: 'manual',
    isReady: (s) => Boolean(s.rating_personality) || s.most_common_rating != null,
  },
  {
    key: 'review-personality',
    tier: 'enrichment',
    interaction: 'manual',
    isReady: (s) => (s.review_analysis?.reviews?.length ?? 0) > 0,
  },
  { key: 'sinefil', tier: 'enrichment', interaction: 'manual', isReady: (s) => s.sinefil_meter?.score != null },
  { key: 'persona', tier: 'enrichment', interaction: 'manual', isReady: (s) => Boolean(s.cinematic_persona?.persona) },
  { key: 'outro', tier: 'core', interaction: 'manual', isReady: () => true },
];

const MANIFEST_BY_KEY: Record<string, SlideManifestEntry> = Object.fromEntries(
  SLIDE_MANIFEST.map((entry) => [entry.key, entry]),
);

const FALLBACK: SlideManifestEntry = {
  key: 'unknown',
  tier: 'enrichment',
  interaction: 'manual',
  isReady: () => true,
};

/** Manifest metadata for a slide key, defaulting unknown keys to manual enrichment. */
export function slideMeta(key: string): SlideManifestEntry {
  return MANIFEST_BY_KEY[key] ?? FALLBACK;
}

/** Keys whose data is available in stats — the resolved slide dependency plan. */
export function readySlideKeys(stats: StatsData): string[] {
  return SLIDE_MANIFEST.filter((entry) => entry.isReady(stats)).map((entry) => entry.key);
}

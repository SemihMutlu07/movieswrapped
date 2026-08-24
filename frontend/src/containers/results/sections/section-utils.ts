/**
 * Shared utilities for experimental stat sections.
 * - GateResult / requires() pattern for data gating
 * - PostHog event helpers (no personal data)
 */

import { trackEvent, trackConsentedEvent } from '@/lib/analytics';

// ─── Gating ──────────────────────────────────────────────────────────────────

export interface GateResult {
  ok: boolean;
  /** Human-readable reason shown in the dev debug panel when ok=false. */
  reason: string;
  /** Which StatsData field(s) are missing or insufficient. */
  missingFields: string[];
}

/** Helper: build a passing gate result. */
export const gateOk = (): GateResult => ({ ok: true, reason: '', missingFields: [] });

/** Helper: build a failing gate result. */
export const gateFail = (reason: string, missingFields: string[]): GateResult => ({
  ok: false,
  reason,
  missingFields,
});

// ─── Analytics events ────────────────────────────────────────────────────────

export type SectionId =
  | 'directors_grid'
  | 'cast_grid'
  | 'rating_deviation'
  | 'countries_section'
  | 'world_map'
  | 'stats_window';

export type SectionToggle = 'most_watched' | 'highest_rated' | 'lifetime' | 'year';

/** Fire once when the section scrolls into view. Pre-consent queue (always allowed). */
export function trackSectionViewed(sectionId: SectionId): void {
  trackEvent('stats_section_viewed', { section_id: sectionId });
}

/** Fire when the user switches the Most Watched / Highest Rated toggle. */
export function trackToggleChanged(sectionId: SectionId, mode: SectionToggle): void {
  trackConsentedEvent('stats_toggle_changed', { section_id: sectionId, mode });
}

/** Fire when the user clicks "Show more". */
export function trackShowMore(sectionId: SectionId): void {
  trackConsentedEvent('stats_show_more_clicked', { section_id: sectionId });
}

/** Fire when the user clicks a director / actor / film card. */
export function trackItemClicked(
  sectionId: SectionId,
  itemType: 'director' | 'actor' | 'film' | 'country',
): void {
  trackConsentedEvent('stats_item_clicked', { section_id: sectionId, item_type: itemType });
}

// ─── Shared UI helpers ───────────────────────────────────────────────────────

/** Letterboxd green (used as the main accent color for all sections). */
export const LB_GREEN = '#00c030';

/** Toggle button styles — returns className strings for the two-button segmented control. */
export function toggleClass(active: boolean): string {
  return active
    ? 'min-h-9 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold bg-[#00c030]/20 text-[#00c030] border border-[#00c030]/30 transition-colors'
    : 'min-h-9 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold text-slate-200 border border-transparent hover:text-white hover:border-white/15 transition-colors';
}

/** Letterboxd-style star rating display. */
export function formatStars(rating: number): string {
  const full = Math.floor(rating);
  const half = rating - full >= 0.25 && rating - full < 0.75;
  return '★'.repeat(full) + (half ? '½' : '');
}

/** Format delta with sign, e.g. +1.1 or -0.7 */
export function formatDelta(delta: number): string {
  return (delta >= 0 ? '+' : '') + delta.toFixed(1);
}

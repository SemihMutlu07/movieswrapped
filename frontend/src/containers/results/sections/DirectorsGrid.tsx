'use client';

/**
 * SECTION 1 — DIRECTORS GRID
 * Two-tab toggle: Most Watched / Highest Rated
 * Letterboxd dark UI vibe — circular portrait cards, pagination, time filter.
 *
 * Data requirements:
 *   Most watched  → stats.top_directors (always present if directors exist)
 *   Highest rated → stats.directors_with_ratings (emitted by backend when ratings data available)
 *
 * Gating: if top_directors is empty, hide the entire section.
 * Highest-rated tab is gated independently to directors_with_ratings presence.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { getDirectTmdbImageUrl, getProfileUrl } from '@/lib/analytics';
import type { StatsData, PersonFilm } from './types';
import type { GateResult, SectionToggle } from './section-utils';
import PersonFilmsModal from './PersonFilmsModal';
import { PersonAvatarPlaceholder } from '@/components/results/Placeholders';
import { boundSectionItems, SECTION_GRID_CLASS } from '@/containers/results/section-layout';
import { useCompactLayout } from '@/hooks/useCompactLayout';
import {
  gateOk,
  gateFail,
  trackSectionViewed,
  trackToggleChanged,
  trackItemClicked,
  toggleClass,
} from './section-utils';

// ─── Gating ──────────────────────────────────────────────────────────────────

export function requiresDirectorsGrid(stats: StatsData): GateResult {
  if (!stats.top_directors || stats.top_directors.length === 0) {
    return gateFail('No director data in this export.', ['top_directors']);
  }
  return gateOk();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DirectorCard {
  name: string;
  count: number;
  avg_rating?: number;
  rated_count?: number;
  profile_path?: string;
  films?: PersonFilm[];
}

const PAGE_SIZE = 5;

// ─── Component ───────────────────────────────────────────────────────────────

export default function DirectorsGrid({ stats }: { stats: StatsData; onDirectorClick?: (name: string) => void }) {
  const gate = requiresDirectorsGrid(stats);
  if (!gate.ok) return null;

  return <DirectorsGridInner stats={stats} />;
}

function DirectorsGridInner({ stats }: { stats: StatsData }) {
  const [mode, setMode] = useState<SectionToggle>('most_watched');
  const [selected, setSelected] = useState<DirectorCard | null>(null);
  const compact = useCompactLayout();

  const hasRatings = (stats.directors_with_ratings?.length ?? 0) > 0;

  // films come from top_directors; carry them into highest_rated rows too
  const filmsByName = useMemo(
    () => new Map((stats.top_directors ?? []).map((d) => [d.name, d.films ?? []])),
    [stats.top_directors],
  );

  // Track section viewed once on mount
  useEffect(() => {
    trackSectionViewed('directors_grid');
  }, []);

  const handleToggle = useCallback(
    (next: SectionToggle) => {
      setMode(next);
      trackToggleChanged('directors_grid', next);
    },
    [],
  );

  const directors: DirectorCard[] = useMemo(() => {
    if (mode === 'highest_rated' && hasRatings) {
      return (stats.directors_with_ratings ?? [])
        .slice()
        .sort((a, b) => b.avg_rating - a.avg_rating)
        .map((d) => ({ ...d, films: d.films ?? filmsByName.get(d.name) ?? [] }));
    }
    // Most watched — merge profile_path from directors_with_ratings if present
    const profileMap = new Map(
      (stats.directors_with_ratings ?? []).map((d) => [d.name, d.profile_path]),
    );
    return (stats.top_directors ?? []).map((d) => ({
      ...d,
      profile_path: d.profile_path ?? profileMap.get(d.name),
    }));
  }, [mode, stats.top_directors, stats.directors_with_ratings, hasRatings, filmsByName]);

  const shown = boundSectionItems(directors, 'directors', compact);

  return (
    <SectionShell
      title="Directors"
      mode={mode}
      onToggle={handleToggle}
      ratedTabDisabled={!hasRatings}
      ratedTabHint={!hasRatings ? 'Ratings data not available in this export' : undefined}
      ratedTabTooltip="Your average rating across films you&apos;ve rated for each director (minimum 3 rated films)"
    >
      <div className={SECTION_GRID_CLASS.people}>
        {shown.map((d) => (
          <PersonCard
            key={d.name}
            name={d.name}
            profilePath={d.profile_path}
            liteMotion={compact}
            primaryStat={
              mode === 'highest_rated' && d.avg_rating != null
                ? `★ ${d.avg_rating.toFixed(1)} avg`
                : `${d.count} film${d.count !== 1 ? 's' : ''}`
            }
            secondaryStat={
              mode === 'highest_rated' && d.avg_rating != null
                ? `${d.count} film${d.count !== 1 ? 's' : ''}`
                : d.avg_rating != null ? `★ ${d.avg_rating.toFixed(1)} avg` : undefined
            }
            onShowFilms={
              d.films && d.films.length > 0
                ? () => {
                    setSelected(d);
                    trackItemClicked('directors_grid', 'director');
                  }
                : undefined
            }
          />
        ))}
      </div>

      <PersonFilmsModal
        open={selected != null}
        onClose={() => setSelected(null)}
        name={selected?.name ?? ''}
        films={selected?.films ?? []}
        profilePath={selected?.profile_path}
      />
    </SectionShell>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────────────

/** Outer chrome for every section: heading + toggle + children. */
export function SectionShell({
  title,
  mode,
  onToggle,
  ratedTabDisabled,
  ratedTabHint,
  ratedTabTooltip,
  children,
}: {
  title: string;
  mode: SectionToggle;
  onToggle: (m: SectionToggle) => void;
  ratedTabDisabled?: boolean;
  ratedTabHint?: string;
  /** Tooltip for the "Highest Rated" tab explaining what the metric means. */
  ratedTabTooltip?: string;
  children: React.ReactNode;
}) {
  const activeTooltip = ratedTabTooltip
    ? ratedTabTooltip
    : ratedTabHint;
  return (
    <div className="bg-[#1a1a1a]/80 border border-white/8 rounded-2xl p-5 md:p-6 space-y-5">
      <div className="flex flex-col items-center gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-3">
        <div className="hidden sm:block" />
        <h3 className="text-lg md:text-xl font-extrabold text-white text-center">{title}</h3>
        <div className="flex max-w-full flex-wrap items-center justify-center gap-1 p-0.5 bg-slate-800/60 border border-slate-700/30 rounded-full sm:justify-self-end">
          <button
            className={toggleClass(mode === 'most_watched')}
            onClick={() => onToggle('most_watched')}
          >
            Most Watched
          </button>
          <button
            className={toggleClass(mode === 'highest_rated')}
            onClick={() => !ratedTabDisabled && onToggle('highest_rated')}
            disabled={ratedTabDisabled}
            title={ratedTabDisabled ? ratedTabHint : activeTooltip}
            style={ratedTabDisabled ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
          >
            Highest Rated
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Circular portrait card shared by Directors and Cast sections. */
export function PersonCard({
  name,
  profilePath,
  primaryStat,
  secondaryStat,
  onShowFilms,
  liteMotion = false,
}: {
  name: string;
  profilePath?: string;
  primaryStat: string;
  secondaryStat?: string;
  /** When provided, renders a "+" button that opens this person's films modal. */
  onShowFilms?: () => void;
  /** Skip hover scale / blur-backdrop work on compact and reduced-motion. */
  liteMotion?: boolean;
}) {
  const imageUrl = profilePath
    ? liteMotion
      ? getDirectTmdbImageUrl(profilePath, 'w185')
      : getProfileUrl(profilePath, 'grid')
    : null;
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [retried, setRetried] = useState(false);
  const reduce = useReducedMotion();
  const quietMotion = liteMotion || Boolean(reduce);

  const showImage = imageUrl && !imageError;
  const showFallback = !imageUrl || imageError || !imageLoaded;
  const [, setClicked] = useState(false);

  useEffect(() => {
    setImageError(false);
    setImageLoaded(false);
    setRetried(false);
  }, [imageUrl]);

  useEffect(() => {
    if (!profilePath) {
      console.debug(`[PersonCard] No profile_path for ${name}`);
    } else if (!imageUrl) {
      console.debug(`[PersonCard] getProfileUrl returned null for ${name}: profilePath=${profilePath}`);
    }
  }, [profilePath, imageUrl, name]);

  const interactive = Boolean(onShowFilms);

  return (
    <motion.div
      className={`relative flex flex-col items-center gap-2 group rounded-xl p-2 text-center hover:z-20 focus-within:z-20 ${
        interactive ? 'cursor-pointer focus-visible:outline-none' : ''
      }`}
      {...(interactive
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': `Show films with ${name}`,
            onClick: () => {
              setClicked(true);
              onShowFilms!();
            },
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setClicked(true);
                onShowFilms!();
              }
            },
          }
        : {})}
    >
      {/* Avatar */}
      <motion.div
        className="relative w-28 h-28 md:w-32 md:h-32 rounded-2xl overflow-hidden bg-gradient-to-b from-slate-700 to-slate-900"
        style={{ transformOrigin: '50% 100%' }}
        initial={false}
        whileHover={quietMotion ? undefined : {
          scale: 1.15,
          boxShadow: '0 18px 34px -8px rgba(0,0,0,0.55)',
        }}
        transition={{ duration: quietMotion ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {showImage && (
          <>
            {!quietMotion && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl!}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                className={`absolute inset-0 w-full h-full object-cover scale-150 blur-2xl saturate-150 brightness-75 transition-opacity duration-300 ${
                  imageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
              />
            )}
            <motion.img
              src={imageUrl!}
              alt={name}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
              initial={false}
              animate={{ opacity: imageLoaded ? 1 : 0, scale: quietMotion ? 1 : 1.12 }}
              whileHover={quietMotion ? undefined : { scale: 1 }}
              transition={{ duration: quietMotion ? 0.2 : 0.45, ease: [0.22, 1, 0.36, 1] }}
              onLoad={() => {
                setImageLoaded(true);
                setImageError(false);
              }}
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                if (!retried && imageUrl) {
                  setRetried(true);
                  img.src = `${imageUrl}?retry=1`;
                } else {
                  setImageError(true);
                  setImageLoaded(true);
                  img.style.display = 'none';
                }
              }}
            />
          </>
        )}
        {showFallback && <PersonAvatarPlaceholder />}
      </motion.div>
      {/* Name + stats remain visible on touch devices and without hover. */}
      <div className="space-y-0.5 w-full text-center">
        <p className="text-sm md:text-base font-semibold text-white leading-tight line-clamp-2 text-center">{name}</p>
        <p className="text-sm md:text-base text-slate-200 text-center">
          {primaryStat}
        </p>
        {secondaryStat && (
          <p className="text-xs md:text-sm text-slate-300 text-center">
            {secondaryStat}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/** "Show X more" button. */
export function ShowMoreButton({
  onClick,
  remaining,
}: {
  onClick: () => void;
  remaining: number;
}) {
  return (
    <div className="flex justify-center pt-2">
      <button
        onClick={onClick}
        className="text-xs font-semibold px-4 py-2 rounded-full border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
      >
        Show {Math.min(remaining, PAGE_SIZE)} more
      </button>
    </div>
  );
}

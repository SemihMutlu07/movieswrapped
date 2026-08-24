'use client';

/**
 * SECTION 3 — RATED HIGHER / LOWER THAN YOUR AVERAGE
 *
 * Computes delta = yourRating - userAvgRating for each rated film.
 * A) Rated Higher: largest positive delta first
 * B) Rated Lower:  most negative delta first
 *
 * Data requirements:
 *   stats.rated_films  — individual film records with your_rating + average_rating + poster_path
 *   stats.average_rating — user's global average
 *
 * Gating: if rated_films is absent or has < 5 entries, hide section.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPosterUrl } from '@/lib/analytics';
import { PosterImage } from '@/components/results/Placeholders';
import FilmModal from './FilmModal';
import type { StatsData } from './types';
import type { GateResult } from './section-utils';
import { boundSectionItems, SECTION_GRID_CLASS } from '@/containers/results/section-layout';
import { useCompactLayout } from '@/hooks/useCompactLayout';
import { useI18n } from '@/i18n/I18nProvider';
import {
  gateOk,
  gateFail,
  trackSectionViewed,
  trackItemClicked,
  formatDelta,
  LB_GREEN,
} from './section-utils';

// ─── Gating ──────────────────────────────────────────────────────────────────

export function requiresRatingDeviation(stats: StatsData): GateResult {
  if (!stats.rated_films || stats.rated_films.length < 5) {
    return gateFail(
      `rated_films absent or too few (${stats.rated_films?.length ?? 0} < 5).`,
      ['rated_films'],
    );
  }
  if (!hasAverageRating(stats)) {
    return gateFail('average_rating missing.', ['average_rating']);
  }
  return gateOk();
}

type StatsWithAverageRating = StatsData & { average_rating: number };

function hasAverageRating(stats: StatsData): stats is StatsWithAverageRating {
  return typeof stats.average_rating === 'number' && Number.isFinite(stats.average_rating);
}

function normalizedTitle(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizedYear(value: unknown): string | null {
  const year = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(year) && year > 0 ? String(year) : null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnrichedFilm {
  title: string;
  year?: number;
  rating: number;
  /** TMDB community rating on the 0–5 scale. */
  communityRating: number;
  popularity: number;
  poster_path?: string;
  /** rating − communityRating: how far your score diverges from the crowd. */
  delta: number;
  director?: string;
  runtime?: number;
  language?: string;
  review_text?: string;
}

type SubTab = 'higher' | 'lower';

// ─── Component ───────────────────────────────────────────────────────────────

export default function RatingDeviation({ stats }: { stats: StatsData }) {
  const gate = requiresRatingDeviation(stats);
  if (!gate.ok) return null;

  return <RatingDeviationInner stats={stats as StatsWithAverageRating} />;
}

function RatingDeviationInner({ stats }: { stats: StatsWithAverageRating }) {
  const { t } = useI18n();
  const compact = useCompactLayout();
  const [tab, setTab] = useState<SubTab>('higher');
  const [selectedFilm, setSelectedFilm] = useState<EnrichedFilm | null>(null);

  const userAvg = stats.average_rating;

  useEffect(() => {
    trackSectionViewed('rating_deviation');
  }, []);

  const { higher, lower } = useMemo<{ higher: EnrichedFilm[]; lower: EnrichedFilm[] }>(() => {
    type AllFilm = NonNullable<typeof stats.all_films>[0];
    const filmsByTitleYear = new Map<string, AllFilm>();
    const filmsByUniqueTitle = new Map<string, AllFilm | null>();
    (stats.all_films ?? []).forEach((f) => {
      const title = normalizedTitle(f.title);
      const year = normalizedYear(f.year);
      if (year) filmsByTitleYear.set(`${title}\u0000${year}`, f);
      filmsByUniqueTitle.set(title, filmsByUniqueTitle.has(title) ? null : f);
    });

    const films: EnrichedFilm[] = (stats.rated_films ?? []).flatMap((f) => {
      const title = normalizedTitle(f.title);
      const year = normalizedYear(f.year);
      const enrichedData = year
        ? filmsByTitleYear.get(`${title}\u0000${year}`)
        : filmsByUniqueTitle.get(title) ?? undefined;
      const communityRating = f.community_rating ?? f.average_rating;
      const yourRating = f.your_rating ?? f.rating;
      if (communityRating == null || communityRating <= 0 || yourRating == null) return [];
      return [{
        title: f.title,
        year: f.year,
        poster_path: f.poster_path || enrichedData?.poster_path,
        rating: yourRating,
        communityRating,
        popularity: f.popularity ?? enrichedData?.popularity ?? 0,
        delta: Math.round((yourRating - communityRating) * 10) / 10,
        director: enrichedData?.director,
        runtime: enrichedData?.runtime,
        language: enrichedData?.language,
      }];
    });
    return {
      higher: films.filter((f) => f.delta > 0).sort((a, b) => (b.delta - a.delta) || (b.popularity - a.popularity)),
      lower: films.filter((f) => f.delta < 0).sort((a, b) => (a.delta - b.delta) || (b.popularity - a.popularity)),
    };
  }, [stats.rated_films, stats.all_films]);

  const list = tab === 'higher' ? higher : lower;
  const shown = boundSectionItems(list, 'outliers', compact);

  const handleTabChange = (next: SubTab) => {
    setTab(next);
  };

  return (
    <>
      <FilmModal
        open={selectedFilm !== null}
        onClose={() => setSelectedFilm(null)}
        film={selectedFilm || {
          title: '',
          rating: 0,
          communityRating: 0,
        }}
        userAvg={userAvg}
      />
      <div className="bg-[#1a1a1a]/80 border border-white/8 rounded-2xl p-5 md:p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-white">{t('results.ratingOutliers.title')}</h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Where your rating diverges most from the crowd · your avg ★ {userAvg.toFixed(2)}
            </p>
          </div>
          <div className="relative flex items-center gap-1 p-0.5 bg-slate-800/60 border border-slate-700/30 rounded-full">
            <SubtabButton active={tab === 'higher'} color="green" arrow="up" onClick={() => handleTabChange('higher')}>
              Rated Higher
            </SubtabButton>
            <SubtabButton active={tab === 'lower'} color="red" arrow="down" onClick={() => handleTabChange('lower')}>
              Rated Lower
            </SubtabButton>
          </div>
        </div>

        {/* Empty state */}
        {shown.length === 0 && (
          <p className="text-sm text-slate-500 italic text-center py-8">
            {tab === 'higher'
              ? 'No films rated above your average.'
              : 'No films rated below your average.'}
          </p>
        )}

        {/* Film grid */}
        {shown.length > 0 && (
          <div className={SECTION_GRID_CLASS.outliers}>
            {shown.map((film) => (
              <FilmPosterCard
                key={`${film.title}-${film.year}`}
                film={film}
                userAvg={userAvg}
                polarity={tab}
                onOpenModal={(f) => {
                  setSelectedFilm(f);
                  trackItemClicked('rating_deviation', 'film');
                }}
              />
            ))}
          </div>
        )}

      </div>
    </>
  );
}

// ─── Film poster card ─────────────────────────────────────────────────────────

function FilmPosterCard({
  film,
  polarity,
  onOpenModal,
  className,
}: {
  film: EnrichedFilm;
  userAvg: number;
  polarity: SubTab;
  onOpenModal?: (film: EnrichedFilm) => void;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const imageUrl = film.poster_path ? getPosterUrl(film.poster_path, 'grid') : null;
  const deltaStr = formatDelta(film.delta);
  const deltaColor = polarity === 'higher' ? LB_GREEN : '#f87171';
  const showFallback = !imageUrl || imgFailed;

  const handleClick = () => {
    setRevealed((prev) => !prev);
  };

  const handleModalClick = () => {
    onOpenModal?.(film);
  };

  return (
    <div
      onClick={handleClick}
      className={`min-w-0 flex-col gap-1.5 text-left group cursor-default ${className ?? 'flex'}`}
    >
      {/* Poster */}
      <div
        className="relative w-full aspect-[2/3] rounded-lg overflow-hidden ring-1 ring-white/8 group-hover:ring-white/20 transition-all"
      >
        {imageUrl && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={film.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <PosterImage src={showFallback ? null : imageUrl} alt={`${film.title} poster`} />
        )}
        {/* Delta badge */}
        <span
          className="absolute top-1.5 right-1.5 text-xs font-bold px-2 py-1 rounded-full shadow-lg z-10"
          style={{ background: deltaColor, color: '#000', border: `1px solid ${deltaColor}` }}
        >
          {deltaStr}
        </span>

        {/* ↗ hint icon */}
        {!revealed && (
          <span className="absolute bottom-1.5 right-1.5 text-white/40 text-xs leading-none pointer-events-none">
            ↗
          </span>
        )}

        {/* Bottom panel overlay — covers lower ~55% of poster */}
        <div
          className={`absolute bottom-0 left-0 right-0 h-[55%] flex flex-col items-center justify-center gap-2 p-4 bg-[#0f0f0f]/95 transition-transform duration-300 ease-out ${
            revealed ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <p className="text-sm font-bold text-white leading-tight line-clamp-3 text-center">
            {film.title}
          </p>
          {film.year && (
            <p className="text-xs text-slate-300">{film.year}</p>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleModalClick();
            }}
            className="mt-1 text-[11px] font-semibold px-4 py-2 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors text-center"
          >
            View Details
          </button>
        </div>
      </div>

      {/* Caption */}
      <div className="min-w-0 px-0.5 space-y-0.5">
        <p className="text-xs font-medium text-white leading-tight line-clamp-1">{film.title}</p>
        <p className="text-[10px] sm:text-[11px] text-slate-400 leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
          ★ {film.rating.toFixed(1)} vs community {film.communityRating.toFixed(1)}
        </p>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SubtabButton({
  active,
  color,
  arrow,
  onClick,
  children,
}: {
  active: boolean;
  color: 'green' | 'red';
  arrow: 'up' | 'down';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const accent = color === 'green' ? '#00c030' : '#f87171';
  return (
    <button
      onClick={onClick}
      className="relative flex items-center gap-1 px-3 py-1 min-h-[44px] rounded-full text-xs font-semibold"
      style={{ color: active ? accent : '#cbd5e1' }}
    >
      {active && (
        <motion.span
          layoutId="ratingTogglePill"
          className="absolute inset-0 rounded-full"
          style={{ background: accent + '26', border: `1px solid ${accent}4d` }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        />
      )}
      <span className="relative flex items-center gap-1">
        <AnimatePresence mode="popLayout" initial={false}>
          {active && (
            <motion.span
              key={arrow}
              initial={{ opacity: 0, y: arrow === 'up' ? 4 : -4, scale: 0.6 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: arrow === 'up' ? 4 : -4, scale: 0.6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="inline-block leading-none"
            >
              {arrow === 'up' ? '▲' : '▼'}
            </motion.span>
          )}
        </AnimatePresence>
        {children}
      </span>
    </button>
  );
}

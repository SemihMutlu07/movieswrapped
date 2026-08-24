'use client';

/**
 * SECTION 2 — CAST GRID
 * Mirrors DirectorsGrid for actors/cast.
 *
 * Data requirements:
 *   Most watched  → stats.top_actors (always present if cast exists)
 *   Highest rated → stats.actors_with_ratings (emitted by backend when ratings available)
 *
 * Gating: if top_actors is empty, hide the entire section.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import type { StatsData, PersonFilm } from './types';
import type { GateResult, SectionToggle } from './section-utils';
import PersonFilmsModal from './PersonFilmsModal';
import { boundSectionItems, SECTION_GRID_CLASS } from '@/containers/results/section-layout';
import { useCompactLayout } from '@/hooks/useCompactLayout';
import {
  gateOk,
  gateFail,
  trackSectionViewed,
  trackToggleChanged,
  trackItemClicked,
} from './section-utils';
import { SectionShell, PersonCard } from './DirectorsGrid';

// ─── Gating ──────────────────────────────────────────────────────────────────

export function requiresCastGrid(stats: StatsData): GateResult {
  if (!stats.top_actors || stats.top_actors.length === 0) {
    return gateFail('No cast data in this export.', ['top_actors']);
  }
  return gateOk();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActorCard {
  name: string;
  count: number;
  avg_rating?: number;
  rated_count?: number;
  profile_path?: string;
  films?: PersonFilm[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CastGrid({ stats }: { stats: StatsData; onActorClick?: (name: string) => void }) {
  const gate = requiresCastGrid(stats);
  if (!gate.ok) return null;

  return <CastGridInner stats={stats} />;
}

function CastGridInner({ stats }: { stats: StatsData }) {
  const [mode, setMode] = useState<SectionToggle>('most_watched');
  const [selected, setSelected] = useState<ActorCard | null>(null);
  const compact = useCompactLayout();

  const hasRatings = (stats.actors_with_ratings?.length ?? 0) > 0;

  const filmsByName = useMemo(
    () => new Map((stats.top_actors ?? []).map((a) => [a.name, a.films ?? []])),
    [stats.top_actors],
  );

  useEffect(() => {
    trackSectionViewed('cast_grid');
  }, []);

  const handleToggle = useCallback((next: SectionToggle) => {
    setMode(next);
    trackToggleChanged('cast_grid', next);
  }, []);

  const actors: ActorCard[] = useMemo(() => {
    if (mode === 'highest_rated' && hasRatings) {
      return (stats.actors_with_ratings ?? [])
        .slice()
        .sort((a, b) => b.avg_rating - a.avg_rating)
        .map((a) => ({ ...a, films: a.films ?? filmsByName.get(a.name) ?? [] }));
    }
    // Most watched — pull profile_paths from actors_with_ratings if available
    const profileMap = new Map(
      (stats.actors_with_ratings ?? []).map((a) => [a.name, a.profile_path]),
    );
    return (stats.top_actors ?? []).map((a) => ({
      ...a,
      profile_path: a.profile_path ?? profileMap.get(a.name),
    }));
  }, [mode, stats.top_actors, stats.actors_with_ratings, hasRatings, filmsByName]);

  const shown = boundSectionItems(actors, 'cast', compact);

  return (
    <SectionShell
      title="Cast"
      mode={mode}
      onToggle={handleToggle}
      ratedTabDisabled={!hasRatings}
      ratedTabHint={!hasRatings ? 'Ratings data not available in this export' : undefined}
  ratedTabTooltip="Your average rating across films you&apos;ve rated for each actor (minimum 3 rated films)"
    >
      <div className={SECTION_GRID_CLASS.people}>
        {shown.map((a) => (
          <PersonCard
            key={a.name}
            name={a.name}
            profilePath={a.profile_path}
            liteMotion={compact}
            primaryStat={
              mode === 'highest_rated' && a.avg_rating != null
                ? `★ ${a.avg_rating.toFixed(1)} avg`
                : `${a.count} film${a.count !== 1 ? 's' : ''}`
            }
            secondaryStat={
              mode === 'highest_rated' && a.avg_rating != null
                ? `${a.count} film${a.count !== 1 ? 's' : ''}`
                : a.avg_rating != null ? `★ ${a.avg_rating.toFixed(1)} avg` : undefined
            }
            onShowFilms={
              a.films && a.films.length > 0
                ? () => {
                    setSelected(a);
                    trackItemClicked('cast_grid', 'actor');
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

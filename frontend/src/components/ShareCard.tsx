'use client';

import React from 'react';

import type { ShareCardData } from '@/components/share/types';
import {
  Brand,
  GenresLine,
  Metric,
  PersonPanel,
  Username,
} from '@/components/share/variants/shared/LayoutPrimitives';
import { useShareLabels } from '@/components/share/useShareLabels';

type Props = { data: ShareCardData };

const ShareCard = React.forwardRef<HTMLDivElement, Props>(function ShareCard({ data }, ref) {
  const labels = useShareLabels();

  return (
    <div
      ref={ref}
      data-export-root="true"
      className="relative flex h-[675px] w-[1200px] overflow-hidden bg-[#0d0d0d] p-10 text-white"
      style={{ fontFamily: "'Avenir Next', Manrope, 'Segoe UI', system-ui, sans-serif" }}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-400 to-emerald-400" />
      <div className="grid min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex min-w-0 items-start justify-between gap-8">
          <div className="min-w-0">
            <p className="text-[13px] font-bold uppercase tracking-[0.22em] text-neutral-400">
              {data.year} · {labels.yearInFilm}
            </p>
            <h1 className="mt-1 text-[38px] font-black leading-tight [overflow-wrap:anywhere]">
              {labels.yourWrapped}
            </h1>
          </div>
          <Username username={data.username} className="max-w-[280px] text-right text-[14px] text-neutral-400" />
        </header>

        <main className="mt-7 grid min-h-0 min-w-0 grid-cols-[minmax(0,1.08fr)_minmax(440px,0.92fr)] gap-7">
          <section className="flex min-h-0 min-w-0 flex-col rounded-[28px] border border-white/10 bg-white/[0.035] p-7">
            <p className="text-[15px] font-bold uppercase tracking-[0.18em] text-violet-300">{labels.youWatched}</p>
            <div className="mt-2 flex min-w-0 items-end gap-4">
              <strong className="text-[118px] font-black leading-[0.8] tabular-nums text-white">
                {data.watchedFilms}
              </strong>
              <span className="pb-2 text-[28px] font-black text-neutral-300">{labels.filmsSoFar}</span>
            </div>

            <div className="mt-7 grid grid-cols-3 gap-3">
              <Metric
                label={labels.writtenReviews}
                value={data.writtenReviews}
                className="rounded-2xl bg-black/30 p-4"
                valueClassName="text-[32px] font-black leading-none text-fuchsia-300 tabular-nums"
              />
              <Metric
                label={labels.daysWatching}
                value={data.spentDays}
                className="rounded-2xl bg-black/30 p-4"
                valueClassName="text-[32px] font-black leading-none text-emerald-300 tabular-nums"
              />
              <Metric
                label={labels.scale}
                value={`${Math.round(data.cinemaScale)}/100`}
                className="rounded-2xl bg-black/30 p-4"
                valueClassName="text-[32px] font-black leading-none text-violet-300 tabular-nums"
              />
            </div>

            <div className="mt-auto grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-end gap-6 pt-6">
              <Metric
                label={labels.peakDecade}
                value={data.peakDecade}
                detail={labels.filmsCount(data.peakDecadeCount)}
                valueClassName="text-[26px] font-black leading-none"
              />
              <div className="min-w-0 text-right">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-neutral-500">{labels.topGenres}</p>
                <GenresLine genres={data.genres} className="mt-2 text-[15px] font-semibold leading-snug text-neutral-300" />
              </div>
            </div>
            <Brand className="mt-5 text-[12px] text-neutral-500" />
          </section>

          <section className="grid min-h-0 min-w-0 grid-rows-2 gap-4">
            <PersonPanel
              person={data.onScreenCrush}
              label={labels.onScreenCrush}
              countLabel={labels.moviesTogether}
              unknownName={labels.unknown}
              className="rounded-[28px] border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/15 to-violet-500/5 p-5"
              mediaClassName="w-[112px] rounded-2xl border border-white/10 bg-zinc-900"
              nameClassName="text-[25px] font-black leading-tight text-white"
            />
            <PersonPanel
              person={data.favoriteDirector}
              label={labels.favoriteDirector}
              countLabel={labels.moviesDirected}
              unknownName={labels.directorUnavailable}
              className="rounded-[28px] border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 to-cyan-500/5 p-5"
              mediaClassName="w-[112px] rounded-2xl border border-white/10 bg-zinc-900"
              nameClassName="text-[25px] font-black leading-tight text-white"
            />
          </section>
        </main>
      </div>
    </div>
  );
});

export default ShareCard;

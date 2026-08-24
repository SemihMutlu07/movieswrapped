'use client';

import React from 'react';

import type { ShareCardData } from '../types';
import {
  Brand,
  GenresLine,
  Metric,
  PersonPanel,
  Username,
} from './shared/LayoutPrimitives';
import { useShareLabels } from '../useShareLabels';

type Props = { data: ShareCardData };

const AppleHIGShareCard = React.forwardRef<HTMLDivElement, Props>(
  function AppleHIGShareCard({ data }, ref) {
    const labels = useShareLabels();

    return (
      <div
        ref={ref}
        data-export-root="true"
        className="relative flex h-[675px] w-[1200px] flex-col overflow-hidden bg-[#f5f5f7] p-10 text-[#1d1d1f]"
        style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif" }}
      >
        <header className="flex min-w-0 items-center justify-between gap-8 border-b border-black/10 pb-5">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#6e6e73]">{labels.yearWrapped(data.year)}</p>
            <h1 className="mt-1 text-[32px] font-semibold tracking-[-0.025em]">{labels.yourWrapped}</h1>
          </div>
          <Username username={data.username} className="max-w-[300px] text-right text-[15px] font-semibold text-[#6e6e73]" />
        </header>

        <main className="mt-6 grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,0.92fr)_minmax(0,1.28fr)] gap-5">
          <section className="flex min-h-0 min-w-0 flex-col rounded-[24px] bg-white p-6 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
            <p className="text-[14px] font-semibold text-[#6e6e73]">{labels.filmsWatched}</p>
            <strong className="mt-2 text-[104px] font-semibold leading-[0.9] tracking-[-0.06em] tabular-nums">
              {data.watchedFilms}
            </strong>
            <p className="mt-2 text-[24px] font-semibold">{labels.filmsInYear(data.year)}</p>

            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-black/10 pt-5">
              <Metric
                label={labels.writtenShort}
                value={data.writtenReviews}
                valueClassName="text-[28px] font-semibold leading-none tabular-nums"
              />
              <Metric
                label={labels.days}
                value={data.spentDays}
                valueClassName="text-[28px] font-semibold leading-none tabular-nums"
              />
              <Metric
                label={labels.scale}
                value={Math.round(data.cinemaScale)}
                detail={labels.scaleOutOf}
                valueClassName="text-[28px] font-semibold leading-none tabular-nums"
              />
            </div>

            <div className="mt-auto border-t border-black/10 pt-5">
              <GenresLine genres={data.genres} className="text-[15px] font-medium leading-snug text-[#6e6e73]" />
              <div className="mt-3 flex items-end justify-between gap-4">
                <span className="text-[14px] font-semibold">
                  {labels.peakDecadeInline(data.peakDecade, data.peakDecadeCount)}
                </span>
                <Brand className="text-[11px] text-[#86868b]" />
              </div>
            </div>
          </section>

          <section className="grid min-h-0 min-w-0 grid-rows-2 gap-5">
            <PersonPanel
              person={data.onScreenCrush}
              label={labels.onScreenCrush}
              countLabel={labels.moviesTogether}
              countText={labels.personFilmsTogether(data.onScreenCrush.count)}
              unknownName={labels.unknown}
              className="rounded-[24px] bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
              mediaClassName="w-[116px] rounded-[18px] bg-[#e8e8ed]"
              labelClassName="text-[13px] font-semibold text-[#0071e3]"
              nameClassName="text-[27px] font-semibold leading-tight tracking-[-0.02em]"
              countClassName="text-[14px] text-[#6e6e73]"
            />
            <PersonPanel
              person={data.favoriteDirector}
              label={labels.favoriteDirector}
              countLabel={labels.moviesDirected}
              countText={labels.personFilmsDirected(data.favoriteDirector.count)}
              unknownName={labels.directorUnavailable}
              className="rounded-[24px] bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
              mediaClassName="w-[116px] rounded-[18px] bg-[#e8e8ed]"
              labelClassName="text-[13px] font-semibold text-[#0071e3]"
              nameClassName="text-[27px] font-semibold leading-tight tracking-[-0.02em]"
              countClassName="text-[14px] text-[#6e6e73]"
            />
          </section>
        </main>
      </div>
    );
  },
);

export default AppleHIGShareCard;

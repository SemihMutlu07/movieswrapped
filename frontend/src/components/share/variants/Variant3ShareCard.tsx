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

const Variant3ShareCard = React.forwardRef<HTMLDivElement, Props>(
  function Variant3ShareCard({ data }, ref) {
    const labels = useShareLabels();

    return (
      <div
        ref={ref}
        data-export-root="true"
        className="relative flex h-[675px] w-[1200px] flex-col overflow-hidden bg-[#111a18] p-8 text-[#e8fff6]"
        style={{ fontFamily: "'Arial Narrow', 'Roboto Condensed', Arial, sans-serif" }}
      >
        <header className="flex min-w-0 items-center justify-between gap-8">
          <div className="flex min-w-0 items-baseline gap-4">
            <h1 className="text-[34px] font-black uppercase tracking-[-0.02em]">{labels.letterboxdDashboard}</h1>
            <span className="rounded-full bg-[#00e054] px-3 py-1 text-[13px] font-black text-[#061109]">{data.year}</span>
          </div>
          <Username username={data.username} className="max-w-[300px] text-right text-[13px] font-bold text-[#9abcae]" />
        </header>

        <main className="mt-5 grid min-h-0 min-w-0 flex-1 grid-cols-12 grid-rows-6 gap-3">
          <Metric
            label={labels.filmsWatched}
            value={data.watchedFilms}
            detail={labels.reviewsWrittenInline(data.writtenReviews)}
            className="col-span-4 row-span-3 flex flex-col justify-center rounded-2xl bg-[#00e054] p-6 text-[#061109]"
            labelClassName="text-[13px] font-black uppercase tracking-[0.16em]"
            valueClassName="text-[88px] font-black leading-none tabular-nums"
            detailClassName="text-[16px] font-bold"
          />
          <Metric
            label={labels.scale}
            value={Math.round(data.cinemaScale)}
            detail={labels.scaleOutOf}
            className="col-span-2 row-span-2 rounded-2xl bg-[#ff8000] p-5 text-black"
            labelClassName="text-[12px] font-black uppercase tracking-[0.12em]"
            valueClassName="text-[48px] font-black leading-none tabular-nums"
            detailClassName="text-[14px] font-black"
          />
          <Metric
            label={labels.timeWatched}
            value={labels.daysShort(data.spentDays)}
            detail={labels.hoursDetail(data.spentHours)}
            className="col-span-2 row-span-2 rounded-2xl border border-[#00e054]/30 bg-[#182824] p-5"
            valueClassName="text-[44px] font-black leading-none tabular-nums"
          />
          <Metric
            label={labels.peakDecade}
            value={data.peakDecade}
            detail={labels.filmsCount(data.peakDecadeCount)}
            className="col-span-2 row-span-2 rounded-2xl border border-[#40bcf4]/35 bg-[#13252d] p-5"
            valueClassName="text-[34px] font-black leading-none text-[#40bcf4]"
          />
          <Metric
            label={labels.commonRating}
            value={`${data.mostCommonRating}★`}
            className="col-span-2 row-span-2 rounded-2xl bg-[#283431] p-5"
            valueClassName="text-[40px] font-black leading-none text-white tabular-nums"
          />

          <PersonPanel
            person={data.onScreenCrush}
            label={labels.onScreenCrush}
            countLabel={labels.moviesTogether}
            countText={labels.personFilmsTogether(data.onScreenCrush.count)}
            unknownName={labels.unknown}
            className="col-span-4 row-span-3 rounded-2xl border border-[#ff8000]/35 bg-[#241b14] p-4"
            mediaClassName="w-[106px] rounded-xl border border-[#ff8000]/30 bg-[#33251b]"
            nameClassName="text-[22px] font-black leading-tight"
          />
          <PersonPanel
            person={data.favoriteDirector}
            label={labels.favoriteDirector}
            countLabel={labels.moviesDirected}
            countText={labels.personFilmsDirected(data.favoriteDirector.count)}
            unknownName={labels.directorUnavailable}
            className="col-span-4 row-span-3 rounded-2xl border border-[#00e054]/35 bg-[#13231d] p-4"
            mediaClassName="w-[106px] rounded-xl border border-[#00e054]/30 bg-[#1d3028]"
            nameClassName="text-[22px] font-black leading-tight"
          />
          <section className="col-span-4 row-span-3 flex min-w-0 flex-col justify-between rounded-2xl border border-white/10 bg-[#1a211f] p-5">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#9abcae]">{labels.topGenres}</p>
              <GenresLine genres={data.genres} className="mt-3 text-[19px] font-black uppercase leading-snug" />
            </div>
            <div className="flex items-end justify-between gap-4 border-t border-white/10 pt-4">
              <span className="text-[13px] font-bold text-[#9abcae]">{labels.minAverage(data.minutesAverage)}</span>
              <Brand className="text-[11px] text-[#00e054]" />
            </div>
          </section>
        </main>
      </div>
    );
  },
);

export default Variant3ShareCard;

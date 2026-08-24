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

const EditorialShareCard = React.forwardRef<HTMLDivElement, Props>(
  function EditorialShareCard({ data }, ref) {
    const labels = useShareLabels();

    return (
      <div
        ref={ref}
        data-export-root="true"
        className="relative flex h-[675px] w-[1200px] flex-col overflow-hidden bg-[#eee8dc] px-10 py-8 text-[#171717]"
        style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
      >
        <header className="flex min-w-0 items-center justify-between gap-8 border-y border-black/80 py-3">
          <p className="text-[13px] font-bold uppercase tracking-[0.22em]">{labels.volumeHeader(data.year)}</p>
          <Username username={data.username} className="max-w-[320px] text-right text-[13px] italic" />
        </header>

        <main className="mt-6 grid min-h-0 min-w-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-8">
          <section className="grid min-h-0 grid-rows-[minmax(0,1.18fr)_minmax(0,0.82fr)] gap-4">
            <PersonPanel
              person={data.favoriteDirector}
              label={labels.auteur}
              countLabel={labels.moviesDirected}
              countText={labels.personFilmsDirected(data.favoriteDirector.count)}
              unknownName={labels.directorUnavailable}
              className="border border-black/70 bg-[#e0d4c2] p-4"
              mediaClassName="w-[122px] border border-black/40 bg-[#cabba5]"
              labelClassName="text-[11px] font-bold uppercase tracking-[0.18em]"
              nameClassName="text-[24px] font-bold leading-[1.05]"
              countClassName="text-[13px] italic"
            />
            <PersonPanel
              person={data.onScreenCrush}
              label={labels.muse}
              countLabel={labels.moviesTogether}
              countText={labels.personFilmsTogether(data.onScreenCrush.count)}
              unknownName={labels.unknown}
              className="border border-black/70 bg-[#e8dfd1] p-4"
              mediaClassName="w-[94px] border border-black/40 bg-[#cabba5]"
              labelClassName="text-[11px] font-bold uppercase tracking-[0.18em]"
              nameClassName="text-[21px] font-bold leading-[1.05]"
              countClassName="text-[13px] italic"
            />
          </section>

          <section className="flex min-h-0 min-w-0 flex-col border-l border-black/80 pl-8">
            <p className="text-[12px] font-bold uppercase tracking-[0.25em]">{labels.yearAtPictures}</p>
            <h1 className="mt-3 max-w-[720px] text-[44px] font-black leading-[1.02] tracking-[-0.035em] [text-wrap:balance]">
              {labels.watchedFilmsStory(data.watchedFilms)}
            </h1>
            <p className="mt-4 max-w-[690px] text-[17px] leading-relaxed">
              {labels.wroteReviewsSummary(data.writtenReviews, data.spentDays, Math.round(data.cinemaScale))}
            </p>

            <div className="mt-6 grid grid-cols-3 border-y border-black/70 py-4">
              <Metric
                label={labels.peakDecade}
                value={data.peakDecade}
                detail={labels.filmsCount(data.peakDecadeCount)}
                className="border-r border-black/50 pr-4"
                valueClassName="text-[28px] font-black leading-none"
              />
              <Metric
                label={labels.commonRating}
                value={`${data.mostCommonRating} ★`}
                className="border-r border-black/50 px-4"
                valueClassName="text-[28px] font-black leading-none"
              />
              <Metric
                label={labels.runtime}
                value={`${data.minutesAverage}m`}
                className="pl-4"
                valueClassName="text-[28px] font-black leading-none"
              />
            </div>

            <div className="mt-auto flex min-w-0 items-end justify-between gap-8 pt-5">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em]">{labels.topGenres}</p>
                <GenresLine genres={data.genres} className="mt-1 max-w-[580px] text-[15px] font-bold leading-snug" />
              </div>
              <Brand className="shrink-0 text-[11px] uppercase" />
            </div>
          </section>
        </main>
      </div>
    );
  },
);

export default EditorialShareCard;

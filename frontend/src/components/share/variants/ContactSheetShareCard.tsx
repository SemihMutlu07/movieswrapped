'use client';

import React from 'react';

import type { ShareCardData } from '../types';
import {
  Brand,
  GenresLine,
  Metric,
  PortraitFrame,
  Username,
} from './shared/LayoutPrimitives';
import { useShareLabels } from '../useShareLabels';

type Props = { data: ShareCardData };

const ContactSheetShareCard = React.forwardRef<HTMLDivElement, Props>(
  function ContactSheetShareCard({ data }, ref) {
    const labels = useShareLabels();
    const crushName = data.onScreenCrush.name?.trim() ? data.onScreenCrush.name : labels.unknown;
    const directorName = data.favoriteDirector.name?.trim()
      ? data.favoriteDirector.name
      : labels.directorUnavailable;

    return (
      <div
        ref={ref}
        data-export-root="true"
        className="relative h-[1200px] w-[675px] overflow-hidden bg-[#101413] text-[#f4f7f5]"
        style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
      >
        <div className="absolute left-0 top-0 h-full w-3 bg-[#00e054]" />
        <div className="mx-10 flex h-full min-w-0 flex-col py-[158px]">
          <header className="flex min-w-0 items-start justify-between gap-6 border-b-4 border-white pb-4">
            <div className="min-w-0">
              <p className="text-[12px] font-black uppercase tracking-[0.22em] text-[#00e054]">{labels.letterboxdVertical}</p>
              <h1 className="mt-1 text-[38px] font-black uppercase leading-none">{labels.shortWrapped}</h1>
            </div>
            <div className="shrink-0 text-right">
              <strong className="block text-[30px] font-black">{data.year}</strong>
              <Username username={data.username} className="block max-w-[185px] text-[11px] text-[#aab8b2]" />
            </div>
          </header>

          <section className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)_175px] items-end gap-6">
            <div className="min-w-0">
              <p className="text-[12px] font-black uppercase tracking-[0.18em] text-[#aab8b2]">{labels.filmsWatched}</p>
              <strong className="block text-[112px] font-black leading-[0.8] tracking-[-0.055em] tabular-nums text-[#00e054]">
                {data.watchedFilms}
              </strong>
            </div>
            <p className="border-l border-white/30 pl-5 text-[18px] font-bold leading-snug whitespace-pre-line">
              {labels.reviewsDaysHours(data.writtenReviews, data.spentDays, data.spentHours)}
            </p>
          </section>

          <section className="mt-6 grid grid-cols-3 gap-2">
            <Metric
              label={labels.scale}
              value={Math.round(data.cinemaScale)}
              detail={labels.scaleOutOf}
              className="border border-white/20 p-3"
              valueClassName="text-[34px] font-black leading-none tabular-nums"
            />
            <Metric
              label={labels.peak}
              value={data.peakDecade}
              detail={labels.filmsCount(data.peakDecadeCount)}
              className="border border-white/20 p-3"
              valueClassName="text-[27px] font-black leading-none"
            />
            <Metric
              label={labels.rating}
              value={`${data.mostCommonRating}★`}
              detail={labels.mostCommon}
              className="border border-white/20 p-3"
              valueClassName="text-[30px] font-black leading-none"
            />
          </section>

          <section className="mt-5 grid min-h-0 min-w-0 flex-1 grid-cols-2 gap-3">
            <section className="flex min-w-0 flex-col items-center border border-[#00e054]/45 bg-[#15201c] p-4 text-center">
              <PortraitFrame
                person={data.onScreenCrush}
                className="w-[156px] border border-[#00e054]/40 bg-[#1f3029]"
              />
              <div className="mt-4 min-w-0 [overflow-wrap:anywhere]">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#00e054]">{labels.onScreenCrush}</p>
                <p className="mt-1 text-[20px] font-black leading-tight">{crushName}</p>
                <p className="mt-1 text-[13px] text-[#aab8b2]">{labels.personFilmsTogether(data.onScreenCrush.count)}</p>
              </div>
            </section>
            <section className="flex min-w-0 flex-col items-center border border-[#00e054]/45 bg-[#15201c] p-4 text-center">
              <PortraitFrame
                person={data.favoriteDirector}
                className="w-[156px] border border-[#00e054]/40 bg-[#1f3029]"
              />
              <div className="mt-4 min-w-0 [overflow-wrap:anywhere]">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#00e054]">{labels.favoriteDirector}</p>
                <p className="mt-1 text-[20px] font-black leading-tight">{directorName}</p>
                <p className="mt-1 text-[13px] text-[#aab8b2]">{labels.personFilmsDirected(data.favoriteDirector.count)}</p>
              </div>
            </section>
          </section>

          <footer className="mt-5 min-w-0 border-t-4 border-white pt-4">
            <GenresLine genres={data.genres} className="text-[14px] font-black uppercase leading-snug" />
            <Brand className="mt-3 block text-[11px] text-[#00e054]" />
          </footer>
        </div>
      </div>
    );
  },
);

export default ContactSheetShareCard;

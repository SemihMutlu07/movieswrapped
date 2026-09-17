import React from 'react';
import Image from 'next/image';
import { getTmdbImageUrl } from '@/lib/analytics';
import type { ShareCardData, ShareOrientation } from '../types';

type Props = {
  data: ShareCardData;
  className?: string;
  orientation?: ShareOrientation;
};

/* Palette 3 — coolors.co/palette/ccd5ae-e9edc9-fefae0-faedcd-d4a373 */
const SAGE = '#CCD5AE';
const CREAM = '#FEFAE0';
const SAND = '#FAEDCD';
const CLAY = '#D4A373';
const TEXT = '#3F3722';
const TEXT_SECONDARY = '#8A7F5E';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

function OutlierFilmCard({ film }: { film?: ShareCardData['ratingOutlierFilm'] }) {
  if (!film) return null;
  const posterUrl = film.posterPath ? getTmdbImageUrl(film.posterPath, 'w780') : null;
  const sign = film.delta > 0 ? '+' : '';
  const deltaColor = film.delta > 0 ? '#5A7D4C' : '#B5533C';
  return (
    <div className="flex items-center gap-4 px-4 py-3" style={{ background: CREAM, border: `1px solid ${SAND}`, borderRadius: 16 }}>
      <div className="relative shrink-0 overflow-hidden" style={{ width: 68, height: 102, borderRadius: 10, background: SAND }}>
        {posterUrl ? (
          <Image src={posterUrl} alt={film.title} fill sizes="68px" className="object-cover" crossOrigin="anonymous" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[10px] font-bold text-center px-1" style={{ color: TEXT_SECONDARY }}>
            {film.title.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="uppercase tracking-[0.14em] text-[10px] font-bold" style={{ color: CLAY }}>
          Rating Outlier
        </div>
        <div className="mt-1 text-[16px] font-bold leading-tight truncate" style={{ color: TEXT }}>
          {film.title}
          {film.year ? <span className="font-normal" style={{ color: TEXT_SECONDARY }}> {film.year}</span> : null}
        </div>
        <div className="mt-1 text-[12px]" style={{ color: TEXT_SECONDARY }}>
          You <span className="font-bold" style={{ color: TEXT }}>{film.userRating}★</span>
          {'  ·  '}Avg <span className="font-bold" style={{ color: TEXT }}>{film.avgRating.toFixed(1)}</span>
          {'  '}<span className="font-bold" style={{ color: deltaColor }}>{sign}{film.delta.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3" style={{ background: CREAM, border: `1px solid ${SAND}`, borderRadius: 16 }}>
      <div className="uppercase tracking-[0.14em] text-[10px] font-bold" style={{ color: CLAY }}>
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[24px] font-black" style={{ color: TEXT }}>
          {value}
        </span>
        {unit && (
          <span className="text-[11px] font-semibold" style={{ color: TEXT_SECONDARY }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

const MinimalOutlierShareCard = React.forwardRef<HTMLDivElement, Props>(
  function MinimalOutlierShareCard({ data, className = '', orientation = 'horizontal' }, ref) {
    const isVertical = orientation === 'vertical';

    const tiles = (
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Days Spent" value={data.spentDays} unit="days" />
        <StatTile label="Avg Runtime" value={data.minutesAverage} unit="min" />
      </div>
    );

    if (isVertical) {
      return (
        <div
          ref={ref}
          data-export-root="true"
          className={cx('w-[675px] h-[1200px] flex flex-col', className)}
          style={{ background: SAGE, fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif' }}
        >
          <div className="px-12 pt-14">
            <div className="uppercase tracking-[0.2em] text-[12px] font-bold" style={{ color: TEXT_SECONDARY }}>
              Year In Film
              {data.username && <span className="ml-3 normal-case tracking-normal">@{data.username}</span>}
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-center px-12">
            <div className="text-[15px] font-semibold uppercase tracking-[0.16em]" style={{ color: CLAY }}>
              Cinema Scale
            </div>
            <div className="text-[160px] font-black leading-none tabular-nums -ml-1" style={{ color: TEXT }}>
              {data.cinemaScale.toFixed(0)}
            </div>
            <div className="text-[16px] font-medium mt-2" style={{ color: TEXT_SECONDARY }}>
              {data.personaLabel || `${data.watchedFilms.toLocaleString()} films watched`}
            </div>
          </div>

          <div className="px-12 pb-4">{tiles}</div>
          <div className="px-12 pb-8">
            <OutlierFilmCard film={data.ratingOutlierFilm} />
          </div>

          <div className="text-center text-[11px] font-semibold tracking-[0.14em] uppercase pb-8" style={{ color: TEXT_SECONDARY }}>
            movieswrapped.com
          </div>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        data-export-root="true"
        className={cx('w-[1200px] h-[675px] grid grid-cols-12', className)}
        style={{ background: SAGE, fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif' }}
      >
        <div className="col-span-7 flex flex-col justify-center px-12">
          <div className="uppercase tracking-[0.2em] text-[12px] font-bold" style={{ color: TEXT_SECONDARY }}>
            Year In Film
            {data.username && <span className="ml-3 normal-case tracking-normal">@{data.username}</span>}
          </div>
          <div className="text-[15px] font-semibold uppercase tracking-[0.16em] mt-4" style={{ color: CLAY }}>
            Cinema Scale
          </div>
          <div className="text-[140px] font-black leading-none tabular-nums -ml-1" style={{ color: TEXT }}>
            {data.cinemaScale.toFixed(0)}
          </div>
          <div className="text-[16px] font-medium mt-2" style={{ color: TEXT_SECONDARY }}>
            {data.personaLabel || `${data.watchedFilms.toLocaleString()} films watched`}
          </div>
        </div>
        <div className="col-span-5 flex flex-col justify-center gap-3 px-8">
          {tiles}
          <OutlierFilmCard film={data.ratingOutlierFilm} />
          <div className="text-[10px] font-semibold tracking-[0.14em] uppercase mt-2" style={{ color: TEXT_SECONDARY }}>
            movieswrapped.com
          </div>
        </div>
      </div>
    );
  },
);

export default MinimalOutlierShareCard;

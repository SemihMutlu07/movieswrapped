import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import { Heart, User, Star } from 'lucide-react';
import { getTmdbImageUrl } from '@/lib/analytics';
import type { ShareCardData, ShareOrientation } from '../types';
import { useShareLabels } from '../useShareLabels';

type Props = {
  data: ShareCardData;
  className?: string;
  orientation?: ShareOrientation;
};

/* Palette 1 — coolors.co/palette/e63946-f1faee-a8dadc-457b9d-1d3557 */
const RED = '#E63946';
const CREAM = '#F1FAEE';
const SKY = '#A8DADC';
const BLUE = '#457B9D';
const NAVY = '#1D3557';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const normalizeTmdb = (url?: string | null): string | undefined => {
  if (!url) return undefined;
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return getTmdbImageUrl(url) ?? undefined;
  return url;
};

function Portrait({
  label,
  name,
  countLabel,
  imageUrl,
  fallback,
  unknownName,
}: {
  label: string;
  name: string;
  countLabel: string;
  unknownName?: string;
  imageUrl?: string;
  fallback: 'heart' | 'user';
}) {
  const [broken, setBroken] = useState(false);
  const hasImage = imageUrl && !broken;
  return (
    <div className="flex flex-col flex-1 min-w-0">
      <div
        className="uppercase tracking-[0.18em] text-[11px] font-bold mb-2"
        style={{ color: BLUE }}
      >
        {label}
      </div>
      <div
        className="relative overflow-hidden shrink-0"
        style={{ width: '100%', aspectRatio: '2 / 3', borderRadius: 14, background: SKY }}
      >
        {hasImage ? (
          <Image
            src={imageUrl}
            alt={name}
            fill
            className="object-cover object-center"
            priority
            crossOrigin="anonymous"
            onError={() => setBroken(true)}
            sizes="220px"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center" style={{ color: NAVY }}>
            {fallback === 'heart' ? <Heart size={28} /> : <User size={28} />}
          </div>
        )}
      </div>
      <div className="mt-2 text-[17px] font-black leading-tight truncate" style={{ color: NAVY }}>
        {name?.trim() ? name : (unknownName ?? name)}
      </div>
      <div className="text-[11px]" style={{ color: BLUE }}>
        {countLabel}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  unit,
}: {
  label: string;
  value: React.ReactNode;
  unit?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-1 px-4 py-3"
      style={{ background: '#FFFFFF', border: `1px solid ${SKY}`, borderRadius: 14 }}
    >
      <div className="uppercase tracking-[0.14em] text-[10px] font-bold" style={{ color: BLUE }}>
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[26px] font-black leading-none" style={{ color: NAVY }}>
          {value}
        </span>
        {unit && (
          <span className="text-[12px] font-semibold" style={{ color: BLUE }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

const WrappedHeroShareCard = React.forwardRef<HTMLDivElement, Props>(
  function WrappedHeroShareCard({ data, className = '', orientation = 'horizontal' }, ref) {
    const labels = useShareLabels();
    const isVertical = orientation === 'vertical';
    const crushUrl = useMemo(() => normalizeTmdb(data.onScreenCrush.headshotUrl), [data.onScreenCrush.headshotUrl]);
    const directorUrl = useMemo(() => normalizeTmdb(data.favoriteDirector.headshotUrl), [data.favoriteDirector.headshotUrl]);

    const stats = (
      <div className="grid grid-cols-2 gap-3">
        <StatTile label={labels.daysSpent} value={data.spentDays} unit={labels.daysUnit} />
        <StatTile label={labels.scale} value={data.cinemaScale.toFixed(0)} unit={labels.scaleOutOf} />
        <StatTile
          label={labels.topRating}
          value={data.mostCommonRating}
          unit={<Star size={12} fill={RED} stroke={RED} style={{ display: 'inline', marginBottom: -1 }} />}
        />
        <StatTile label={labels.peakDecade} value={data.peakDecade} unit={labels.filmsCount(data.peakDecadeCount)} />
      </div>
    );

    const portraits = (
      <div className="flex gap-4">
        <Portrait
          label={labels.onScreenCrush}
          name={data.onScreenCrush.name}
          countLabel={labels.personFilmsTogether(data.onScreenCrush.count)}
          unknownName={labels.unknown}
          imageUrl={crushUrl}
          fallback="heart"
        />
        <Portrait
          label={labels.favoriteDirector}
          name={data.favoriteDirector.name}
          countLabel={labels.personFilmsDirected(data.favoriteDirector.count)}
          unknownName={labels.directorUnavailable}
          imageUrl={directorUrl}
          fallback="user"
        />
      </div>
    );

    if (isVertical) {
      return (
        <div
          ref={ref}
          data-export-root="true"
          className={cx('w-[675px] h-[1200px] flex flex-col', className)}
          style={{ background: CREAM, fontFamily: 'Avenir Next, Manrope, Segoe UI, system-ui, sans-serif' }}
        >
          <div className="px-10 pt-10 pb-2">
            <div className="uppercase tracking-[0.24em] text-[13px] font-bold" style={{ color: RED }}>
              {labels.yearInFilm}
            </div>
            <h1 className="mt-1 text-[36px] font-black leading-none" style={{ color: NAVY }}>
              {labels.letterboxdWrapped}
            </h1>
          </div>

          <div className="px-10 mt-4">
            <div
              className="text-[132px] font-black leading-none tabular-nums"
              style={{ color: RED }}
            >
              {data.watchedFilms.toLocaleString()}
            </div>
            <div className="uppercase tracking-[0.22em] text-[15px] font-bold mt-1" style={{ color: NAVY }}>
              {labels.filmsWatched}
              {data.username ? (
                <span className="ml-3 font-medium normal-case tracking-normal" style={{ color: BLUE }}>
                  @{data.username}
                </span>
              ) : null}
            </div>
          </div>

          <div className="px-10 mt-8">{stats}</div>

          <div className="px-10 mt-8 flex-1">{portraits}</div>

          <div
            className="text-center text-[11px] font-semibold tracking-[0.12em] uppercase pb-8"
            style={{ color: BLUE }}
          >
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
        style={{ background: CREAM, fontFamily: 'Avenir Next, Manrope, Segoe UI, system-ui, sans-serif' }}
      >
        <div className="col-span-7 flex flex-col justify-between px-10 py-9">
          <div>
            <div className="uppercase tracking-[0.24em] text-[12px] font-bold" style={{ color: RED }}>
              {labels.yearInFilm}
            </div>
            <div
              className="text-[104px] font-black leading-none tabular-nums mt-2"
              style={{ color: RED }}
            >
              {data.watchedFilms.toLocaleString()}
            </div>
            <div className="uppercase tracking-[0.2em] text-[14px] font-bold mt-2" style={{ color: NAVY }}>
              {labels.filmsWatched}
              {data.username ? (
                <span className="ml-3 font-medium normal-case tracking-normal" style={{ color: BLUE }}>
                  @{data.username}
                </span>
              ) : null}
            </div>
          </div>
          {stats}
        </div>
        <div className="col-span-5 flex flex-col justify-center px-8 py-9">
          {portraits}
          <div
            className="text-center text-[10px] font-semibold tracking-[0.12em] uppercase mt-6"
            style={{ color: BLUE }}
          >
            movieswrapped.com
          </div>
        </div>
      </div>
    );
  },
);

export default WrappedHeroShareCard;

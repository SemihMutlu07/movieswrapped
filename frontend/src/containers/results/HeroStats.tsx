'use client';

import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { StatCard, GenreStatCard } from '@/components/results/Cards';

export default function HeroStats({
  username,
  avatarUrl,
  totalFilms,
  avgRating,
  hoursWatched,
  topGenre,
  timePct,
  favoriteDecade,
  onClickFilms,
  onClickAvgRating,
  onClickGenre,
  onClickDecade,
}: {
  username?: string;
  avatarUrl?: string;
  totalFilms: number;
  avgRating?: number | null;
  hoursWatched: number;
  topGenre: string;
  timePct: string;
  favoriteDirector: { name: string; count: number };
  favoriteDecade: { name: string; count: number };
  onClickFilms?: () => void;
  onClickAvgRating?: () => void;
  onClickGenre?: () => void;
  onClickDirector?: () => void;
  onClickDecade?: () => void;
}) {
  const hoursLabel = `${Math.round(Math.max(0, hoursWatched)).toLocaleString()}h`;
  const avgRatingLabel = typeof avgRating === 'number' && Number.isFinite(avgRating)
    ? `${avgRating.toFixed(1)}★`
    : 'N/A';
  const [timeInfoOpen, setTimeInfoOpen] = useState(false);

  return (
    <section className="flex items-center justify-center py-4 md:py-6">
      <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6 max-w-4xl mx-auto w-full">
        {username && (
          <div className="flex items-center justify-center shrink-0 md:h-full">
            <a
              href={`https://letterboxd.com/${username}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col items-center gap-3 transition-transform duration-200 hover:scale-105 active:scale-95"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={`${username}'s Letterboxd avatar`}
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  className="h-24 w-24 md:h-28 md:w-28 rounded-full object-cover ring-2 ring-white/20 transition-all duration-200 group-hover:ring-orange-400 group-active:ring-orange-500"
                />
              ) : (
                <span className="grid h-24 w-24 md:h-28 md:w-28 place-items-center rounded-full bg-slate-700 text-3xl font-bold text-white ring-2 ring-white/20 transition-all duration-200 group-hover:ring-orange-400 group-active:ring-orange-500">
                  {username.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="px-4 py-1.5 rounded-full border border-white/30 text-base md:text-lg font-bold text-white transition-colors duration-200 group-hover:border-orange-400 group-hover:text-orange-400 group-active:border-orange-500 group-active:text-orange-500">
                @{username}
              </span>
            </a>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4 items-stretch flex-1 w-full" style={{ gridAutoRows: '1fr' }}>
          <StatCard value={totalFilms} label="Films" size="large" color="text-white" onClick={onClickFilms} />
          <StatCard value={avgRatingLabel} label="Avg Rating" size="large" color="text-white" onClick={onClickAvgRating} />
          <GenreStatCard value={topGenre} label="Top Genre" onClick={onClickGenre} />

          <button
            type="button"
            onClick={() => setTimeInfoOpen((v) => !v)}
            aria-expanded={timeInfoOpen}
            className="relative text-center rounded-xl p-3 md:p-4 flex flex-col items-center justify-center min-h-[100px] md:min-h-[120px] transition-all duration-200 hover:scale-[1.03] active:scale-[0.98] focus-visible:outline focus-visible:outline-2"
            style={{ backgroundColor: 'rgba(255, 127, 0, 0.1)', borderWidth: 1, borderColor: 'rgba(255, 127, 0, 0.2)', outlineColor: '#ff7f00' }}
          >
            <span className="absolute top-2 right-2 transition-colors" style={{ color: 'rgba(255, 127, 0, 0.6)' }} aria-hidden>
              <Info className="w-4 h-4" />
            </span>
            <div className="text-3xl md:text-4xl font-black mb-2" style={{ color: '#ff7f00' }}>{timePct}</div>
            <div className="text-xs md:text-sm uppercase tracking-wider opacity-80 font-medium" style={{ color: '#ff7f00' }}>
              of your waking time spent on films
            </div>
            {timeInfoOpen && (
              <div
                className="absolute inset-0 z-10 flex items-center rounded-xl backdrop-blur-sm p-3 text-left shadow-2xl cursor-pointer"
                style={{ backgroundColor: 'rgba(30, 37, 45, 0.95)', borderWidth: 1, borderColor: 'rgba(255, 127, 0, 0.3)' }}
              >
                <p className="text-xs md:text-sm leading-snug normal-case tracking-normal font-normal text-white/90">
                  Your film hours divided by ~16 waking hours per day in your Letterboxd activity window. Capped at 100%.
                </p>
              </div>
            )}
          </button>

          <StatCard value={hoursLabel} label="Hours watched" size="large" color="text-white" style={{ color: '#3fbcf3' }} />

          <div
            onClick={onClickDecade}
            className={`text-center rounded-xl p-3 md:p-4 flex flex-col items-center justify-center min-h-[100px] md:min-h-[120px] transition-all duration-200 ${
              onClickDecade ? 'cursor-pointer hover:scale-[1.03] active:scale-[0.98]' : ''
            }`}
            style={{ backgroundColor: '#1b1c1e', borderWidth: 1, borderColor: '#1f262e' }}
          >
            <div className="text-3xl md:text-4xl font-black mb-2 text-white">{favoriteDecade.name}</div>
            <div className="text-xs md:text-sm uppercase tracking-wider opacity-80 font-medium text-white/70">
              {favoriteDecade.count.toLocaleString()} films • Your peak decade
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

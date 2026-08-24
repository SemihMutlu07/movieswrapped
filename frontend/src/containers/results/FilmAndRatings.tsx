'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { X } from 'lucide-react';
import IsolatedModal from '@/components/IsolatedModal';
import Section from '@/components/results/Section';
import { getPosterUrl } from '@/lib/analytics';
import { PosterImage } from '@/components/results/Placeholders';
import FilmModal from '@/containers/results/sections/FilmModal';
import { useI18n } from '@/i18n/I18nProvider';

const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false });
const LineChart = dynamic(() => import('recharts').then(m => m.LineChart), { ssr: false });
const Line = dynamic(() => import('recharts').then(m => m.Line), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(m => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(m => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(m => m.Tooltip), { ssr: false });
const BarChart = dynamic(() => import('recharts').then(m => m.BarChart), { ssr: false });
const Bar = dynamic(() => import('recharts').then(m => m.Bar), { ssr: false });

export function FilmHistory({
  data,
  max,
  isMobile,
  allFilms = [],
  userAvg,
}: {
  data: { decade: string; count: number }[];
  max: number;
  isMobile: boolean;
  allFilms?: RatingSourceFilm[];
  userAvg?: number | null;
}) {
  const { t } = useI18n();
  const primary = '#f97316';
  const [selectedDecade, setSelectedDecade] = useState<DecadeBucket | null>(null);
  const [selectedFilm, setSelectedFilm] = useState<RatingBucketFilm | null>(null);

  const filmsByDecade = useMemo(() => {
    const buckets = new Map<string, RatingBucketFilm[]>();
    allFilms.forEach((film) => {
      if (!film.decade) return;
      const list = buckets.get(film.decade) ?? [];
      list.push({
        title: film.title,
        year: film.year,
        rating: film.rating ?? 0,
        communityRating: film.average_rating ?? 0,
        poster_path: film.poster_path,
        director: film.director,
        runtime: film.runtime,
        language: film.language,
      });
      buckets.set(film.decade, list);
    });
    buckets.forEach((films) => {
      films.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title));
    });
    return buckets;
  }, [allFilms]);

  const handleDecadeSelect = (payload: { decade?: string; count?: number }) => {
    const decade = payload.decade;
    if (!decade) return;
    const films = filmsByDecade.get(decade) ?? [];
    if (films.length === 0) return;
    setSelectedDecade({ decade, films });
  };

  const renderDot = (props: any) => {
    const { cx, cy, payload, key } = props;
    return (
      <circle
        key={key}
        cx={cx}
        cy={cy}
        r={isMobile ? 3 : 4}
        fill={primary}
        stroke="#0f172a"
        strokeWidth={2}
        style={{ cursor: filmsByDecade.has(payload?.decade) ? 'pointer' : undefined }}
        onClick={() => handleDecadeSelect(payload)}
      />
    );
  };

  return (
    <>
      <Section title="Film History" subtitle="Your journey through cinema decades">
        <div className="w-full h-56 md:h-72 lg:h-80 px-2 md:px-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{
                top: 16,
                right: isMobile ? 8 : 24,
                left: isMobile ? 4 : 16,
                bottom: isMobile ? 32 : 48
              }}
            >
              <XAxis
                dataKey="decade"
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: isMobile ? 9 : 11 }}
                angle={isMobile ? -25 : 0}
                textAnchor={isMobile ? 'end' : 'middle'}
                height={isMobile ? 40 : 32}
                tickLine={{ stroke: '#475569' }}
                interval={isMobile ? 1 : 'preserveStartEnd'}
                axisLine={{ stroke: '#475569' }}
                tickMargin={isMobile ? 1 : 4}
              />
              <YAxis
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: isMobile ? 9 : 10 }}
                tickLine={{ stroke: '#475569' }}
                axisLine={{ stroke: '#475569' }}
                domain={[0, Math.ceil(max * 1.1)]}
                allowDecimals={false}
                tickCount={isMobile ? 4 : 5}
                tickMargin={isMobile ? 1 : 4}
                width={isMobile ? 32 : 40}
              />
              <Tooltip
                cursor={{ stroke: primary, strokeWidth: 2, strokeDasharray: '5 5', strokeOpacity: 0.7 }}
                content={({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<{ value?: string | number | readonly (string | number)[] }>; label?: unknown }) =>
                  active && payload?.length ? (
                    <div className="bg-slate-900/95 backdrop-blur-sm p-2 md:p-3 rounded-lg border border-orange-500/40 text-white shadow-2xl">
                      <p className="font-bold text-sm md:text-lg mb-1">{String(label)}</p>
                      <p className="text-orange-400 font-semibold text-xs md:text-sm">{`${payload[0].value} films`}</p>
                      {filmsByDecade.size > 0 && (
                        <p className="text-slate-400 text-[10px] mt-1">{t('results.films.clickPoint')}</p>
                      )}
                    </div>
                  ) : null
                }
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke={primary}
                strokeWidth={isMobile ? 2.5 : 3}
                dot={renderDot}
                activeDot={renderDot}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <DecadeModal
        bucket={selectedDecade}
        onClose={() => setSelectedDecade(null)}
        onSelectFilm={setSelectedFilm}
      />
      <FilmModal
        open={selectedFilm !== null}
        onClose={() => setSelectedFilm(null)}
        film={selectedFilm || { title: '', rating: 0, communityRating: 0 }}
        userAvg={userAvg ?? 0}
      />
    </>
  );
}

export function RatingsBar({
  data,
  max,
  isMobile,
  mostCommonRating,
  allFilms = [],
  userAvg,
}: {
  data: { label: string; count: number }[];
  max: number;
  isMobile: boolean;
  mostCommonRating?: number;
  allFilms?: RatingSourceFilm[];
  userAvg?: number | null;
}) {
  const { t } = useI18n();
  const rating = '#eab308';
  const [selectedBucket, setSelectedBucket] = useState<RatingBucket | null>(null);

  const filmsByRating = useMemo(() => {
    const buckets = new Map<number, RatingBucketFilm[]>();
    allFilms.forEach((film) => {
      if (typeof film.rating !== 'number' || !Number.isFinite(film.rating)) return;
      const ratingKey = Math.round(film.rating * 10) / 10;
      const list = buckets.get(ratingKey) ?? [];
      list.push({
        title: film.title,
        year: film.year,
        rating: film.rating,
        communityRating: film.average_rating ?? 0,
        poster_path: film.poster_path,
        director: film.director,
        runtime: film.runtime,
        language: film.language,
      });
      buckets.set(ratingKey, list);
    });
    buckets.forEach((films) => {
      films.sort((a, b) => {
        if (b.communityRating !== a.communityRating) return b.communityRating - a.communityRating;
        if (b.rating !== a.rating) return b.rating - a.rating;
        return a.title.localeCompare(b.title);
      });
    });
    return buckets;
  }, [allFilms]);

  const handleBucketClick = (entry: { ratingNum?: number; label?: string; count?: number }) => {
    const ratingNum = typeof entry.ratingNum === 'number'
      ? entry.ratingNum
      : Number.parseFloat(String(entry.label ?? '').replace('★', ''));
    if (!Number.isFinite(ratingNum)) return;
    const films = filmsByRating.get(Math.round(ratingNum * 10) / 10) ?? [];
    if (films.length === 0) return;
    setSelectedBucket({
      rating: ratingNum,
      label: entry.label ?? `${ratingNum}★`,
      films,
    });
  };
  return (
    <>
      <Section title="Rating Patterns" subtitle="How you rate films">
        {mostCommonRating != null && (
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-slate-500 font-medium">{t('results.films.mostGivenRating')}</span>
            <span className="text-sm font-black text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-lg px-3 py-1">{mostCommonRating}★</span>
          </div>
        )}
        <div className="w-full h-44 md:h-56 lg:h-64 px-2 md:px-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart 
              data={data} 
              margin={{ 
                top: 12, 
                right: isMobile ? 8 : 20, 
                left: isMobile ? 4 : 12, 
                bottom: isMobile ? 16 : 24 
              }}
            >
              <XAxis 
                dataKey="label" 
                stroke="#9ca3af" 
                tick={{ fill: '#9ca3af', fontSize: isMobile ? 9 : 11 }}
                tickLine={{ stroke: '#64748b' }}
                axisLine={{ stroke: '#64748b' }}
                tickMargin={isMobile ? 2 : 4}
                interval={isMobile ? 1 : 'preserveStartEnd'}
              />
              <YAxis
                stroke="#9ca3af"
                tick={{ fill: '#9ca3af', fontSize: isMobile ? 9 : 10 }}
                domain={[0, Math.ceil(max * 1.1)]}
                allowDecimals={false}
                tickCount={isMobile ? 4 : 5}
                tickMargin={isMobile ? 2 : 4}
                width={isMobile ? 28 : 36}
                tickLine={{ stroke: '#64748b' }}
                axisLine={{ stroke: '#64748b' }}
              />
              <Tooltip
                cursor={{ fill: '#1e293b', opacity: 0.35 }}
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid rgba(234, 179, 8, 0.4)',
                  borderRadius: '0.75rem',
                  color: '#ffffff',
                  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                  fontSize: isMobile ? '12px' : '14px',
                  padding: isMobile ? '8px' : '12px',
                }}
              />
              <Bar 
                dataKey="count" 
                fill={rating} 
                radius={[isMobile ? 2 : 4, isMobile ? 2 : 4, 0, 0]} 
                maxBarSize={isMobile ? 32 : 48}
                onClick={(data) => handleBucketClick(data.payload as { ratingNum?: number; label?: string; count?: number })}
                className={allFilms.length > 0 ? 'cursor-pointer' : undefined}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <RatingBucketModal
        bucket={selectedBucket}
        onClose={() => setSelectedBucket(null)}
      />
    </>
  );
}

type RatingSourceFilm = {
  title: string;
  year?: number;
  rating?: number | null;
  average_rating?: number | null;
  poster_path?: string;
  director?: string;
  runtime?: number;
  language?: string;
  decade?: string;
};

type RatingBucketFilm = {
  title: string;
  year?: number;
  rating: number;
  communityRating: number;
  poster_path?: string;
  director?: string;
  runtime?: number;
  language?: string;
};

type RatingBucket = {
  rating: number;
  label: string;
  films: RatingBucketFilm[];
};

const INITIAL_POSTER_PAGE = 12;

export function RatingBucketModal({
  bucket,
  onClose,
}: {
  bucket: RatingBucket | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [posterPage, setPosterPage] = useState(1);

  useEffect(() => {
    if (!bucket) setPosterPage(1);
  }, [bucket]);

  const visibleCount = posterPage * INITIAL_POSTER_PAGE;
  const visibleFilms = bucket ? bucket.films.slice(0, visibleCount) : [];
  const hasMoreFilms = bucket ? bucket.films.length > visibleFilms.length : false;

  return (
    <IsolatedModal
      open={bucket != null}
      onClose={onClose}
      label={bucket ? `${bucket.label} rating bucket` : undefined}
      panelClassName="max-w-4xl rounded-2xl border border-yellow-400/20 bg-[#161616] shadow-2xl"
    >
      {bucket && (
        <>
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-yellow-300/70">{t('results.films.ratingBucket')}</p>
              <h3 className="mt-1 text-2xl font-black text-white">{bucket.label}</h3>
              <p className="mt-1 text-sm text-slate-400">
                {bucket.films.length} film{bucket.films.length === 1 ? '' : 's'} sorted by community rating
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close rating bucket"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <div data-mw-modal-scroll className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto overscroll-contain p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visibleFilms.map((film) => {
              const poster = getPosterUrl(film.poster_path, 'grid');
              return (
                <div
                  key={`${film.title}-${film.year ?? ''}`}
                  className="min-w-0 text-left"
                >
                  <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10">
                    <PosterImage src={poster} alt={`${film.title} poster`} />
                    <span className="absolute bottom-2 right-2 rounded-full bg-black/80 px-2 py-0.5 text-xs font-bold text-yellow-300">
                      ★ {film.rating.toFixed(1)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs font-semibold leading-tight text-white">{film.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {film.year ?? '—'} · avg ★ {film.communityRating ? film.communityRating.toFixed(1) : '—'}
                  </p>
                </div>
              );
            })}
          </div>
          {hasMoreFilms && (
            <div className="shrink-0 border-t border-white/[0.06] px-5 py-3">
              <button
                type="button"
                onClick={() => setPosterPage((p) => p + 1)}
                className="w-full rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold transition-colors py-2.5"
              >
                Show more films
              </button>
            </div>
          )}
        </>
      )}
    </IsolatedModal>
  );
}

type DecadeBucket = {
  decade: string;
  films: RatingBucketFilm[];
};

function DecadeModal({
  bucket,
  onClose,
  onSelectFilm,
}: {
  bucket: DecadeBucket | null;
  onClose: () => void;
  onSelectFilm: (film: RatingBucketFilm) => void;
}) {
  const [posterPage, setPosterPage] = useState(1);
  useEffect(() => {
    if (!bucket) setPosterPage(1);
  }, [bucket]);
  const visibleCount = posterPage * INITIAL_POSTER_PAGE;
  const visibleFilms = bucket ? bucket.films.slice(0, visibleCount) : [];
  const hasMoreFilms = bucket ? bucket.films.length > visibleFilms.length : false;

  return (
    <IsolatedModal
      open={bucket != null}
      onClose={onClose}
      label={bucket ? `${bucket.decade} films` : undefined}
      panelClassName="max-w-4xl rounded-2xl border border-purple-400/20 bg-[#161616] shadow-2xl"
    >
      {bucket && (
        <>
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-purple-300/70">Decade</p>
              <h3 className="mt-1 text-2xl font-black text-white">{bucket.decade}</h3>
              <p className="mt-1 text-sm text-slate-400">
                {bucket.films.length} film{bucket.films.length === 1 ? '' : 's'} sorted by year
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close decade films"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <div data-mw-modal-scroll className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto overscroll-contain p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visibleFilms.map((film) => {
              const poster = getPosterUrl(film.poster_path, 'grid');
              return (
                <button
                  key={`${film.title}-${film.year ?? ''}`}
                  type="button"
                  onClick={() => onSelectFilm(film)}
                  className="group min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-300"
                >
                  <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10 transition-transform duration-150 group-hover:scale-[1.02] group-hover:ring-purple-300/40">
                    <PosterImage src={poster} alt={`${film.title} poster`} />
                    <span className="absolute bottom-2 right-2 rounded-full bg-black/80 px-2 py-0.5 text-xs font-bold text-purple-300">
                      {film.year ?? '—'}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs font-semibold leading-tight text-white">{film.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {film.rating ? `★ ${film.rating.toFixed(1)}` : 'unrated'}
                  </p>
                </button>
              );
            })}
          </div>
          {hasMoreFilms && (
            <div className="shrink-0 border-t border-white/[0.06] px-5 py-3">
              <button
                type="button"
                onClick={() => setPosterPage((p) => p + 1)}
                className="w-full rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold transition-colors py-2.5"
              >
                Show more films
              </button>
            </div>
          )}
        </>
      )}
    </IsolatedModal>
  );
}

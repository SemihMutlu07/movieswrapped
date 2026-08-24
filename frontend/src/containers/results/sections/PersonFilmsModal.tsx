'use client';

/**
 * PersonFilmsModal — shows the films a director/actor appears in.
 * Opened from the "+" button on a PersonCard in DirectorsGrid / CastGrid.
 */

import React, { useEffect, useMemo, useState } from 'react';
import IsolatedModal from '@/components/IsolatedModal';
import { getTmdbImageUrl } from '@/lib/analytics';
import { PersonAvatarPlaceholder, PosterImage } from '@/components/results/Placeholders';
import { getGenreStyle } from '@/components/results/Cards';
import type { PersonFilm } from './types';

const INITIAL_POSTER_PAGE = 9;

interface PersonFilmsModalProps {
  open: boolean;
  onClose: () => void;
  name: string;
  films: PersonFilm[];
  profilePath?: string;
  profileImageUrl?: string;
  genre?: string;
}

export default function PersonFilmsModal({ open, onClose, name, films, profilePath, profileImageUrl, genre }: PersonFilmsModalProps) {
  const profileUrl = profileImageUrl || (profilePath ? getTmdbImageUrl(profilePath, 'w185') : null);
  const [profileFailed, setProfileFailed] = useState(false);
  const [posterPage, setPosterPage] = useState(1);
  const genreStyle = genre ? getGenreStyle(genre) : null;
  const GenreIcon = genreStyle?.icon;

  useEffect(() => {
    if (open) {
      setProfileFailed(false);
      setPosterPage(1);
    }
  }, [open, profileUrl]);

  const sorted = useMemo(() => {
    return [...films].sort((a, b) => {
      const ra = a.user_rating ?? -1;
      const rb = b.user_rating ?? -1;
      if (rb !== ra) return rb - ra;
      return (b.year ?? '').localeCompare(a.year ?? '');
    });
  }, [films]);
  const visibleCount = posterPage * INITIAL_POSTER_PAGE;
  const visibleFilms = sorted.slice(0, visibleCount);
  const hasMoreFilms = sorted.length > visibleFilms.length;

  return (
    <IsolatedModal
      open={open}
      onClose={onClose}
      label={`${name} film shelf`}
      panelClassName="max-w-2xl bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl"
    >
      <div className="relative min-h-[168px] shrink-0 overflow-hidden border-b border-white/[0.06]">
        {profileUrl && !profileFailed && (
          <div
            className="absolute inset-0 scale-110 bg-cover bg-center opacity-25 blur-md"
            style={{ backgroundImage: `url(${profileUrl})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/90 to-[#141414]/55" />
        <div className="relative z-10 flex h-full items-end justify-between gap-4 px-5 py-5">
          <div className="flex min-w-0 flex-1 items-end gap-4">
            <div
              className={`h-28 w-20 flex-shrink-0 overflow-hidden rounded-2xl ring-1 ring-white/10 shadow-2xl ${
                genreStyle && !(profileUrl && !profileFailed) ? `${genreStyle.bg} ${genreStyle.border} border` : 'bg-slate-800'
              }`}
            >
              {profileUrl && !profileFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profileUrl}
                  alt={name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                  onError={() => setProfileFailed(true)}
                />
              ) : genreStyle && GenreIcon ? (
                <div className="flex h-full w-full items-center justify-center" title={genre} aria-label={genre}>
                  <GenreIcon className={`h-8 w-8 ${genreStyle.text}`} strokeWidth={1.75} />
                </div>
              ) : (
                <PersonAvatarPlaceholder />
              )}
            </div>
            <div className="min-w-0 pb-1">
              <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${genreStyle ? genreStyle.soft : 'text-orange-300/70'}`}>
                Film shelf
              </p>
              <p className="mt-1 text-2xl font-black leading-tight text-white md:text-3xl">{name}</p>
              <p className="mt-1 text-sm text-slate-400">
                {films.length} film{films.length !== 1 ? 's' : ''} you watched
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="mb-auto w-8 h-8 grid place-items-center rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
          >
            ✕
          </button>
        </div>
      </div>

      <div data-mw-modal-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
        {visibleFilms.map((f) => {
          const poster = f.poster_path ? getTmdbImageUrl(f.poster_path, 'w185') : null;
          return (
            <div key={`${f.title}-${f.year}`} className="space-y-1.5">
              <div className={`relative aspect-[2/3] rounded-lg overflow-hidden bg-zinc-800 ring-1 ring-white/10 transition-all duration-150 hover:scale-[1.02] hover:shadow-2xl hover:shadow-black/40 ${genreStyle ? genreStyle.ring : 'hover:ring-orange-400/30'}`}>
                <PosterImage src={poster} alt={`${f.title} poster`} />
                {f.user_rating != null && (
                  <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-bold text-yellow-400">
                    ★ {f.user_rating.toFixed(1)}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300 leading-tight line-clamp-2">
                {f.title}
                {f.year ? <span className="text-slate-500"> ({f.year})</span> : null}
              </p>
            </div>
          );
        })}
        {hasMoreFilms && (
          <button
            type="button"
            onClick={() => setPosterPage((p) => p + 1)}
            className="col-span-full rounded-lg bg-slate-800/70 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Show more films
          </button>
        )}
      </div>
    </IsolatedModal>
  );
}

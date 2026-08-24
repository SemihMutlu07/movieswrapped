'use client';

/**
 * LangModal — shows films in a specific language.
 * Opened from clicking a language row in LanguagesLeaderboard.
 */

import React, { useEffect, useState } from 'react';
import IsolatedModal from '@/components/IsolatedModal';
import { getTmdbImageUrl } from '@/lib/analytics';
import { PosterImage } from '@/components/results/Placeholders';

interface Film {
  title: string;
  year?: number;
  your_rating?: number | null;
  poster_path?: string;
}

const INITIAL_POSTER_PAGE = 12;

interface LangModalProps {
  open: boolean;
  onClose: () => void;
  language: string;
  languageLabel?: string;
  count: number;
  films: Film[];
}

export default function LangModal({ open, onClose, language, languageLabel, count, films }: LangModalProps) {
  const [posterPage, setPosterPage] = useState(1);

  useEffect(() => {
    if (open) setPosterPage(1);
  }, [open]);

  const visibleCount = posterPage * INITIAL_POSTER_PAGE;
  const visibleFilms = films.slice(0, visibleCount);
  const hasMoreFilms = films.length > visibleFilms.length;

  return (
    <IsolatedModal
      open={open}
      onClose={onClose}
      label={`${languageLabel || language} films`}
      panelClassName="max-w-4xl bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl"
    >
      <div className="flex shrink-0 items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Language</p>
          <p className="text-lg font-bold text-white">{languageLabel || language}</p>
          <p className="text-xs text-slate-500 mt-1">
            {count} film{count !== 1 ? 's' : ''} watched
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-8 h-8 grid place-items-center rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
        >
          ✕
        </button>
      </div>

      <div data-mw-modal-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {visibleFilms.map((f, idx) => {
            const poster = f.poster_path ? getTmdbImageUrl(f.poster_path, 'w185') : null;
            return (
              <div
                key={`${f.title}-${idx}`}
                className="group min-w-0"
              >
                <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-zinc-800 ring-1 ring-white/10 transition-all duration-150 group-hover:scale-[1.02] group-hover:ring-orange-400/30">
                  <PosterImage src={poster} alt={`${f.title} poster`} />
                  {f.your_rating != null && (
                    <span className="absolute bottom-2 right-2 rounded-full bg-black/75 px-2 py-0.5 text-xs font-bold text-orange-300">
                      ★ {f.your_rating.toFixed(1)}
                    </span>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-semibold leading-tight text-white">{f.title || '—'}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{f.year || '—'}</p>
              </div>
            );
          })}
        </div>
        {hasMoreFilms && (
          <button
            type="button"
            onClick={() => setPosterPage((p) => p + 1)}
            className="mt-4 w-full rounded-lg bg-slate-800/70 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Show more films
          </button>
        )}
        {count > films.length && (
          <div className="text-xs text-slate-500 italic pt-2">
            + {count - films.length} more in your diary
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/[0.06] px-5 py-3">
        <button
          onClick={onClose}
          className="w-full px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold transition-colors"
        >
          Close
        </button>
      </div>
    </IsolatedModal>
  );
}

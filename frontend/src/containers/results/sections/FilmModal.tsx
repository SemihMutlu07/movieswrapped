'use client';

import React from 'react';
import IsolatedModal from '@/components/IsolatedModal';
import { useI18n } from '@/i18n/I18nProvider';

interface FilmModalProps {
  open: boolean;
  onClose: () => void;
  film: {
    title: string;
    year?: number;
    rating: number;
    communityRating: number;
    director?: string;
    runtime?: number;
    language?: string;
    review_text?: string;
  };
  userAvg: number;
}

export default function FilmModal({ open, onClose, film }: FilmModalProps) {
  const { t } = useI18n();
  const diff = ((film.rating ?? 0) - (film.communityRating ?? 0)).toFixed(1);
  const diffSign = parseFloat(diff) > 0 ? '+' : '';

  return (
    <IsolatedModal
      open={open}
      onClose={onClose}
      label={film.title}
      panelClassName="max-w-md bg-[#1a1a1a] border border-white/8 rounded-2xl shadow-2xl"
    >
      <div data-mw-modal-scroll className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-6">
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white leading-tight">{film.title}</h2>
          <p className="text-sm text-slate-400">
            {film.year || '—'} · {film.director || 'Unknown director'}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800/40 rounded-lg p-3">
            <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Runtime</p>
            <p className="text-sm font-semibold text-white">{film.runtime ? `${film.runtime} min` : '—'}</p>
          </div>
          <div className="bg-slate-800/40 rounded-lg p-3">
            <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Language</p>
            <p className="text-sm font-semibold text-white">{film.language || '—'}</p>
          </div>
          <div className="bg-slate-800/40 rounded-lg p-3">
            <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">{t('results.filmModal.yourRating')}</p>
            <p className="text-sm font-semibold text-orange-400">★ {(film.rating ?? 0).toFixed(1)}</p>
          </div>
        </div>

        <div className="bg-slate-800/40 rounded-lg p-4 border border-white/4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">{t('results.filmModal.communityAvg')}</p>
              <p className="text-2xl font-bold text-white">★ {(film.communityRating ?? 0).toFixed(1)}</p>
            </div>
            <div className="h-12 w-px bg-white/10" />
            <div className="flex-1 text-right">
              <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">vs your avg</p>
              <p className={`text-2xl font-bold ${parseFloat(diff) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {diffSign}{diff}
              </p>
            </div>
          </div>
        </div>

        {film.review_text && (
          <div className="bg-slate-800/20 rounded-lg p-4 border-l-2 border-orange-400">
            <p className="text-sm text-slate-200 italic">"{film.review_text}"</p>
          </div>
        )}
        {!film.review_text && (
          <div className="bg-slate-800/20 rounded-lg p-4 text-center">
            <p className="text-xs text-slate-500 italic">{t('results.filmModal.noReview')}</p>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full mt-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold transition-colors"
        >
          Close
        </button>
      </div>
    </IsolatedModal>
  );
}

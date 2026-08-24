'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { POSTER_GAME_MOVIES, SUGGESTION_ONLY_TITLES, type PosterGameMovie } from '@/lib/posterGameData';
import { isFuzzyMatch } from '@/lib/fuzzyMatch';
import { usePixelatedImage } from '@/lib/usePixelatedImage';
import { useI18n } from '@/i18n/I18nProvider';

const MAX_SUGGESTIONS = 4;

type SuggestionEntry = { title: string; aliases?: string[] };

const SUGGESTION_POOL: SuggestionEntry[] = [
  ...POSTER_GAME_MOVIES,
  ...SUGGESTION_ONLY_TITLES.map((title) => ({ title })),
];

// Matches only at the start of the title or the start of a word within it,
// so a query like "her" matches "Heat" but not mid-word inside "Godfather".
function matchesQuery(text: string, query: string): boolean {
  const normalized = text.toLowerCase();
  if (normalized.startsWith(query)) return true;
  return normalized.split(/[^a-z0-9]+/).some((word) => word.startsWith(query));
}

// Progressively unmasks title letters (left to right) as wrong guesses pile up,
// so the player has fully "spelled out" the title by the last guess before reveal.
function buildHint(title: string, wrongGuesses: number, maxLevel: number): string {
  if (wrongGuesses <= 0) return '';
  const totalLetters = title.split('').filter((c) => /[a-zA-Z0-9]/.test(c)).length;
  const revealCount = Math.min(totalLetters, Math.ceil((wrongGuesses / maxLevel) * totalLetters));
  let revealed = 0;
  return title
    .split('')
    .map((c) => {
      if (!/[a-zA-Z0-9]/.test(c)) return c;
      revealed += 1;
      return revealed <= revealCount ? c : '_';
    })
    .join('');
}

export type PosterGameProps = {
  movie: PosterGameMovie;
  level: number;
  maxLevel: number;
  wrongGuesses: number;
  score: number;
  /** Points the player will earn if their next guess is correct. */
  nextPoints: number;
  onWrongGuess: () => void;
  onCorrectGuess: () => void;
  revealedAnswer: boolean;
};

export function PosterGuessGame({
  movie,
  level,
  maxLevel,
  wrongGuesses,
  score,
  nextPoints,
  onWrongGuess,
  onCorrectGuess,
  revealedAnswer,
}: PosterGameProps) {
  const { t } = useI18n();
  const [guess, setGuess] = useState('');
  const [feedback, setFeedback] = useState<'wrong' | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [justScored, setJustScored] = useState(false);
  const [earnedPoints, setEarnedPoints] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { canvasRef, loaded, error } = usePixelatedImage(movie.poster_path, level, maxLevel, revealedAnswer);
  const hint = useMemo(
    () => buildHint(movie.title, wrongGuesses, maxLevel),
    [movie.title, wrongGuesses, maxLevel],
  );

  useEffect(() => {
    setGuess('');
    setFeedback(null);
    setSuggestionsOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, [movie]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const keepInputVisible = () => {
      if (document.activeElement === inputRef.current) {
        if (typeof inputRef.current?.scrollIntoView === 'function') {
          inputRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    };
    viewport.addEventListener('resize', keepInputVisible);
    return () => viewport.removeEventListener('resize', keepInputVisible);
  }, []);

  const suggestions = useMemo(() => {
    const query = guess.trim().toLowerCase();
    if (query.length < 1) return [];
    return SUGGESTION_POOL.filter((m) => {
      const titles = [m.title, ...(m.aliases ?? [])];
      return titles.some((t) => matchesQuery(t, query));
    }).slice(0, MAX_SUGGESTIONS);
  }, [guess]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [suggestions]);

  function submitGuess(value: string) {
    if (revealedAnswer || !value.trim()) return;

    if (isFuzzyMatch(value, movie.title, movie.aliases)) {
      setFeedback(null);
      setSuggestionsOpen(false);
      setEarnedPoints(nextPoints);
      setJustScored(true);
      setTimeout(() => setJustScored(false), 1100);
      onCorrectGuess();
    } else {
      setFeedback('wrong');
      onWrongGuess();
      setGuess('');
      setSuggestionsOpen(false);
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (suggestionsOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
      submitGuess(suggestions[highlightedIndex].title);
    } else {
      submitGuess(guess);
    }
  }

  function handleSuggestionClick(title: string) {
    submitGuess(title);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestionsOpen || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = highlightedIndex < suggestions.length - 1 ? highlightedIndex + 1 : 0;
      setHighlightedIndex(nextIndex);
      setGuess(suggestions[nextIndex].title);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIndex = highlightedIndex > 0 ? highlightedIndex - 1 : suggestions.length - 1;
      setHighlightedIndex(nextIndex);
      setGuess(suggestions[nextIndex].title);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSuggestionsOpen(false);
      setHighlightedIndex(-1);
    }
  }

  return (
    <div className="min-w-0 max-w-full rounded-2xl border border-orange-400/30 bg-orange-500/10 p-4">
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs uppercase tracking-wide text-orange-300/80">
        <span className="min-w-0 text-left break-words">{t('landing.poster.title')}</span>
        <span className="relative inline-block shrink-0">
          <span
            className={`inline-block ${justScored ? 'animate-[score-pop_1.1s_ease-out]' : ''}`}
          >
            {t('landing.poster.score').replace('{score}', String(score))}
          </span>
          {justScored && (
            <span
              className={`pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap font-bold animate-[float-up-fade_1.1s_ease-out] ${
                earnedPoints >= 100
                  ? 'text-2xl text-amber-300 drop-shadow-[0_0_6px_rgba(252,211,77,0.7)]'
                  : 'text-base text-orange-300'
              }`}
            >
              {earnedPoints >= 100
                ? t('landing.poster.perfect').replace('{points}', String(earnedPoints))
                : t('landing.poster.points').replace('{points}', String(earnedPoints))}
            </span>
          )}
        </span>
      </div>

      <div className="mb-4 flex justify-center">
        <div className="relative aspect-[2/3] w-[min(160px,100%)] overflow-hidden rounded-lg border border-slate-600 bg-slate-900/60 sm:w-[min(220px,100%)]">
          {!error && (
            <canvas
              ref={canvasRef}
              className="h-full w-full"
              style={{ imageRendering: 'pixelated' }}
            />
          )}
          {!loaded && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
              {t('landing.poster.loading')}
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-sm text-slate-400">
              {t('landing.poster.unavailable')}
            </div>
          )}
        </div>
      </div>

      {revealedAnswer ? (
        <p className="text-center text-sm font-medium text-orange-200">
          {movie.title}
        </p>
      ) : (
        <div className="relative min-w-0">
          <form onSubmit={handleSubmit} className="flex min-w-0 gap-2">
            <input
              ref={inputRef}
              id="film-guess"
              type="text"
              value={guess}
              onChange={(e) => {
                setGuess(e.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={(event) => {
                setSuggestionsOpen(true);
                const input = event.currentTarget;
                requestAnimationFrame(() => {
                  if (typeof input.scrollIntoView === 'function') {
                    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  }
                });
              }}
              onBlur={() => setTimeout(() => setSuggestionsOpen(false), 100)}
              onKeyDown={handleInputKeyDown}
              placeholder={t('landing.poster.placeholder')}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestionsOpen && suggestions.length > 0}
              aria-controls="film-guess-options"
              aria-activedescendant={highlightedIndex >= 0 ? `film-guess-option-${highlightedIndex}` : undefined}
              className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-base text-slate-100 placeholder:text-slate-500 focus:border-orange-400 focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 whitespace-nowrap rounded-lg bg-orange-500/90 px-3 py-2 text-sm font-medium text-white transition hover:bg-orange-500 sm:px-4"
            >
              {t('landing.poster.guess')}
            </button>
          </form>

          {/* Opens above the input on phones so the on-screen keyboard can't cover it. */}
          {suggestionsOpen && suggestions.length > 0 && (
            <ul id="film-guess-options" role="listbox" className="absolute left-0 right-0 bottom-full mb-1 sm:bottom-auto sm:mb-0 sm:top-full sm:mt-1 z-10 max-h-48 overflow-y-auto rounded-lg border border-slate-600 bg-slate-800 shadow-lg shadow-black/30">
              {suggestions.map((m, index) => (
                <li
                  id={`film-guess-option-${index}`}
                  key={m.title}
                  role="option"
                  aria-selected={index === highlightedIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSuggestionClick(m.title)}
                  className={`cursor-pointer px-3 py-2.5 sm:py-2 text-left text-sm text-slate-100 hover:bg-orange-500/20 ${
                    index === highlightedIndex ? 'bg-orange-500/20' : ''
                  }`}
                >
                  {m.title}
                </li>
              ))}
              <li aria-hidden="true" className="hidden select-none border-t border-slate-700 px-3 py-1.5 text-[11px] text-slate-500 sm:block">
                {t('landing.poster.keyboardHelp')}
              </li>
            </ul>
          )}
        </div>
      )}

      {feedback === 'wrong' && !revealedAnswer && (
        <div className="mt-2 text-center">
          <p className="text-xs text-orange-300/80">{t('landing.poster.wrong')}</p>
          {hint && (
            <p className="mt-1 max-w-full break-words font-mono text-sm tracking-widest text-orange-200/90">{hint}</p>
          )}
        </div>
      )}
    </div>
  );
}

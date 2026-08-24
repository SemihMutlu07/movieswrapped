'use client';

import React, { useMemo, useState } from 'react';
import Section from '@/components/results/Section';
import { getPosterUrl } from '@/lib/analytics';
import { PosterImage } from '@/components/results/Placeholders';
import type { StatsData, ReviewLiker } from './types';
import { useI18n } from '@/i18n/I18nProvider';
import {
  compareReviewsByCharLength,
  compareReviewsByLikes,
  hasReadableReviewText,
  reviewCharLength,
  reviewWordCount,
  selectLongestReview,
} from '@/lib/reviews';


/** "1 word" / "5 words", or a plain tag for near-empty reviews so a "1 words" count
 * doesn't read like a broken label. */
function wordCountLabel(count: number): string | null {
  if (count <= 0) return null;
  if (count < 3) return 'short review';
  return `${count} word${count === 1 ? '' : 's'}`;
}

type Props = { stats: StatsData };
type ReviewSort = 'likes' | 'length' | 'gems';

/** A substantial review that has not received a public like yet. */
const GEM_MIN_WORDS = 40;

const WORD_PALETTE = [
  'bg-orange-500/25 text-orange-200',
  'bg-emerald-500/20 text-emerald-200',
  'bg-sky-500/20 text-sky-200',
  'bg-fuchsia-500/20 text-fuchsia-200',
  'bg-amber-500/20 text-amber-200',
  'bg-rose-500/20 text-rose-200',
];

const INITIAL_REVIEW_PAGE = 3;

function scaledWordSize(count: number, max: number): string {
  if (max <= 0) return 'text-sm';
  const ratio = count / max;
  if (ratio > 0.85) return 'text-2xl font-black';
  if (ratio > 0.6) return 'text-xl font-bold';
  if (ratio > 0.35) return 'text-lg font-semibold';
  if (ratio > 0.15) return 'text-base font-medium';
  return 'text-sm font-medium';
}

export default function ReviewAnalysisSection({ stats }: Props) {
  const { t } = useI18n();
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [reviewSort, setReviewSort] = useState<ReviewSort>('likes');
  const [reviewPage, setReviewPage] = useState(1);

  const ra = stats.review_analysis;

  const topWords = useMemo(() => (ra?.word_frequency ?? []).slice(0, 12), [ra?.word_frequency]);
  const topWordsMax = topWords[0]?.count ?? 0;
  const avgWords = Math.round(ra?.avg_review_length_words ?? 0);
  const topLiked = useMemo(
    () => (ra?.top_liked_reviews ?? []).filter((r) => r.like_count > 0).slice(0, 3),
    [ra?.top_liked_reviews]
  );
  const totalLikes = ra?.total_review_likes ?? null;
  const allReviews = useMemo(() => ra?.reviews ?? [], [ra?.reviews]);
  const writtenReviews = useMemo(
    () => allReviews.filter(hasReadableReviewText),
    [allReviews],
  );
  const hiddenLinkOnlyCount = allReviews.length - writtenReviews.length;
  const longestReview = useMemo(() => {
    if (ra?.longest_review?.title) {
      return {
        ...ra.longest_review,
        unit: ra.longest_review.unit ?? ('characters' as const),
      };
    }
    const longest = selectLongestReview(writtenReviews);
    if (longest) {
      return {
        title: longest.title,
        year: longest.year,
        length: reviewCharLength(longest),
        unit: 'characters' as const,
      };
    }
    return null;
  }, [writtenReviews, ra?.longest_review]);

  // Most loyal fan: whoever liked the most of the user's distinct reviews.
  const mostLoyalFan = useMemo(() => {
    const counts = new Map<string, { liker: ReviewLiker; count: number }>();
    for (const review of allReviews) {
      for (const liker of review.likers ?? []) {
        const entry = counts.get(liker.username);
        if (entry) entry.count += 1;
        else counts.set(liker.username, { liker, count: 1 });
      }
    }
    let best: { liker: ReviewLiker; count: number } | null = null;
    for (const entry of counts.values()) {
      if (!best || entry.count > best.count) best = entry;
    }
    return best && best.count >= 2 ? best : null;
  }, [allReviews]);
  const sortedReviews = useMemo(() => {
    return [...writtenReviews].sort((a, b) => {
      if (reviewSort === 'gems') {
        const aIsGem = (a.likes ?? 0) === 0 && reviewWordCount(a) >= GEM_MIN_WORDS;
        const bIsGem = (b.likes ?? 0) === 0 && reviewWordCount(b) >= GEM_MIN_WORDS;
        if (aIsGem !== bIsGem) return bIsGem ? 1 : -1;
        return compareReviewsByCharLength(a, b);
      }
      if (reviewSort === 'likes') return compareReviewsByLikes(a, b);
      return compareReviewsByCharLength(a, b);
    });
  }, [writtenReviews, reviewSort]);
  const filteredReviews = useMemo(() => {
    if (!selectedWord) return [];
    return allReviews.filter((r) => r.text?.toLowerCase().includes(selectedWord.toLowerCase()));
  }, [allReviews, selectedWord]);

  const visibleReviewCount = reviewPage * INITIAL_REVIEW_PAGE;
  const paginatedSortedReviews = sortedReviews.slice(0, visibleReviewCount);
  const hasMoreReviews = sortedReviews.length > paginatedSortedReviews.length;
  const subtitleParts = ra ? [`${ra.reviews_with_text} reviews with text`] : [];
  if (totalLikes !== null && totalLikes > 0) {
    subtitleParts.push(`${totalLikes} total likes`);
  }

  if (!ra || ra.reviews_with_text === 0) return null;

  return (
    <Section title="Your Reviews" subtitle={subtitleParts.join(' · ')}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 items-stretch w-full">
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3 sm:p-4 min-w-0">
          <p className="text-2xl sm:text-3xl font-bold text-orange-400 tabular-nums">{ra.reviews_with_text}</p>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">written review</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3 sm:p-4 min-w-0">
          <p className="text-2xl sm:text-3xl font-bold text-orange-400 tabular-nums">{avgWords}</p>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">avg word per review</p>
        </div>

        {totalLikes !== null && totalLikes > 0 && (
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3 sm:p-4 min-w-0">
            <p className="text-2xl sm:text-3xl font-bold text-orange-400 tabular-nums">{totalLikes}</p>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">total likes on your reviews</p>
          </div>
        )}

        {longestReview && (
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3 sm:p-4 min-w-0">
            <p className="text-2xl sm:text-3xl font-bold text-orange-400 tabular-nums">{longestReview.length}</p>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">{longestReview.unit} on your longest review</p>
            <p className="mt-2 text-xs text-slate-400 truncate">
              {longestReview.title}{longestReview.year ? ` (${longestReview.year})` : ''}
            </p>
          </div>
        )}
      </div>

      {mostLoyalFan && (
        <div className="mt-3 w-full rounded-xl border border-orange-400/40 bg-gradient-to-r from-orange-500/15 via-slate-800/60 to-slate-800/40 p-4 sm:p-5 flex items-center justify-between gap-4 shadow-[0_0_24px_-8px_rgba(251,146,60,0.35)]">
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative shrink-0">
              <LikerAvatar liker={mostLoyalFan.liker} size="lg" />
              <span
                aria-hidden="true"
                className="absolute -top-2 -right-2 text-lg drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
              >
                👑
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest text-orange-300">
                Your Most Loyal Fan
              </p>
              <p className="text-base sm:text-lg font-bold text-white truncate">
                {mostLoyalFan.liker.display_name || mostLoyalFan.liker.username}
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-3xl sm:text-4xl font-black text-orange-300 tabular-nums leading-none">
              {mostLoyalFan.count}
            </p>
            <p className="mt-1 text-xs text-slate-400 whitespace-nowrap">reviews liked</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-start mt-4 w-full">

        {topWords.length > 0 && (
          <div className="w-full">
            <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">Most used words · tap to filter</p>
            <div className="flex flex-wrap gap-x-3 gap-y-2 items-baseline">
              {topWords.map(({ word, count }, idx) => {
                const isSelected = selectedWord === word;
                return (
                  <button
                    key={word}
                    onClick={() => setSelectedWord(isSelected ? null : word)}
                    className={`inline-flex items-baseline gap-1.5 rounded-full px-3 py-1 transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? 'ring-2 ring-orange-400 bg-orange-500/40 text-orange-100 font-bold'
                        : `${WORD_PALETTE[idx % WORD_PALETTE.length]} hover:opacity-80`
                    } ${scaledWordSize(count, topWordsMax)}`}
                  >
                    <span>{word}</span>
                    <span className="text-xs font-mono opacity-70">×{count}</span>
                  </button>
                );
              })}
            </div>
            
          </div>
        )}

        {selectedWord && filteredReviews.length > 0 && (
          <div className="w-full mt-4">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-orange-500/20 px-4 py-3 mb-3">
              <p className="text-sm font-semibold text-orange-200">
                Filtering: "<span className="font-mono">{selectedWord}</span>" · {filteredReviews.length} review{filteredReviews.length === 1 ? '' : 's'}
              </p>
              <button
                onClick={() => setSelectedWord(null)}
                className="text-xs font-bold px-3 py-1 rounded-full bg-orange-400 text-slate-900 hover:bg-orange-300 transition-colors"
              >
                Clear
              </button>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredReviews.slice(0, 6).map((review, idx) => (
                <FilteredReviewCard key={`${review.title}-${review.year}-${idx}`} review={review} />
              ))}
            </ul>
            {filteredReviews.length > 6 && (
              <p className="mt-2 text-xs text-slate-300">
                Showing 6 of {filteredReviews.length} reviews
              </p>
            )}
          </div>
        )}

        {selectedWord && filteredReviews.length === 0 && (
          <div className="w-full mt-4 text-center py-4">
            <p className="text-sm text-slate-400">
              No reviews found containing "<span className="font-mono">{selectedWord}</span>"
            </p>
            <button
              onClick={() => setSelectedWord(null)}
              className="mt-2 text-xs font-bold px-3 py-1 rounded-full bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
            >
              Clear filter
            </button>
          </div>
        )}

        {topLiked.length > 0 && (
          <details className="group w-full rounded-xl bg-slate-800/40 open:bg-slate-800/60">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 transition-colors duration-150 ease-out hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400">
              <div className="flex items-baseline gap-3">
                <p className="text-xs uppercase tracking-widest text-orange-300">Top 3 most-liked reviews</p>
                <p className="text-xs text-slate-300">tap to expand</p>
              </div>
              <svg
                aria-hidden="true"
                viewBox="0 0 12 12"
                width="14"
                height="14"
                className="shrink-0 text-slate-400 transition-transform duration-150 ease-out group-open:rotate-180"
              >
                <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <ul className="grid gap-3 px-4 pb-4 pt-2 sm:grid-cols-2">
              {topLiked.map((review) => {
                const slug = review.slug?.replace(/^\/film\/|\/$/g, '');
                const href = slug && stats.scraped_username
                  ? `https://letterboxd.com/${stats.scraped_username}/film/${slug}/`
                  : slug
                  ? `https://letterboxd.com/film/${slug}/`
                  : null;
                return (
                  <li key={`${review.title}-${review.year}-${review.slug ?? ''}`}>
                    <article className="flex h-full gap-3 rounded-xl bg-slate-900/60 p-3 transition-colors duration-150 ease-out hover:bg-slate-900/90">
                      <ReviewPoster posterPath={review.poster_path} title={review.title} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <header className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block truncate font-semibold text-slate-100 hover:text-orange-200"
                              >
                                {review.title}
                              </a>
                            ) : (
                              <p className="truncate font-semibold text-slate-100">{review.title}</p>
                            )}
                            <p className="text-xs text-slate-500">
                              {review.year || '—'}
                              {review.rating != null ? ` · ★ ${review.rating.toFixed(1)}` : ''}
                              {review.review_date ? ` · ${review.review_date.slice(0, 10)}` : ''}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-bold text-orange-300">
                            ♥ {review.like_count}
                          </span>
                        </header>
                        {review.text_preview && (
                          <p className="mt-1.5 line-clamp-3 text-sm text-slate-300">{review.text_preview}</p>
                        )}
                        <div className="mt-auto pt-2">
                          <LikerRow
                            likeCount={review.like_count}
                            likers={review.likers}
                            complete={review.likers_complete}
                          />
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          </details>
        )}

        {sortedReviews.length > 0 && (
          <div className="w-full rounded-xl bg-slate-800/35 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-widest text-orange-300">{t('results.reviews.all')}</p>
                <p className="mt-1 text-xs text-slate-300">
                  Sort without extra scraping — likes come from the review listing page.
                  {hiddenLinkOnlyCount > 0
                    ? ` ${hiddenLinkOnlyCount} link-only review${hiddenLinkOnlyCount === 1 ? '' : 's'} hidden.`
                    : ''}
                </p>
              </div>
              <div className="grid w-full grid-cols-3 rounded-xl border border-slate-700/60 bg-slate-900/60 p-0.5 sm:flex sm:w-auto sm:rounded-full">
                <ReviewSortButton
                  active={reviewSort === 'likes'}
                  onClick={() => { setReviewSort('likes'); setReviewPage(1); }}
                >
                  Most liked
                </ReviewSortButton>
                <ReviewSortButton
                  active={reviewSort === 'length'}
                  onClick={() => { setReviewSort('length'); setReviewPage(1); }}
                >
                  Longest
                </ReviewSortButton>
                <ReviewSortButton
                  active={reviewSort === 'gems'}
                  onClick={() => { setReviewSort('gems'); setReviewPage(1); }}
                >
                  Hidden gems
                </ReviewSortButton>
              </div>
            </div>
            <ul className="mt-4 grid grid-cols-1 gap-3">
              {paginatedSortedReviews.map((review, idx) => (
                <FullReviewCard key={`${review.title}-${review.year}-${idx}`} review={review} />
              ))}
            </ul>
            {hasMoreReviews && (
              <button
                type="button"
                onClick={() => setReviewPage((p) => p + 1)}
                className="mt-4 w-full rounded-lg bg-slate-800/70 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Show more reviews
              </button>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

type ReviewItem = NonNullable<NonNullable<StatsData['review_analysis']>['reviews']>[number];

/** Small poster to the left of a review card; falls back to a placeholder. */
function ReviewPoster({ posterPath, title }: { posterPath?: string; title: string }) {
  const url = posterPath ? getPosterUrl(posterPath, 'grid') : null;
  return (
    <div className="w-14 shrink-0 sm:w-16">
      <div className="aspect-[2/3] overflow-hidden rounded-lg ring-1 ring-white/10">
        <PosterImage src={url} alt={`${title} poster`} />
      </div>
    </div>
  );
}

/** One liker's avatar (image if on the Letterboxd CDN, else initials). */
function LikerAvatar({ liker, size = 'sm' }: { liker: ReviewLiker; size?: 'sm' | 'lg' }) {
  const label = liker.display_name || liker.username;
  const dims = size === 'lg' ? 'h-12 w-12 sm:h-14 sm:w-14' : 'h-6 w-6';
  const textSize = size === 'lg' ? 'text-base sm:text-lg' : 'text-[9px]';
  const ring = size === 'lg' ? 'ring-2 ring-orange-400/60' : 'ring-2 ring-slate-900';
  if (liker.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={liker.avatar_url}
        alt={label}
        title={label}
        loading="lazy"
        className={`${dims} rounded-full object-cover ${ring}`}
      />
    );
  }
  return (
    <span
      title={label}
      className={`grid ${dims} place-items-center rounded-full bg-slate-700 ${textSize} font-bold text-slate-200 ${ring}`}
    >
      {(label || '?').charAt(0).toUpperCase()}
    </span>
  );
}

/** Liker summary for a review: avatars + expandable name list.
 * Zero likes → "Not yet liked". Likes but no crawled identities →
 * "♥ N · names unavailable" when the crawl was partial. */
function LikerRow({
  likeCount,
  likers,
  complete,
}: {
  likeCount: number;
  likers?: ReviewLiker[];
  complete?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (likeCount <= 0) {
    return <span className="text-xs text-slate-500">{t('results.reviews.notLiked')}</span>;
  }

  const list = likers ?? [];
  if (list.length === 0) {
    return (
      <span className="text-xs text-slate-400">
        ♥ {likeCount}
        {complete === false ? ' · names unavailable' : ''}
      </span>
    );
  }

  const preview = list.slice(0, 5);
  const extra = likeCount - preview.length;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group/likers flex items-center gap-2 text-left"
      >
        <span className="flex -space-x-2">
          {preview.map((l) => (
            <LikerAvatar key={l.username} liker={l} />
          ))}
        </span>
        <span className="text-xs font-medium text-slate-400 transition-colors group-hover/likers:text-slate-200">
          {extra > 0 ? `+${extra} · ` : ''}Liked by {open ? '↑' : '↓'}
        </span>
      </button>
      {open && (
        <ul className="flex flex-wrap gap-x-2 gap-y-0.5">
          {list.map((l) => (
            <li key={l.username}>
              <a
                href={`https://letterboxd.com/${l.username}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-orange-300 hover:text-orange-200"
              >
                {l.display_name || l.username}
              </a>
            </li>
          ))}
          {complete === false && (
            <li className="text-xs text-slate-500">· some names unavailable</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** A single word-filtered review. Long text collapses to 3 lines with a Read more toggle. */
function FilteredReviewCard({ review }: { review: ReviewItem }) {
  const [expanded, setExpanded] = useState(false);
  const text = review.text ?? '';
  // ponytail: char-length proxy for "needs a toggle"; line-clamp-3 ≈ ~200 chars
  const isLong = text.length > 200;

  return (
    <li className="rounded-lg bg-slate-800/50 p-3 hover:bg-slate-800/80 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="font-semibold text-orange-100 text-sm truncate">{review.title}</p>
        <span className="shrink-0 text-xs font-mono text-slate-400">♥ {review.likes || 0}</span>
      </div>
      <p className="text-xs text-slate-400 mb-2">{review.year || '—'}</p>
      <p className={`text-xs text-slate-300 leading-relaxed ${expanded ? 'whitespace-pre-line' : 'line-clamp-3'}`}>
        {text}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-xs font-bold text-orange-300 hover:text-orange-200 transition-colors"
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </li>
  );
}

function ReviewSortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
        active
          ? 'bg-orange-400 text-slate-950'
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function FullReviewCard({ review }: { review: ReviewItem }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const text = review.text ?? '';
  const likes = review.likes ?? 0;
  const wordCount = reviewWordCount(review);
  const wordLabel = wordCountLabel(wordCount);
  const isLong = text.length > 260;
  const href = review.review_path ? `https://letterboxd.com${review.review_path}` : null;

  const Wrapper = href ? 'a' : 'div';

  return (
    <li>
      <Wrapper
        {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {})}
        className={`flex gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-4 transition-colors duration-150 ${
          href ? 'cursor-pointer hover:border-orange-400/30 hover:bg-slate-900/90' : 'hover:bg-slate-900/80'
        }`}
      >
        <ReviewPoster posterPath={review.poster_path} title={review.title} />
        <div className="min-w-0 flex-1">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={`truncate text-sm font-semibold text-slate-100 ${href ? 'transition-colors duration-150 group-hover:text-orange-200' : ''}`}>
                {review.title}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {review.year || '—'}
                {review.rating != null ? ` · ★ ${review.rating.toFixed(1)}` : ''}
                {wordLabel ? ` · ${wordLabel}` : ''}
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
              likes > 0 ? 'bg-orange-500/20 text-orange-300' : 'bg-slate-800 text-slate-400'
            }`}>
              {likes > 0 ? `♥ ${likes}` : t('results.reviews.notLiked')}
            </span>
          </header>
          <p className={`mt-3 text-sm leading-relaxed text-slate-200 ${expanded ? 'whitespace-pre-line' : 'line-clamp-4'}`}>
            {text}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="relative z-10 mt-2 text-xs font-bold text-orange-300 transition-colors hover:text-orange-200"
            >
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      </Wrapper>
    </li>
  );
}

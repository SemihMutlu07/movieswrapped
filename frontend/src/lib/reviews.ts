export type ReviewTextMetrics = {
  title?: string | null;
  year?: string | number | null;
  date?: string | null;
  likes?: number | null;
  text?: string | null;
  text_length?: number | null;
  char_length?: number | null;
  word_count?: number | null;
  normalized_text?: string | null;
  review_path?: string | null;
};

export type LongestReviewSummary = {
  title: string;
  year?: string | number | null;
  length: number;
  unit?: string;
};

const URL_RE = /(?:https?:\/\/|www\.)\S+/giu;
const HTML_TAG_RE = /<[^>]+>/g;
const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function readableText(text: string): string {
  return text.replace(URL_RE, ' ').replace(HTML_TAG_RE, ' ').trim();
}

function titleKey(title: unknown): string {
  return String(title ?? '').normalize('NFC').trim().toLocaleLowerCase();
}

function compareText(a: unknown, b: unknown): number {
  const left = String(a ?? '').normalize('NFC');
  const right = String(b ?? '').normalize('NFC');
  return left < right ? -1 : left > right ? 1 : 0;
}

function readableForSort(review: ReviewTextMetrics): string {
  if (review.normalized_text) return String(review.normalized_text);
  if (review.text != null) return readableText(review.text);
  return '';
}

/** Mirrors backend `_review_sort_key` tie-breaking after character length. */
export function compareReviewsByCharLength(
  a: ReviewTextMetrics,
  b: ReviewTextMetrics,
): number {
  return reviewCharLength(b) - reviewCharLength(a)
    || compareText(titleKey(a.title), titleKey(b.title))
    || compareText(a.year, b.year)
    || compareText(readableForSort(a), readableForSort(b))
    || compareText(a.review_path ?? a.date, b.review_path ?? b.date);
}

export function reviewCharLength(review: ReviewTextMetrics): number {
  if (review.text != null) {
    return readableText(review.text).replace(/\s+/g, ' ').trim().length;
  }
  return review.char_length ?? review.text_length ?? 0;
}

export function reviewWordCount(review: ReviewTextMetrics): number {
  if (review.text != null && review.text !== '') {
    return readableText(review.text).match(WORD_RE)?.length ?? 0;
  }
  return review.word_count ?? 0;
}

export function hasReadableReviewText(review: ReviewTextMetrics): boolean {
  if (review.normalized_text) return review.normalized_text.trim().length > 0;
  return review.text != null && readableText(review.text).length > 0;
}

export function compareReviewsByWordCount(
  a: ReviewTextMetrics,
  b: ReviewTextMetrics,
): number {
  return reviewWordCount(b) - reviewWordCount(a)
    || compareText(titleKey(a.title), titleKey(b.title))
    || compareText(a.year, b.year)
    || compareText(readableForSort(a), readableForSort(b))
    || compareText(a.review_path ?? a.date, b.review_path ?? b.date);
}

export function compareReviewsByLikes(
  a: ReviewTextMetrics,
  b: ReviewTextMetrics,
): number {
  return (b.likes ?? 0) - (a.likes ?? 0)
    || compareReviewsByCharLength(a, b);
}

export function selectLongestReview<T extends ReviewTextMetrics>(
  reviews: readonly T[],
): T | undefined {
  return reviews
    .filter(hasReadableReviewText)
    .slice()
    .sort(compareReviewsByCharLength)[0];
}

export function findReviewForSummary<T extends ReviewTextMetrics>(
  reviews: readonly T[],
  summary: Pick<LongestReviewSummary, 'title' | 'year'>,
): T | undefined {
  const targetTitle = titleKey(summary.title);
  const targetYear = String(summary.year ?? '');
  return reviews.find(
    (review) => titleKey(review.title) === targetTitle && String(review.year ?? '') === targetYear,
  );
}

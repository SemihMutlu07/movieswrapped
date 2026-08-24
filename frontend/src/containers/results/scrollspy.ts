import type { MessageKey } from '@/i18n/catalogs';

export const SCROLLSPY_LABEL_KEYS: Record<string, MessageKey> = {
  hero: 'results.spy.hero',
  people: 'results.spy.people',
  'cinema-scale': 'results.spy.cinemaScale',
  'rating-deviation': 'results.spy.ratingDeviation',
  reviews: 'results.spy.reviews',
  'film-history': 'results.spy.filmHistory',
  'ratings-bar': 'results.spy.ratings',
  'rewatch-champions': 'results.spy.rewatch',
  languages: 'results.spy.languages',
  'share-footer': 'results.spy.share',
};

export function scrollspyLabelKey(id: string): MessageKey {
  return SCROLLSPY_LABEL_KEYS[id] ?? 'results.spy.hero';
}

export const SCROLLSPY_SLOT_PX = 36;
export const SCROLLSPY_THUMB_PX = 28;

/** Last section whose top edge has crossed the spy line (viewport Y). */
export function pickActiveSectionId(
  sections: ReadonlyArray<{ id: string; top: number }>,
  spyY: number,
): string | null {
  if (sections.length === 0) return null;
  let active = sections[0].id;
  for (const section of sections) {
    if (section.top <= spyY) active = section.id;
    else break;
  }
  return active;
}

/** Fractional rail index: 0 at the first section, n-1 at the last, lerped between. */
export function scrollProgressIndex(
  sections: ReadonlyArray<{ id: string; top: number }>,
  spyY: number,
): number {
  if (sections.length <= 1) return 0;
  const last = sections.length - 1;
  if (spyY <= sections[0].top) return 0;
  if (spyY >= sections[last].top) return last;
  for (let i = 0; i < last; i += 1) {
    const start = sections[i].top;
    const end = sections[i + 1].top;
    if (spyY <= end) {
      const span = end - start;
      if (span <= 0) return i;
      return i + (spyY - start) / span;
    }
  }
  return last;
}

export function thumbOffsetPx(
  index: number,
  slot = SCROLLSPY_SLOT_PX,
  thumb = SCROLLSPY_THUMB_PX,
): number {
  return index * slot + (slot - thumb) / 2;
}

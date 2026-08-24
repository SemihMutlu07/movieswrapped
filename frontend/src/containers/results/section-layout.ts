/**
 * Results layout contracts. Item counts are decided here, before render —
 * never by CSS wrapping or hiding a leftover card.
 *
 * Compact = below Tailwind `sm` (640px): 2-column people / outlier grids.
 * Expanded = sm and up: existing desktop composition.
 */
export const COMPACT_LAYOUT_MAX_PX = 639;

export const SECTION_ITEM_CONTRACT = {
  directors: { compact: 4, expanded: 5 },
  cast: { compact: 4, expanded: 5 },
  outliers: { compact: 4, expanded: 6 },
} as const;

export type SectionItemKind = keyof typeof SECTION_ITEM_CONTRACT;

export const SECTION_GRID_CLASS = {
  people: 'grid grid-cols-2 sm:grid-cols-5 gap-4',
  outliers: 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4',
} as const;

export function sectionItemCount(kind: SectionItemKind, compact: boolean): number {
  const contract = SECTION_ITEM_CONTRACT[kind];
  return compact ? contract.compact : contract.expanded;
}

export function boundSectionItems<T>(
  items: readonly T[],
  kind: SectionItemKind,
  compact: boolean,
): T[] {
  return items.slice(0, sectionItemCount(kind, compact));
}

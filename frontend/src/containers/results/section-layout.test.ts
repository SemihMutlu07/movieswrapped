import { describe, expect, it } from 'vitest';

import {
  boundSectionItems,
  SECTION_ITEM_CONTRACT,
  sectionItemCount,
} from './section-layout';

describe('Results section item contracts', () => {
  it('caps directors, cast, and outliers at 4 on compact layouts', () => {
    expect(sectionItemCount('directors', true)).toBe(4);
    expect(sectionItemCount('cast', true)).toBe(4);
    expect(sectionItemCount('outliers', true)).toBe(4);
  });

  it('keeps the existing desktop counts on expanded layouts', () => {
    expect(sectionItemCount('directors', false)).toBe(SECTION_ITEM_CONTRACT.directors.expanded);
    expect(sectionItemCount('cast', false)).toBe(5);
    expect(sectionItemCount('outliers', false)).toBe(6);
  });

  it('slices the dataset before render rather than hiding leftovers', () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    expect(boundSectionItems(items, 'directors', true)).toEqual([1, 2, 3, 4]);
    expect(boundSectionItems(items, 'directors', false)).toEqual([1, 2, 3, 4, 5]);
    expect(boundSectionItems(items, 'outliers', false)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  pickActiveSectionId,
  scrollProgressIndex,
  scrollspyLabelKey,
  thumbOffsetPx,
} from './scrollspy';

describe('pickActiveSectionId', () => {
  const sections = [
    { id: 'hero', top: -40 },
    { id: 'people', top: 80 },
    { id: 'reviews', top: 400 },
  ];

  it('returns the first section when none have crossed the spy line', () => {
    expect(pickActiveSectionId(sections, -100)).toBe('hero');
  });

  it('returns the last section that has crossed the spy line', () => {
    expect(pickActiveSectionId(sections, 90)).toBe('people');
    expect(pickActiveSectionId(sections, 420)).toBe('reviews');
  });

  it('returns null for an empty list', () => {
    expect(pickActiveSectionId([], 0)).toBeNull();
  });
});

describe('scrollProgressIndex', () => {
  const sections = [
    { id: 'hero', top: -40 },
    { id: 'people', top: 80 },
    { id: 'reviews', top: 400 },
  ];

  it('clamps before the first and after the last section', () => {
    expect(scrollProgressIndex(sections, -100)).toBe(0);
    expect(scrollProgressIndex(sections, 800)).toBe(2);
  });

  it('lerps between adjacent section tops', () => {
    expect(scrollProgressIndex(sections, 80)).toBe(1);
    expect(scrollProgressIndex(sections, 240)).toBe(1.5);
  });
});

describe('thumbOffsetPx', () => {
  it('centers the thumb in the slot at a fractional index', () => {
    expect(thumbOffsetPx(0, 28, 20)).toBe(4);
    expect(thumbOffsetPx(1.5, 28, 20)).toBe(46);
  });
});

describe('scrollspyLabelKey', () => {
  it('maps known section ids to i18n keys', () => {
    expect(scrollspyLabelKey('cinema-scale')).toBe('results.spy.cinemaScale');
    expect(scrollspyLabelKey('share-footer')).toBe('results.spy.share');
  });
});

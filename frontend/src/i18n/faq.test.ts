import { describe, expect, it } from 'vitest';

import { en, tr } from './catalogs';
import { FAQ_ITEMS, getFaqItems } from './faq';

describe('landing FAQ', () => {
  it('defines the six expected questions in both catalogs', () => {
    expect(FAQ_ITEMS).toHaveLength(6);
    for (const { q, a } of FAQ_ITEMS) {
      expect(en[q]).toBeTruthy();
      expect(tr[q]).toBeTruthy();
      expect(en[a]).toBeTruthy();
      expect(tr[a]).toBeTruthy();
    }
  });

  it('returns localized question/answer pairs from the catalog', () => {
    const enItems = getFaqItems('en');
    const trItems = getFaqItems('tr');

    expect(enItems).toHaveLength(6);
    expect(trItems).toHaveLength(6);
    expect(enItems[0].question).toBe('What is Movies Wrapped?');
    expect(enItems[0].answer).toBe(
      "The file from your zip is your year. Letterboxd's Year in Review is the January 2 email, the same screen again.",
    );
    expect(trItems[0].question).toBe('Movies Wrapped nedir?');

    // Answers must not leak the other language or stay empty.
    for (const item of [...enItems, ...trItems]) {
      expect(item.question.trim()).not.toBe('');
      expect(item.answer.trim()).not.toBe('');
    }
  });
});

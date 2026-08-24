import { describe, expect, it } from 'vitest';
import { normalizeLanguageKey } from './LanguagesLeaderboard';

describe('normalizeLanguageKey', () => {
  it('normalizes case and strips region suffixes', () => {
    expect(normalizeLanguageKey('EN')).toBe('en');
    expect(normalizeLanguageKey('en-US')).toBe('en');
    expect(normalizeLanguageKey('tr_TR')).toBe('tr');
  });

  it('returns null for invalid values', () => {
    expect(normalizeLanguageKey('')).toBeNull();
    expect(normalizeLanguageKey(null)).toBeNull();
    expect(normalizeLanguageKey(undefined)).toBeNull();
  });
});

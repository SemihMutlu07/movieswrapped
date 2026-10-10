import { describe, expect, it } from 'vitest';

import {
  isTrustedImportOrigin,
  parseBookmarkletMessage,
  parseBookmarkletPayload,
} from './letterboxdImport';

const sample = {
  source: 'letterboxd',
  user: 'Dave',
  films: [{ title: 'Heat', year: 1995, rating: 4.5, slug: 'heat' }],
  diary: [{ title: 'Heat', year: 1995, watchedDate: '2024-01-02' }],
};

describe('letterboxdImport', () => {
  it('normalizes bookmarklet JSON', () => {
    const parsed = parseBookmarkletPayload(sample);
    expect(parsed).toMatchObject({
      user: 'dave',
      films: [{ title: 'Heat', year: 1995, rating: 4.5 }],
      diary: [{ title: 'Heat', watchedDate: '2024-01-02' }],
    });
  });

  it('reads the postMessage envelope', () => {
    expect(parseBookmarkletMessage({ type: 'mw-letterboxd', data: sample })?.user).toBe('dave');
  });

  it('rejects empty or invalid payloads', () => {
    expect(parseBookmarkletPayload({ user: 'dave', films: [], diary: [] })).toBeNull();
    expect(parseBookmarkletPayload({ user: 'not valid', films: sample.films })).toBeNull();
  });

  it('trusts Letterboxd and the import page origin', () => {
    expect(isTrustedImportOrigin('https://letterboxd.com', 'https://movieswrapped.com')).toBe(true);
    expect(isTrustedImportOrigin('https://www.letterboxd.com', 'https://movieswrapped.com')).toBe(true);
    expect(isTrustedImportOrigin('https://movieswrapped.com', 'https://movieswrapped.com')).toBe(true);
    expect(isTrustedImportOrigin('https://evil.example', 'https://movieswrapped.com')).toBe(false);
  });
});

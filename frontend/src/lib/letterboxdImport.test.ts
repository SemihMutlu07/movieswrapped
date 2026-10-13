import { describe, expect, it } from 'vitest';

import { bookmarkletSource } from './letterboxdBookmarklet';
import {
  isTrustedImportOrigin,
  parseBookmarkletMessage,
  parseBookmarkletPayload,
} from './letterboxdImport';

type ParsedFilm = {
  slug: string | null;
  title: string;
  year: number | null;
  rating: number | null;
  liked: boolean;
};

/** June 2026 member-page grid: div.react-component.griditem, not li.griditem. */
const lazyPosterProfileFixture = `
  <div class="grid">
    <div class="react-component griditem" data-component-class="LazyPoster"
         data-item-slug="heat" data-item-name="Heat (1995)"
         data-item-link="/film/heat/">
      <span class="rating rated-9"></span>
      <span class="icon-liked"></span>
    </div>
    <div class="react-component griditem" data-component-class="LazyPoster"
         data-item-slug="past-lives" data-item-name="Past Lives (2023)"
         data-item-link="/film/past-lives/">
    </div>
  </div>
`;

function parseFilmsFromBookmarklet(html: string): ParsedFilm[] {
  const win = window as Window & { MWParse?: { parseFilmsPage: (doc: Document) => ParsedFilm[] } };
  if (!win.MWParse) {
    if (/letterboxd\.com$/.test(window.location.hostname)) {
      throw new Error('refusing to eval the bookmarklet crawl on letterboxd.com');
    }
    window.eval(bookmarkletSource('https://movieswrapped.com'));
  }
  if (!win.MWParse) throw new Error('bookmarklet did not publish MWParse');
  return win.MWParse.parseFilmsPage(new DOMParser().parseFromString(html, 'text/html'));
}

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

  it('reads a LazyPoster profile grid the old li selectors miss', () => {
    const doc = new DOMParser().parseFromString(lazyPosterProfileFixture, 'text/html');
    expect(doc.querySelectorAll('li.griditem, li.poster-container')).toHaveLength(0);
    expect(parseFilmsFromBookmarklet(lazyPosterProfileFixture)).toEqual([
      { slug: 'heat', title: 'Heat', year: 1995, rating: 4.5, liked: true },
      { slug: 'past-lives', title: 'Past Lives', year: 2023, rating: null, liked: false },
    ]);
  });

  it('reads an October 2026 profile where the rating sits beside LazyPoster', () => {
    const html = `
      <ul>
        <li class="griditem">
          <div class="react-component" data-component-class="LazyPoster"
               data-item-slug="digger-2026" data-item-name="Digger (2026)">
            <div class="poster film-poster"></div>
          </div>
          <p class="poster-viewingdata">
            <span class="rating -micro -darker rated-6">★★★</span>
          </p>
        </li>
      </ul>
    `;
    expect(parseFilmsFromBookmarklet(html)).toEqual([
      { slug: 'digger-2026', title: 'Digger', year: 2026, rating: 3, liked: false },
    ]);
  });

  it('still reads a classic li.griditem tile', () => {
    const html = `
      <ul>
        <li class="griditem">
          <div data-item-slug="heat" data-item-name="Heat (1995)"></div>
          <span class="rating rated-9"></span>
        </li>
      </ul>
    `;
    expect(parseFilmsFromBookmarklet(html)).toEqual([
      { slug: 'heat', title: 'Heat', year: 1995, rating: 4.5, liked: false },
    ]);
  });

  it('trusts Letterboxd and the import page origin', () => {
    expect(isTrustedImportOrigin('https://letterboxd.com', 'https://movieswrapped.com')).toBe(true);
    expect(isTrustedImportOrigin('https://www.letterboxd.com', 'https://movieswrapped.com')).toBe(true);
    expect(isTrustedImportOrigin('https://movieswrapped.com', 'https://movieswrapped.com')).toBe(true);
    expect(isTrustedImportOrigin('https://evil.example', 'https://movieswrapped.com')).toBe(false);
  });
});

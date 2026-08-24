import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(frontendDir, 'public/demo/smt-fixture.json');
const mediaOutput = resolve(frontendDir, 'public/demo/smt-media');

const titleKey = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('en-US')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const yearKey = (value) => {
  const year = Number(value);
  return Number.isFinite(year) ? String(Math.trunc(year)) : '';
};

describe('prepare-smt-fixture', () => {
  it('restores poster paths for every written review with matching film metadata', async () => {
    // Assert against the committed demo fixture + media directly. We do NOT
    // spawn prepare-smt-fixture.mjs: that script re-materializes hundreds of
    // posters from image.tmdb.org on a cold cache. public/demo is the shipped
    // offline artifact, so validating it is deterministic and network-free.
    const fixture = JSON.parse(await readFile(output, 'utf8'));
    const mediaFiles = new Set(await readdir(mediaOutput));
    const details = fixture.summary.details;
    const posters = new Map(
      details.all_films
        .filter((film) => typeof film.poster_path === 'string' && film.poster_path.length > 0)
        .map((film) => [[titleKey(film.title), yearKey(film.year)].join('|'), film.poster_path]),
    );
    const reviews = details.review_analysis.reviews;
    const matchingReviews = reviews.filter((review) => posters.has(
      [titleKey(review.title), yearKey(review.year)].join('|'),
    ));

    expect(matchingReviews.length).toBeGreaterThan(350);
    for (const review of matchingReviews) {
      expect(review.poster_path, `${review.title} (${review.year})`).toBe(
        posters.get([titleKey(review.title), yearKey(review.year)].join('|')),
      );
      expect(review.poster_path).toMatch(/^\/demo\/smt-media\/[^/]+$/);
      expect(mediaFiles.has(basename(review.poster_path))).toBe(true);
    }
    expect(reviews.find((review) => review.title === 'Blow-Up')?.poster_path).toBeTruthy();
    expect(reviews.find((review) => review.title === 'The Silence of the Lambs')?.poster_path).toBeTruthy();
    expect(reviews.find((review) => review.title === 'The Life of Chuck')?.poster_path).toBeTruthy();
  });

  it('keeps nearly all film posters and director portraits on local /demo paths', async () => {
    const fixture = JSON.parse(await readFile(output, 'utf8'));
    const mediaFiles = new Set(await readdir(mediaOutput));
    const details = fixture.summary.details;

    const films = details.all_films ?? [];
    const filmsWithPoster = films.filter((film) => typeof film.poster_path === 'string' && film.poster_path);
    expect(films.length).toBeGreaterThan(650);
    expect(filmsWithPoster.length / films.length).toBeGreaterThan(0.95);
    for (const film of filmsWithPoster) {
      expect(film.poster_path).toMatch(/^\/demo\/smt-media\/[^/]+$/);
      expect(mediaFiles.has(basename(film.poster_path))).toBe(true);
    }

    const directors = details.top_directors ?? [];
    const directorsWithPortrait = directors.filter(
      (person) => typeof person.profile_path === 'string' && person.profile_path,
    );
    expect(directorsWithPortrait.length).toBe(directors.length);
    for (const person of directorsWithPortrait) {
      expect(person.profile_path).toMatch(/^\/demo\/smt-media\/[^/]+$/);
      expect(mediaFiles.has(basename(person.profile_path))).toBe(true);
    }

    expect(fixture.username).toBe('semihmutsuz');
  });
});

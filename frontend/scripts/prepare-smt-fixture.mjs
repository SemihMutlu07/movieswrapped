#!/usr/bin/env node
/**
 * Build the offline /smt demo fixture:
 * 1. Read `dev-fixtures/analysis-runs/semihmutsuz.json`
 * 2. Restore review posters from all_films metadata
 * 3. Download every poster_path / profile_path into `public/demo/smt-media`
 * 4. Rewrite those fields to `/demo/smt-media/<file>` so local UI needs no TMDB/backend
 */
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destinationDir = resolve(frontendDir, 'public/demo');
const destination = resolve(destinationDir, 'smt-fixture.json');
const mediaDestination = resolve(destinationDir, 'smt-media');
const mediaCache = resolve(frontendDir, '.next/cache/smt-media');

if (process.argv.includes('--clean')) {
  await rm(destinationDir, { force: true, recursive: true });
  process.exit(0);
}

const fixtureDir = resolve(frontendDir, 'dev-fixtures/analysis-runs');
const source = resolve(fixtureDir, 'semihmutsuz.json');
const mediaSource = resolve(fixtureDir, 'semihmutsuz-media');
const shareCardMediaManifest = resolve(fixtureDir, 'semihmutsuz-share-card-media.json');

const titleKey = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('en-US')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const yearKey = (value) => {
  const year = Number(value);
  return Number.isFinite(year) ? String(Math.trunc(year)) : '';
};

function restoreReviewPosters(fixture) {
  const details = fixture?.summary?.details;
  const reviewAnalysis = details?.review_analysis;
  if (!details || !reviewAnalysis) return 0;

  const posterByTitleYear = new Map();
  for (const film of details.all_films ?? []) {
    if (typeof film?.poster_path !== 'string' || !film.poster_path) continue;
    posterByTitleYear.set(
      `${titleKey(film.title)}|${yearKey(film.year)}`,
      film.poster_path,
    );
  }

  let restored = 0;
  for (const collection of [
    reviewAnalysis.reviews ?? [],
    reviewAnalysis.top_liked_reviews ?? [],
  ]) {
    for (const review of collection) {
      const posterPath = posterByTitleYear.get(
        `${titleKey(review.title)}|${yearKey(review.year)}`,
      );
      if (!posterPath) continue;
      review.poster_path = posterPath;
      restored += 1;
    }
  }
  return restored;
}

function localizeFixtureMedia(value, mediaFiles) {
  if (Array.isArray(value)) {
    return value.map((item) => localizeFixtureMedia(item, mediaFiles));
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (
        (key === 'poster_path' || key === 'profile_path') &&
        typeof item === 'string' &&
        item
      ) {
        const file = basename(item.split('?')[0]);
        if (mediaFiles.has(file)) {
          return [key, `/demo/smt-media/${file}`];
        }
      }
      return [key, localizeFixtureMedia(item, mediaFiles)];
    }),
  );
}

/** Collect every poster/profile path in the fixture (full offline coverage). */
function collectMediaPaths(value, collected = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) collectMediaPaths(item, collected);
    return collected;
  }
  if (!value || typeof value !== 'object') return collected;

  for (const [key, item] of Object.entries(value)) {
    if (
      (key === 'poster_path' || key === 'profile_path') &&
      typeof item === 'string' &&
      item.trim()
    ) {
      const raw = item.trim();
      // Already-local demo paths still need their file present.
      const file = basename(raw.replace(/^\/demo\/smt-media\//, '').split('?')[0]);
      if (!file || file === 'smt-media') continue;
      // Prefer TMDB-relative path for CDN fetch; keep basename as disk key.
      let remote = raw;
      if (raw.startsWith('/demo/smt-media/')) {
        remote = `/${file}`;
      } else if (raw.includes('image.tmdb.org')) {
        try {
          remote = new URL(raw).pathname.replace(/^\/t\/p\/[^/]+\//, '/');
        } catch {
          remote = `/${file}`;
        }
      } else if (!raw.startsWith('/')) {
        remote = `/${file}`;
      }
      if (!collected.has(file)) collected.set(file, remote.startsWith('/') ? remote : `/${remote}`);
    } else {
      collectMediaPaths(item, collected);
    }
  }
  return collected;
}

function tmdbFetchUrl(remotePath, size = 'w342') {
  const clean = remotePath.replace(/^\/+/, '').replace(/^t\/p\/[^/]+\//, '');
  return `https://image.tmdb.org/t/p/${size}/${clean}`;
}

async function materializeMedia(file, remotePath, availableFiles) {
  const destinationPath = resolve(mediaDestination, file);
  if (availableFiles.has(file)) {
    await cp(resolve(mediaSource, file), destinationPath);
    return 'seed';
  }

  const cachePath = resolve(mediaCache, file);
  try {
    await access(cachePath);
    await cp(cachePath, destinationPath);
    return 'cache';
  } catch {
    // cold cache → TMDB CDN
  }

  const response = await fetch(tmdbFetchUrl(remotePath));
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
    // Soft-fail: leave path unlocalized rather than aborting the whole fixture.
    console.warn(`[smt] skip media ${file}: HTTP ${response.status}`);
    return 'missing';
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(cachePath, bytes);
  await writeFile(destinationPath, bytes);
  return 'download';
}

try {
  const fixture = JSON.parse(await readFile(source, 'utf8'));
  const restoredReviewPosters = restoreReviewPosters(fixture);
  const shareCardMedia = JSON.parse(await readFile(shareCardMediaManifest, 'utf8'));
  const mediaFiles = new Set(await readdir(mediaSource));
  const requiredShareCardMedia = [
    ...shareCardMedia.people.map(({ file }) => file),
    ...shareCardMedia.posters.map(({ file }) => file),
  ];
  const missingShareCardMedia = requiredShareCardMedia.filter((file) => !mediaFiles.has(file));

  if (shareCardMedia.people.length !== 2 || shareCardMedia.posters.length !== 10) {
    throw new Error('Share-card media manifest must contain exactly 2 people and 10 posters.');
  }
  if (missingShareCardMedia.length > 0) {
    throw new Error(`Missing share-card media: ${missingShareCardMedia.join(', ')}`);
  }

  // Full tree: films, people, reviews, share-card seeds, nested film lists, etc.
  const allMedia = collectMediaPaths(fixture);
  for (const file of requiredShareCardMedia) {
    if (!allMedia.has(file)) allMedia.set(file, `/${file}`);
  }

  await mkdir(destinationDir, { recursive: true });
  await rm(mediaDestination, { force: true, recursive: true });
  await mkdir(mediaDestination, { recursive: true });
  await mkdir(mediaCache, { recursive: true });

  const mediaEntries = [...allMedia.entries()].sort(([left], [right]) => left.localeCompare(right));
  const counts = { seed: 0, cache: 0, download: 0, missing: 0 };
  const presentFiles = new Set();
  for (let index = 0; index < mediaEntries.length; index += 12) {
    const batch = mediaEntries.slice(index, index + 12);
    const results = await Promise.all(
      batch.map(async ([file, remotePath]) => {
        const status = await materializeMedia(file, remotePath, mediaFiles);
        return { file, status };
      }),
    );
    for (const { file, status } of results) {
      counts[status] += 1;
      if (status !== 'missing') presentFiles.add(file);
    }
  }

  const localizedFixture = localizeFixtureMedia(fixture, presentFiles);
  await writeFile(destination, `${JSON.stringify(localizedFixture, null, 2)}\n`);
  console.log(
    `[smt] Prepared fixture: ${presentFiles.size}/${allMedia.size} local media ` +
      `(seed=${counts.seed} cache=${counts.cache} download=${counts.download} missing=${counts.missing}); ` +
      `${restoredReviewPosters} review posters restored.`,
  );
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[smt] Could not prepare the local fixture: ${detail}`);
  process.exit(1);
}

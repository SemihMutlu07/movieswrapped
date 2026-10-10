export type BookmarkletFilm = {
  slug?: string | null;
  title: string;
  year?: number | string | null;
  rating?: number | null;
  liked?: boolean;
};

export type BookmarkletDiary = {
  slug?: string | null;
  title: string;
  year?: number | string | null;
  rating?: number | null;
  watchedDate?: string | null;
  watch_date?: string | null;
  rewatch?: boolean;
  viewingId?: string | null;
};

export type BookmarkletPayload = {
  source?: string;
  user: string;
  exportedAt?: string;
  films: BookmarkletFilm[];
  diary: BookmarkletDiary[];
};

const USERNAME_RE = /^[a-z0-9_]+$/;

function asFilm(value: unknown): BookmarkletFilm | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (!title) return null;
  const film: BookmarkletFilm = { title };
  if (typeof row.slug === 'string' && row.slug) film.slug = row.slug;
  if (typeof row.year === 'number' || typeof row.year === 'string') film.year = row.year;
  if (typeof row.rating === 'number' && Number.isFinite(row.rating)) film.rating = row.rating;
  if (typeof row.liked === 'boolean') film.liked = row.liked;
  return film;
}

function asDiary(value: unknown): BookmarkletDiary | null {
  const film = asFilm(value);
  if (!film || !value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const diary: BookmarkletDiary = { ...film };
  if (typeof row.watchedDate === 'string' && row.watchedDate) diary.watchedDate = row.watchedDate;
  if (typeof row.watch_date === 'string' && row.watch_date) diary.watch_date = row.watch_date;
  if (typeof row.rewatch === 'boolean') diary.rewatch = row.rewatch;
  if (typeof row.viewingId === 'string' && row.viewingId) diary.viewingId = row.viewingId;
  return diary;
}

export function parseBookmarkletPayload(value: unknown): BookmarkletPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const user = String(row.user || row.username || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  if (!USERNAME_RE.test(user)) return null;
  const films = Array.isArray(row.films) ? row.films.map(asFilm).filter((item): item is BookmarkletFilm => item !== null) : [];
  const diary = Array.isArray(row.diary) ? row.diary.map(asDiary).filter((item): item is BookmarkletDiary => item !== null) : [];
  if (films.length === 0 && diary.length === 0) return null;
  const payload: BookmarkletPayload = { user, films, diary };
  if (typeof row.source === 'string') payload.source = row.source;
  if (typeof row.exportedAt === 'string') payload.exportedAt = row.exportedAt;
  return payload;
}

export function parseBookmarkletMessage(data: unknown): BookmarkletPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (row.type === 'mw-letterboxd') {
    return parseBookmarkletPayload(row.data);
  }
  return parseBookmarkletPayload(data);
}

export function isTrustedImportOrigin(origin: string, pageOrigin: string): boolean {
  if (origin === pageOrigin) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === 'letterboxd.com' || host.endsWith('.letterboxd.com');
  } catch {
    return false;
  }
}

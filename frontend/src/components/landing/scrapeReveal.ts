import type { ScrapeTraceEvent } from '@/lib/api';

export type ScrapePreviewItem = {
  title: string;
  year?: string;
  poster_url?: string;
};

export type ScrapeWaitBeat = 'queued' | 'intro' | 'films' | 'reviews' | 'analyzing' | 'ready';

/** Ekranda aynı anda en fazla bu kadar poster gösterilir (audit: max 6–8). */
export const MAX_POSTERS = 8;

/**
 * Poster listesini 2–4'lük batch'lere böler (audit: tek poster drip yasak).
 * Tek elemanlı batch yalnız toplam 1 poster varsa oluşur.
 */
export function chunkIntoBatches<T>(items: T[], max = 4): T[][] {
  const total = items.length;
  if (total === 0) return [];
  const batchCount = Math.ceil(total / max);
  const base = Math.floor(total / batchCount);
  let remainder = total % batchCount;
  const batches: T[][] = [];
  let index = 0;
  for (let i = 0; i < batchCount; i += 1) {
    const size = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    batches.push(items.slice(index, index + size));
    index += size;
  }
  return batches;
}

export type ScrapeReveal = {
  queued: boolean;
  analyzing: boolean;
  ready: boolean;
  filmsFound: number | null;
  reviewsFound: number | null;
  items: ScrapePreviewItem[];
  posters: ScrapePreviewItem[];
  beat: ScrapeWaitBeat;
};

const SAMPLE_STAGES = new Set(['diary_done', 'grid_done']);
// Analysis running vs finished are distinct machine states: ANALYZING pulses, READY settles.
const ANALYZING_STAGES = new Set(['scrape_done', 'analysis_started']);
const READY_STAGES = new Set(['analysis_done', 'postback_started', 'completed']);

function metricNumber(metrics: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asItem(raw: unknown): ScrapePreviewItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (!title) return null;
  const item: ScrapePreviewItem = { title };
  if (typeof record.year === 'string' && record.year.trim()) item.year = record.year.trim();
  if (typeof record.poster_url === 'string' && record.poster_url.startsWith('https://')) {
    item.poster_url = record.poster_url;
  }
  return item;
}

function itemsFromEvents(events: ScrapeTraceEvent[]): ScrapePreviewItem[] {
  const byTitle = new Map<string, ScrapePreviewItem>();
  for (const event of events) {
    if (!SAMPLE_STAGES.has(event.stage ?? '')) continue;
    const sample = event.metrics?.sample;
    if (!Array.isArray(sample)) continue;
    for (const raw of sample) {
      const item = asItem(raw);
      if (!item) continue;
      const key = item.title.toLocaleLowerCase();
      const previous = byTitle.get(key);
      if (!previous) {
        byTitle.set(key, item);
        continue;
      }
      byTitle.set(key, {
        title: item.title,
        year: item.year ?? previous.year,
        poster_url: item.poster_url ?? previous.poster_url,
      });
    }
  }
  return [...byTitle.values()].slice(0, MAX_POSTERS);
}

function confirmedCount(events: ScrapeTraceEvent[], pageStage: string, doneStage: string, key: string): number | null {
  const done = [...events].reverse().find((event) => event.stage === doneStage);
  const fromDone = metricNumber(done?.metrics, key);
  if (fromDone != null) return fromDone;
  let total = 0;
  for (const event of events) {
    if (event.stage !== pageStage) continue;
    total += metricNumber(event.metrics, key) ?? 0;
  }
  return total > 0 ? total : null;
}

function hasStage(events: ScrapeTraceEvent[], stage: string): boolean {
  return events.some((event) => event.stage === stage);
}

/** Last beat whose data is actually present. Never advances onto an empty next slide. */
export function resolveScrapeBeat(reveal: Omit<ScrapeReveal, 'beat'>): ScrapeWaitBeat {
  if (reveal.queued) return 'queued';
  if (reveal.ready) return 'ready';
  if (reveal.analyzing) return 'analyzing';
  if (reveal.reviewsFound != null) return 'reviews';
  if (reveal.items.length > 0 || reveal.filmsFound != null) return 'films';
  return 'intro';
}

export function resolveScrapeReveal(
  events: ScrapeTraceEvent[] | undefined,
  queued = false,
): ScrapeReveal {
  const list = events ?? [];
  const items = itemsFromEvents(list);
  const base = {
    queued,
    analyzing: list.some((event) => ANALYZING_STAGES.has(event.stage ?? '')),
    ready: list.some((event) => READY_STAGES.has(event.stage ?? '')),
    filmsFound: confirmedCount(list, 'diary_page', 'diary_done', 'films')
      ?? confirmedCount(list, 'grid_page', 'grid_done', 'films'),
    reviewsFound: confirmedCount(list, 'reviews_page', 'reviews_done', 'reviews'),
    items,
    posters: items.filter((item) => Boolean(item.poster_url)),
  };
  return { ...base, beat: resolveScrapeBeat(base) };
}

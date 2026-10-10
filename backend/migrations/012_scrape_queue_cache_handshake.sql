-- Migration 012: scrape queue durability extras, 24h result cache, worker handshake
-- The scrape job queue itself lives in ops_tasks (006 + 010). This migration
-- adds the cache table that skips a repeat scrape for 24h, and handshake
-- columns on ops_workers so a stale X370 worker can be rejected and self-update.
-- Run in: Supabase Dashboard (mw_new) → SQL Editor

-- 24h per-username scrape cache (username + period). Best-effort; a miss
-- just re-queues a live scrape.
create table if not exists scrape_result_cache (
  username          text not null,
  analysis_period   text not null,
  stats             jsonb not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  primary key (username, analysis_period)
);

create index if not exists idx_scrape_result_cache_expires_at
  on scrape_result_cache (expires_at);

alter table scrape_result_cache enable row level security;

create policy "backend scrape cache all" on scrape_result_cache for all to authenticated
  using ((auth.jwt() ->> 'email') = 'ops@movieswrapped.internal')
  with check ((auth.jwt() ->> 'email') = 'ops@movieswrapped.internal');

-- Handshake fields on the worker heartbeat row.
alter table ops_workers
  add column if not exists git_sha text not null default '';

alter table ops_workers
  add column if not exists protocol_version integer not null default 0;

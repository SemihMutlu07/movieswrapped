-- Migration 011: RSS fingerprint columns for returning-user cache
-- Run in: Supabase Dashboard → SQL Editor
--
-- PR 3 stores the public Letterboxd RSS identity of a successful ZIP/scrape
-- run so the same browser session can be offered cached aggregates when the
-- feed's latest guid / watchedDate has not moved. Columns are nullable;
-- historical rows stay cache-ineligible until a new successful run writes them.
--
-- Lookup is always session_id + username (never username alone). The index
-- supports that read without enabling a username-only scan.

ALTER TABLE public.analysis_runs
  ADD COLUMN IF NOT EXISTS rss_checksum text,
  ADD COLUMN IF NOT EXISTS rss_latest_guid text,
  ADD COLUMN IF NOT EXISTS rss_latest_watched_date text;

CREATE INDEX IF NOT EXISTS idx_analysis_runs_session_username_finished
  ON public.analysis_runs (session_id, username, finished_at DESC)
  WHERE ok = true;

-- See frontend/src/lib/supabase/analysis_runs.ts → finishAnalysis()
-- and lookupCachedAnalysis().

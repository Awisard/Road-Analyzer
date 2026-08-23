-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run

create table if not exists public.road_analyses (
  id uuid primary key,
  created_at timestamptz not null default now(),
  image_path text not null,        -- path inside the storage bucket
  overlay_path text,                -- path inside the storage bucket, nullable
  road_type text,
  class_breakdown jsonb,
  gsd_meters_per_pixel numeric,
  road_length_m numeric,
  image_width int,
  image_height int
);

-- Row-level security: ON by default. The backend uses the SERVICE ROLE key
-- (server/services/supabaseClient.js), which bypasses RLS entirely, so the
-- app works with zero policies below. Only add policies if you also want to
-- query this table directly from the browser using the anon/public key —
-- e.g. a read-only policy for a public dashboard:
--
-- alter table public.road_analyses enable row level security;
-- create policy "Public read access" on public.road_analyses
--   for select using (true);
--
-- Leave RLS OFF (default/no policies) if only the Node backend ever touches
-- this table — that's the setup this project assumes.

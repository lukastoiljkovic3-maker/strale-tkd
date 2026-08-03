-- ============================================================
--  CALENDAR BLOCKS  ·  run once per CRM Supabase project
--  (strale gopysmvvfinuvaczyput / cjure qmwoopzkypinmzcguars /
--   maminjo ydltgxzdcipvvcajjxbi)
--
--  A closer marks a time range as unavailable. This table is the CRM's
--  source of truth; the range is additionally mirrored into the booking
--  system so the public widget stops offering it:
--    · strale + cjure -> GHL blocked slot (api/cal-block.js)
--    · maminjo        -> maminjo-webinar /api/book reads this table directly
-- ============================================================

create table if not exists public.calendar_blocks (
  id              bigint generated always as identity primary key,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  reason          text,
  created_by      text,                 -- email of the closer who blocked it
  ghl_event_id    text,                 -- mirrored GHL block, null if GHL refused or n/a
  ghl_calendar_id text,
  created_at      timestamptz not null default now(),
  constraint calendar_blocks_range_chk check (ends_at > starts_at)
);

create index if not exists idx_calblocks_start on public.calendar_blocks(starts_at);
create index if not exists idx_calblocks_range on public.calendar_blocks(starts_at, ends_at);

-- Same rule as the rest of the CRM: any signed-in Google user has full access.
alter table public.calendar_blocks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar_blocks'
      and policyname = 'auth full access - calendar_blocks'
  ) then
    create policy "auth full access - calendar_blocks"
      on public.calendar_blocks for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Live updates: a block made on the phone shows up on the desktop grid.
alter table public.calendar_blocks replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calendar_blocks'
  ) then
    alter publication supabase_realtime add table public.calendar_blocks;
  end if;
end $$;

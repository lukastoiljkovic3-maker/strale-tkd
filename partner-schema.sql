-- ============================================================
--  STRALE × CJURE — PARTNER COMMISSION TRACKING
--  Supabase project: gopysmvvfinuvaczyput  (Strale)
--  Run ONCE: Supabase → SQL Editor → paste → Run.
--
--  What this does:
--    1. Creates `closes` — one row per confirmed, cash-collected close.
--       Commission is a STORED GENERATED column, so the number Cjure
--       sees is computed by Postgres, not by client-side JS.
--    2. Creates `partner_users` — the allowlist of external partners.
--    3. Locks partners OUT of the leads pipeline. Partners can read
--       `closes` and nothing else. Everyone already using the CRM
--       keeps working exactly as before (deny-by-role, not
--       allow-by-list — nobody gets locked out of the CRM).
--
--  Partner seeded in step 3: cjurefx@gmail.com @ 20%.
--
--  Runs as ONE transaction on purpose. Step 6 drops the CRM's existing
--  RLS policies before recreating them - if the script failed halfway
--  through, the team would be locked out of the tracker. Wrapped like
--  this, any error rolls the whole thing back and nothing changes.
-- ============================================================

begin;

-- 1) CLOSES ---------------------------------------------------
create table if not exists public.closes (
  id              uuid primary key default gen_random_uuid(),
  -- who was closed
  client_name     text        not null,
  client_email    text,
  lead_id         text        references public.ghl_leads(id) on delete set null,
  -- what was sold: the bot (CPA) or a funded account
  deal_type       text        not null
                  check (deal_type in ('cpa','funded_100k','funded_200k')),
  -- cash actually collected, entered by the closer
  amount_eur      numeric(12,2) not null check (amount_eur >= 0),
  closed_on       date        not null default current_date,
  closer          text,
  notes           text,
  -- Rate is stored PER ROW, not global: changing the rate later must not
  -- silently rewrite commission already reported on past closes.
  commission_rate numeric(5,4) not null default 0.20
                  check (commission_rate >= 0 and commission_rate <= 1),
  commission_eur  numeric(12,2)
                  generated always as (round(amount_eur * commission_rate, 2)) stored,
  created_at      timestamptz not null default now(),
  created_by      text
);
create index if not exists idx_closes_closed_on on public.closes(closed_on desc);
create index if not exists idx_closes_deal_type on public.closes(deal_type);

-- 2) PARTNER ALLOWLIST ----------------------------------------
create table if not exists public.partner_users (
  email           text primary key,
  name            text,
  commission_rate numeric(5,4) not null default 0.20,
  active          boolean      not null default true,
  created_at      timestamptz  not null default now()
);

-- 3) SEED CJURE -----------------------------------------------
-- Must match the Google account he actually signs in with.
insert into public.partner_users (email, name, commission_rate)
values ('cjurefx@gmail.com', 'Cjure', 0.20)
on conflict (email) do update
  set name = excluded.name,
      commission_rate = excluded.commission_rate,
      active = true;

-- 4) ROLE HELPER ----------------------------------------------
-- SECURITY DEFINER so the check itself isn't subject to RLS on
-- partner_users (otherwise the lookup returns nothing and every
-- partner would read as "not a partner" — i.e. full access).
create or replace function public.is_partner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.partner_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and active
  );
$$;
revoke all on function public.is_partner() from public;
grant execute on function public.is_partner() to authenticated;

-- 5) RLS ON CLOSES --------------------------------------------
alter table public.closes        enable row level security;
alter table public.partner_users enable row level security;

drop policy if exists "closes readable by team and partners" on public.closes;
create policy "closes readable by team and partners"
  on public.closes for select to authenticated
  using (true);

-- Partners are strictly read-only: no insert/update/delete.
drop policy if exists "closes writable by team only" on public.closes;
create policy "closes writable by team only"
  on public.closes for insert to authenticated
  with check (not public.is_partner());

drop policy if exists "closes updatable by team only" on public.closes;
create policy "closes updatable by team only"
  on public.closes for update to authenticated
  using (not public.is_partner()) with check (not public.is_partner());

drop policy if exists "closes deletable by team only" on public.closes;
create policy "closes deletable by team only"
  on public.closes for delete to authenticated
  using (not public.is_partner());

-- A partner may read only their OWN allowlist row (to get their rate/name).
drop policy if exists "partner reads own row" on public.partner_users;
create policy "partner reads own row"
  on public.partner_users for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         or not public.is_partner());

-- 6) LOCK PARTNERS OUT OF THE PIPELINE ------------------------
-- The old policies were "any authenticated user, full access" — which
-- would have let Cjure read AND EDIT every Strale lead the moment he
-- signed in. Replace them with the same access MINUS partners.
drop policy if exists "auth full access - leads"      on public.ghl_leads;
drop policy if exists "auth full access - daily"      on public.daily_entries;
drop policy if exists "auth full access - activities" on public.lead_activities;

-- Drop the new names too, so re-running the script is safe.
drop policy if exists "team full access - leads"      on public.ghl_leads;
drop policy if exists "team full access - daily"      on public.daily_entries;
drop policy if exists "team full access - activities" on public.lead_activities;

create policy "team full access - leads"
  on public.ghl_leads for all to authenticated
  using (not public.is_partner()) with check (not public.is_partner());
create policy "team full access - daily"
  on public.daily_entries for all to authenticated
  using (not public.is_partner()) with check (not public.is_partner());
create policy "team full access - activities"
  on public.lead_activities for all to authenticated
  using (not public.is_partner()) with check (not public.is_partner());

-- 7) AUTO-MIRROR: closed lead  ->  commission ledger ----------
-- The closer already does all the data entry that matters: set status
-- to 'Closed', pick the deal type, type the collected amount into
-- deal_value. Rather than add a second form someone will forget to
-- fill, mirror that into `closes` with a trigger. Fires no matter how
-- the lead was updated (UI, bulk action, GHL sync).

-- deal_value was added to the live table after the original schema file;
-- make sure it exists before the trigger references it.
alter table public.ghl_leads add column if not exists deal_value numeric(12,2);

-- One ledger row per lead. Partial index so manual, lead-less closes
-- (e.g. a deal that never existed as a CRM lead) are still allowed.
create unique index if not exists uq_closes_lead
  on public.closes(lead_id) where lead_id is not null;

create or replace function public.sync_close_from_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'Closed'
     and new.deal_value is not null and new.deal_value > 0
     -- Guard the enum: a lead carrying any other `deal` string must not
     -- raise a check violation and roll back the closer's edit.
     and new.deal in ('cpa','funded_100k','funded_200k')
  then
    insert into public.closes
      (lead_id, client_name, client_email, deal_type, amount_eur, closer, created_by)
    values
      (new.id, coalesce(nullif(new.name,''),'Klijent'), new.email,
       new.deal, new.deal_value, new.assigned_to, 'auto:crm')
    on conflict (lead_id) where lead_id is not null do update
      set client_name  = excluded.client_name,
          client_email = excluded.client_email,
          deal_type    = excluded.deal_type,
          amount_eur   = excluded.amount_eur,
          closer       = excluded.closer;
          -- closed_on deliberately NOT updated: editing an amount later
          -- must not move the deal into a different commission month.

  elsif tg_op = 'UPDATE' then
    -- Checked in a nested IF, not as `tg_op='UPDATE' and old.status=...`:
    -- OLD is unassigned on INSERT, and referencing it there errors out.
    -- Relying on AND short-circuiting to protect that is too subtle to bet
    -- the closer's ability to save a lead on.
    if old.status = 'Closed' and coalesce(new.status,'') <> 'Closed' then
      -- Reverted out of Closed (mis-click, deal fell through). Withdraw the
      -- auto-created row so it stops counting toward the partner's payout.
      -- Only auto rows: a manually entered close is never touched.
      delete from public.closes
       where lead_id = new.id and created_by = 'auto:crm';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_close_from_lead on public.ghl_leads;
create trigger trg_sync_close_from_lead
  after insert or update of status, deal, deal_value, name, email, assigned_to
  on public.ghl_leads
  for each row execute function public.sync_close_from_lead();

-- Backfill: every already-closed lead that has an amount and a deal type.
insert into public.closes
  (lead_id, client_name, client_email, deal_type, amount_eur, closer,
   closed_on, created_by)
select l.id, coalesce(nullif(l.name,''),'Klijent'), l.email, l.deal, l.deal_value,
       l.assigned_to,
       -- Date the deal actually closed, so historical commission lands in the
       -- right month. The audit log knows when status flipped to 'Closed';
       -- date_added (when the LEAD arrived) is only a last-resort fallback.
       coalesce(
         (select max(a.created_at)::date
            from public.lead_activities a
           where a.lead_id = l.id and a.new_value = 'Closed'),
         l.date_added::date,
         current_date),
       'auto:crm'
  from public.ghl_leads l
 where l.status = 'Closed'
   and l.deal_value is not null and l.deal_value > 0
   and l.deal in ('cpa','funded_100k','funded_200k')
on conflict (lead_id) where lead_id is not null do nothing;

-- 8) REALTIME — so a new close lands in Cjure's view instantly
alter table public.closes replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='closes'
  ) then
    execute 'alter publication supabase_realtime add table public.closes';
  end if;
end $$;

commit;

-- ============================================================
--  VERIFY (run after, in the SQL Editor):
--    select public.is_partner();
--      -> false  (SQL Editor has no JWT, so this is expected)
--
--    -- Did the backfill pick up your existing closed deals?
--    select count(*) as closes, sum(amount_eur) as promet,
--           sum(commission_eur) as cjure_20
--      from public.closes;
--
--    -- Any closed lead the ledger MISSED, and why:
--    select id, name, status, deal, deal_value
--      from public.ghl_leads
--     where status = 'Closed'
--       and id not in (select lead_id from public.closes
--                       where lead_id is not null);
--      -> rows here are closed leads with no deal type or no amount.
--         Fill those two fields in the CRM and they mirror automatically.
-- ============================================================

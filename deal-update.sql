-- ============================================================
--  STRALE — DEAL MENU UPDATE (avgust 2026)
--  Supabase project: gopysmvvfinuvaczyput  (Strale)
--  Run ONCE: Supabase → SQL Editor → paste → Run.
--
--  Companion to the CRM update that ships the full deal menu:
--    funded_10k / 25k / 50k / 100k / 200k / 500k,
--    bot_monthly / bot_yearly, cpa.
--
--  What this does:
--    1. ghl_leads.deal_deposit — the "Depozit / rezervacija" flag
--       behind the new checkbox. Until this runs, the checkbox
--       shows a toast pointing at this file instead of saving.
--    2. Widens closes.deal_type to accept the new deal keys
--       (it currently allows only cpa / funded_100k / funded_200k,
--       so any new-type ledger row would be rejected).
--    3. CPA pays no partner cut: a trigger pins commission_rate
--       to 0 on cpa rows, and the backfill applies the same rule
--       to existing cpa rows. commission_eur is a stored generated
--       column, so Postgres recomputes it from the new rate.
--       Cjure's 20% therefore comes from funded + bot only,
--       which is also how the CRM now sums it.
-- ============================================================

begin;

-- 1) Depozit / rezervacija flag on leads ----------------------
alter table public.ghl_leads
  add column if not exists deal_deposit boolean not null default false;

-- 2) Widen the closes deal_type constraint --------------------
alter table public.closes
  drop constraint if exists closes_deal_type_check;
alter table public.closes
  add constraint closes_deal_type_check
  check (deal_type in (
    'cpa',
    'funded_10k','funded_25k','funded_50k',
    'funded_100k','funded_200k','funded_500k',
    'bot_monthly','bot_yearly'
  ));

-- 3) CPA carries no partner commission ------------------------
create or replace function public.closes_cpa_no_commission()
returns trigger
language plpgsql
as $$
begin
  if new.deal_type = 'cpa' then
    new.commission_rate := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_closes_cpa_no_commission on public.closes;
create trigger trg_closes_cpa_no_commission
  before insert or update of deal_type, commission_rate
  on public.closes
  for each row
  execute function public.closes_cpa_no_commission();

-- Backfill: the rule is "CPA never feeds the partner cut", so it
-- applies to already-recorded cpa rows too. Postgres recomputes
-- commission_eur from the new rate automatically.
update public.closes
  set commission_rate = 0
  where deal_type = 'cpa' and commission_rate <> 0;

commit;

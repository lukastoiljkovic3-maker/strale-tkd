-- ============================================================
--  STRALE — LEGACY "Bot (CPA)" ROWS OWE THE PARTNER CUT
--  Supabase project: gopysmvvfinuvaczyput · Run ONCE in SQL Editor.
--
--  Before the 11.08 deal-menu split, "cpa" was the single bucket for
--  BOT sales and paid Cjure 20%. deal-update.sql correctly zeroed
--  broker-CPA commission, but that also zeroed these pre-split bot
--  rows. This reclassifies rows closed through 09.08.2026 as bot
--  deals at 20%; commission_eur regenerates automatically.
--
--  Rows from 10.08 onward keep whatever the closer picked in the new
--  menu (a deliberate CPA pick stays CPA at 0%).
-- ============================================================
begin;

update public.closes
   set deal_type = 'bot_monthly',
       commission_rate = 0.20
 where deal_type = 'cpa'
   and closed_on <= date '2026-08-09';

commit;

-- If any single row was actually a yearly bot plan, flip just that row:
-- update public.closes set deal_type='bot_yearly' where id='<uuid>';

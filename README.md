# STRALETKD — Sales Tracker

Single-page sales CRM for STRALETKD. Static `index.html` SPA + Vercel serverless
functions in `/api`, backed by GHL (leads + opportunities), Supabase (lead status,
notes, activity log), and Claude (AI lead insights/summaries/messages).

Tabs: **Leads** (pipeline) and **Metrics** (revenue + funnel + time-to-close + AI),
both computed live from GHL. Single closer (Mateja).

## Setup

1. **Supabase** — create a project and run [`supabase-schema.sql`](supabase-schema.sql)
   in the SQL editor (creates `ghl_leads`, `daily_entries`, `lead_activities` + RLS).
   Enable the **Google** auth provider and set the Site URL / redirect to the deployed
   domain. Then set `SUPABASE_URL` + `SUPABASE_KEY` (publishable/anon key) near the top
   of `index.html`.

2. **Vercel env vars** (Project → Settings → Environment Variables):
   - `GHL_TOKEN` — GHL Private Integration token, scopes: **View + Edit Contacts** and
     **View Opportunities**.
   - `ANTHROPIC_API_KEY` — for the AI insight/summary/message endpoints.

3. Deploy. Sign in with Google (any account allowed by your Supabase auth settings).

## GHL

- Location: `oZbpjiMjX93qmnQUFB6R`
- Lead buckets (`api/ghl-leads.js`): qualified = `straletkd-qualified` / `budget-*`,
  booked = `booked-call`, closed = `customer`.
- Revenue (`api/ghl-metrics.js`): opportunities — `won` = collected, `open` = pipeline.

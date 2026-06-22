// GHL calendar appointments — powers the Kalendar view + lead-detail booking block.
// Lists the location's calendars, then fetches events across all of them in a window.
//
// GET /api/ghl-appointments
//   ?start=<ms>      window start (default: now - 7d)
//   ?end=<ms>        window end   (default: now + 30d)
//   ?contactId=<id>  filter to one lead's appointments (for the booking block)
//
// Requires the GHL_TOKEN to have the "View Calendars" + "View Calendar Events"
// (Calendars) scopes. If a scope is missing GHL answers 401/403 — this endpoint
// surfaces that verbatim so the failure is diagnosable from the response.
const GHL_TOKEN = process.env.GHL_TOKEN;
const GHL_LOC   = 'oZbpjiMjX93qmnQUFB6R';
const BASE      = 'https://services.leadconnectorhq.com';
const VERSION   = '2021-04-15';

async function ghl(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: VERSION },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave raw */ }
  return { ok: r.ok, status: r.status, json, text };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const now   = Date.now();
    const start = String(req.query.start || (now - 7  * 864e5));
    const end   = String(req.query.end   || (now + 30 * 864e5));
    const contactId = req.query.contactId || null;

    // 1) List the location's calendars.
    const cal = await ghl(`/calendars/?locationId=${GHL_LOC}`);
    if (!cal.ok) {
      return res.status(cal.status).json({
        error: `calendars list failed (GHL ${cal.status})`,
        detail: (cal.text || '').slice(0, 240),
        hint: 'GHL_TOKEN is likely missing the "View Calendars" scope. Add it in '
            + 'GHL → Settings → Private Integrations, regenerate, update Vercel GHL_TOKEN, redeploy.',
      });
    }
    const calendars = cal.json?.calendars || [];

    // 2) Fetch events per calendar across the window, merge.
    const events = [];
    const errors = [];
    for (const c of calendars) {
      const ev = await ghl(
        `/calendars/events?locationId=${GHL_LOC}&calendarId=${c.id}&startTime=${start}&endTime=${end}`,
      );
      if (!ev.ok) {
        errors.push({ calendarId: c.id, status: ev.status, detail: (ev.text || '').slice(0, 160) });
        continue;
      }
      for (const e of (ev.json?.events || [])) {
        events.push({ ...e, calendarName: c.name });
      }
    }

    // If every calendar errored (e.g. missing events scope), surface it as a failure.
    if (calendars.length && events.length === 0 && errors.length === calendars.length) {
      return res.status(errors[0].status || 403).json({
        error: 'calendar events fetch failed for all calendars',
        hint: 'GHL_TOKEN is likely missing the "View Calendar Events" scope.',
        errors,
      });
    }

    let out = events;
    if (contactId) out = out.filter(e => e.contactId === contactId);
    out.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

    res.status(200).json({
      calendars: calendars.map(c => ({ id: c.id, name: c.name })),
      count: out.length,
      events: out,
      ...(errors.length ? { partialErrors: errors } : {}),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

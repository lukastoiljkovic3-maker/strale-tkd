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


/* ── Blocked slots (POST / DELETE) ──────────────────────────────
   A closer marks a range unavailable in the CRM. A row in our own database
   cannot stop a stranger booking on GHL's public widget, so the range is
   mirrored here as a GHL blocked slot on the booking calendar.
   Lives in this file rather than its own route because Vercel caps the
   project at 12 serverless functions and this is already the calendar
   endpoint.

     POST   /api/ghl-appointments   { startTime, endTime, title? } -> { eventId }
     DELETE /api/ghl-appointments?eventId=<id>                     -> { ok:true }

   Times must be ISO with an explicit offset ("2026-08-05T16:00:00+02:00"),
   which is the format GHL both returns and expects. Needs the GHL_TOKEN to
   carry "Edit Calendar Events"; if it does not, GHL's 401/403 is passed
   through verbatim so the SPA can say exactly what to fix. */
const BOOKING_CALENDAR_ID = 'BATeCPn32yi97i8DYecm';
const BOOKING_USER_ID     = '1tw72QebfDlQpRphLWz0';   // the closer every booking on that calendar is assigned to   // "TKD Investing - Konsultacija"
const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;

async function ghlWrite(path, init) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GHL_TOKEN}`,
      Version: VERSION,
      'Content-Type': 'application/json',
    },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave raw */ }
  return { ok: r.ok, status: r.status, json, text };
}

async function handleBlockWrite(req, res) {
  if (!GHL_TOKEN) return res.status(503).json({ error: 'GHL_TOKEN missing in Vercel env.' });

  if (req.method === 'DELETE') {
    const eventId = String(req.query.eventId || '').trim();
    if (!eventId) return res.status(400).json({ error: 'eventId required' });
    const del = await ghlWrite(`/calendars/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    // A block already gone from GHL is the state we wanted anyway.
    if (!del.ok && del.status !== 404) {
      return res.status(del.status).json({ error: `GHL delete failed (${del.status})`, detail: (del.text || '').slice(0, 240) });
    }
    return res.status(200).json({ ok: true });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const startTime = String(body.startTime || '').trim();
  const endTime   = String(body.endTime || '').trim();
  const title     = String(body.title || 'Zauzeto').slice(0, 120);

  if (!OFFSET_ISO.test(startTime) || !OFFSET_ISO.test(endTime)) {
    return res.status(400).json({ error: 'startTime and endTime must be ISO with offset, e.g. 2026-08-05T16:00:00+02:00' });
  }
  if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
    return res.status(400).json({ error: 'endTime must be after startTime' });
  }

  /* GHL blocks time on a USER, not on a service calendar - posting a
     calendarId here answers "The calendar is not an event calendar". Every
     appointment on the booking calendar is assigned to the same closer, so
     blocking that user removes the slot from the booking widget. */
  let assignedUserId = BOOKING_USER_ID;
  const post = () => ghlWrite('/calendars/events/block-slots', {
    method: 'POST',
    body: JSON.stringify({ locationId: GHL_LOC, assignedUserId, startTime, endTime, title }),
  });
  let created = await post();

  // If that user is gone, re-derive the closer from a recent booking.
  if (!created.ok && (created.status === 404 || created.status === 400 || created.status === 422)) {
    const now = Date.now();
    const ev = await ghl(`/calendars/events?locationId=${GHL_LOC}&calendarId=${BOOKING_CALENDAR_ID}`
                       + `&startTime=${now - 120 * 864e5}&endTime=${now + 60 * 864e5}`);
    const ids = ((ev.ok && ev.json?.events) || []).map(e => e.assignedUserId).filter(Boolean);
    const found = ids.sort((a, b) =>
      ids.filter(x => x === b).length - ids.filter(x => x === a).length)[0];
    if (found && found !== assignedUserId) { assignedUserId = found; created = await post(); }
  }

  if (!created.ok) {
    return res.status(created.status).json({
      error: `GHL block failed (${created.status})`,
      detail: (created.text || '').slice(0, 240),
      hint: (created.status === 401 || created.status === 403)
        ? 'GHL_TOKEN is missing the "Edit Calendar Events" scope. Add it in GHL -> Settings -> Private Integrations, regenerate the token, update GHL_TOKEN in Vercel, redeploy.'
        : undefined,
    });
  }

  const eventId = created.json?.id || created.json?.event?.id || created.json?.data?.id || null;
  return res.status(200).json({ ok: true, eventId, assignedUserId });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET') res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'POST' || req.method === 'DELETE') return handleBlockWrite(req, res);

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

    // 2) Fetch events for every calendar AT ONCE and merge. This used to be a
    //    sequential for-loop, so opening the Kalendar tab paid one GHL
    //    round-trip per calendar - six of them on this location, five of which
    //    are personal calendars that hold no bookings at all. Same data, one
    //    round-trip of latency instead of six.
    const events = [];
    const errors = [];
    const perCal = await Promise.all(calendars.map(c =>
      ghl(`/calendars/events?locationId=${GHL_LOC}&calendarId=${c.id}&startTime=${start}&endTime=${end}`)
        .then(ev => ({ c, ev }))
        .catch(err => ({ c, ev: { ok: false, status: 0, text: String(err && err.message || err) } }))
    ));
    for (const { c, ev } of perCal) {
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

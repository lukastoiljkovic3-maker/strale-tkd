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
const BOOKING_CALENDAR_NAME = 'TKD Investing - Konsultacija';
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

/* ── Reschedule (PUT) ───────────────────────────────────────────
   The closer moves a call to a new time from the lead panel.

     PUT /api/ghl-appointments?eventId=<id>    { startTime, endTime, calendarId?, notify? }
       -> moves that appointment.
     PUT /api/ghl-appointments?contactId=<id>  { startTime, endTime, title?, notify? }
       -> books a fresh call for that contact. Used when the old appointment is
          cancelled or a no-show: moving a dead appointment would erase the fact
          that the lead missed one, so the history stays and a new call is added.

   Times are offset ISO, exactly like the block writes above. Needs "Edit
   Calendar Events" on the GHL_TOKEN.

   ignoreFreeSlotValidation / ignoreDateRange are on deliberately: the CRM
   already refuses a time that collides with another call or a block, and the
   closer has to be able to place a call outside the booking widget's published
   hours or further out than its date range allows. */
async function handleReschedule(req, res) {
  if (!GHL_TOKEN) return res.status(503).json({ error: 'GHL_TOKEN missing in Vercel env.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const eventId    = String(req.query.eventId || '').trim();
  const contactId  = String(req.query.contactId || '').trim();
  const startTime  = String(body.startTime || '').trim();
  const endTime    = String(body.endTime || '').trim();
  const calendarId = String(body.calendarId || '').trim();

  if (!eventId && !contactId) return res.status(400).json({ error: 'eventId or contactId required' });
  if (!OFFSET_ISO.test(startTime) || !OFFSET_ISO.test(endTime)) {
    return res.status(400).json({ error: 'startTime and endTime must be ISO with offset, e.g. 2026-08-05T16:00:00+02:00' });
  }
  if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
    return res.status(400).json({ error: 'endTime must be after startTime' });
  }

  const scopeHint = 'GHL_TOKEN is missing the "Edit Calendar Events" scope. Add it in GHL -> Settings -> Private Integrations, regenerate the token, update GHL_TOKEN in Vercel, redeploy.';
  const base = {
    startTime,
    endTime,
    toNotify: body.notify !== false,   // let GHL send the lead its own reschedule notice
    ignoreFreeSlotValidation: true,
    ignoreDateRange: true,
  };
  const fail = (r, what) => res.status(r.status || 502).json({
    error: `GHL ${what} failed (${r.status})`,
    detail: (r.text || '').slice(0, 240),
    hint: (r.status === 401 || r.status === 403) ? scopeHint : undefined,
  });

  if (eventId) {
    const put = extra => ghlWrite(`/calendars/events/appointments/${encodeURIComponent(eventId)}`, {
      method: 'PUT', body: JSON.stringify({ ...base, ...extra }),
    });
    let moved = await put(calendarId ? { calendarId } : {});
    // Some locations refuse the update unless the calendar is named explicitly.
    if (!moved.ok && !calendarId && (moved.status === 400 || moved.status === 422)) {
      moved = await put({ calendarId: BOOKING_CALENDAR_ID });
    }
    if (!moved.ok) return fail(moved, 'reschedule');
    return res.status(200).json({ ok: true, eventId, startTime, endTime });
  }

  const title = String(body.title || '').slice(0, 120);
  const post = extra => ghlWrite('/calendars/events/appointments', {
    method: 'POST',
    body: JSON.stringify({
      ...base,
      locationId: GHL_LOC,
      calendarId: calendarId || BOOKING_CALENDAR_ID,
      contactId,
      appointmentStatus: 'confirmed',
      ...(title ? { title } : {}),
      ...extra,
    }),
  });
  // Assign to the closer the booking calendar belongs to; if that user is gone,
  // let the calendar's own assignment rules take over rather than failing.
  let created = await post({ assignedUserId: BOOKING_USER_ID });
  if (!created.ok && (created.status === 400 || created.status === 404 || created.status === 422)) {
    created = await post({});
  }
  if (!created.ok) return fail(created, 'booking');

  const j = created.json || {};
  const newId = j.id || j.appointment?.id || j.event?.id || j.data?.id || null;
  return res.status(200).json({ ok: true, eventId: newId, startTime, endTime, created: true });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET') res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'PUT') return handleReschedule(req, res);
  if (req.method === 'POST' || req.method === 'DELETE') return handleBlockWrite(req, res);

  try {
    const now   = Date.now();
    const start = String(req.query.start || (now - 7  * 864e5));
    const end   = String(req.query.end   || (now + 30 * 864e5));
    const contactId = req.query.contactId || null;

    /* Fast path: go straight to the calendar the booking widget writes to.
       Listing every calendar first cost a second sequential GHL round-trip and
       then five more event fetches against personal calendars that have never
       held a booking. One request covers every real appointment; the slow path
       below only runs if that request fails. */
    const fast = await ghl(
      `/calendars/events?locationId=${GHL_LOC}&calendarId=${BOOKING_CALENDAR_ID}`
      + `&startTime=${start}&endTime=${end}`,
    );
    if (fast.ok) {
      let out = (fast.json?.events || []).map(e => ({ ...e, calendarName: BOOKING_CALENDAR_NAME }));
      if (contactId) out = out.filter(e => e.contactId === contactId);
      out.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
      return res.status(200).json({
        calendars: [{ id: BOOKING_CALENDAR_ID, name: BOOKING_CALENDAR_NAME }],
        count: out.length,
        events: out,
      });
    }

    // 1) Slow path — list the location's calendars.
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

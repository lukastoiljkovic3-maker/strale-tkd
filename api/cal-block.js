// Blocked time slots — mirrors a CRM block into the GHL calendar so the public
// booking widget stops offering that range. The CRM's own source of truth is
// public.calendar_blocks in Supabase (written by the SPA); this endpoint only
// keeps GHL in sync, because a row in our database cannot stop a stranger from
// booking on GHL's widget.
//
//   POST   /api/cal-block   { startTime, endTime, title? }   -> { eventId }
//   DELETE /api/cal-block?eventId=<id>                       -> { ok:true }
//
// startTime/endTime must be ISO strings WITH an explicit UTC offset
// ("2026-08-05T16:00:00+02:00"). GHL returns and expects local-offset times;
// the SPA builds them from the closer's own clock, which is the same timezone
// as the calendar.
//
// Requires the GHL_TOKEN to carry the "Edit Calendar Events" (calendars/events.write)
// scope. If it does not, GHL answers 401/403 and this endpoint passes that
// through verbatim so the SPA can tell the user exactly what to fix.
const GHL_TOKEN = process.env.GHL_TOKEN;
const GHL_LOC   = 'oZbpjiMjX93qmnQUFB6R';
const BASE      = 'https://services.leadconnectorhq.com';
const VERSION   = '2021-04-15';

// The calendar the public booking widget writes to. Blocking anywhere else
// would not stop a booking. Falls back to discovery if the id ever changes.
const BOOKING_CALENDAR_ID = 'BATeCPn32yi97i8DYecm';   // "TKD Investing - Konsultacija"

async function ghl(path, init = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GHL_TOKEN}`,
      Version: VERSION,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave raw */ }
  return { ok: r.ok, status: r.status, json, text };
}

/* The booking calendar is the one that is not somebody's personal calendar.
   Used only if BOOKING_CALENDAR_ID stops resolving. */
async function discoverBookingCalendar() {
  const cal = await ghl(`/calendars/?locationId=${GHL_LOC}`);
  if (!cal.ok) return null;
  const list = cal.json?.calendars || [];
  const bookable = list.filter(c => !/personal calendar/i.test(c.name || ''));
  return (bookable[0] || list[0] || {}).id || null;
}

const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!GHL_TOKEN) {
    return res.status(503).json({ error: 'GHL_TOKEN missing in Vercel env.' });
  }

  try {
    if (req.method === 'DELETE') {
      const eventId = String(req.query.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      const del = await ghl(`/calendars/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
      // A block already gone from GHL is the state we wanted anyway.
      if (!del.ok && del.status !== 404) {
        return res.status(del.status).json({
          error: `GHL delete failed (${del.status})`,
          detail: (del.text || '').slice(0, 240),
        });
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

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

    let calendarId = BOOKING_CALENDAR_ID;
    let created = await ghl('/calendars/events/block-slots', {
      method: 'POST',
      body: JSON.stringify({ calendarId, locationId: GHL_LOC, startTime, endTime, title }),
    });

    // Stale calendar id -> find the bookable one and retry once.
    if (!created.ok && (created.status === 404 || created.status === 400)) {
      const found = await discoverBookingCalendar();
      if (found && found !== calendarId) {
        calendarId = found;
        created = await ghl('/calendars/events/block-slots', {
          method: 'POST',
          body: JSON.stringify({ calendarId, locationId: GHL_LOC, startTime, endTime, title }),
        });
      }
    }

    if (!created.ok) {
      return res.status(created.status).json({
        error: `GHL block failed (${created.status})`,
        detail: (created.text || '').slice(0, 240),
        hint: created.status === 401 || created.status === 403
          ? 'GHL_TOKEN is missing the "Edit Calendar Events" scope. Add it in GHL -> Settings -> Private Integrations, regenerate the token, update GHL_TOKEN in Vercel, redeploy.'
          : undefined,
      });
    }

    const eventId = created.json?.id || created.json?.event?.id || created.json?.data?.id || null;
    return res.status(200).json({ ok: true, eventId, calendarId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

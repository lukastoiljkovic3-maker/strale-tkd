// GHL → revenue/clients for the Metrics tab (replaces the old Google Sheet).
// Pulls opportunities and maps them to the row shape the SPA's renderRevenue()
// already expects: { name, challenge, email, date, closer, status }.
//   status: 'polozeno' = won (cash collected) · 'u toku' = open (pipeline)
// Single closer (Mateja), so any assigned opp is labelled "Mateja".

const GHL_TOKEN = process.env.GHL_TOKEN;
const GHL_LOC   = 'oZbpjiMjX93qmnQUFB6R';
const BASE      = 'https://services.leadconnectorhq.com';
const VERSION   = '2021-07-28';

async function fetchAllOpps() {
  const out = [];
  let url = `${BASE}/opportunities/search?location_id=${GHL_LOC}&limit=100`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: VERSION },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`GHL ${res.status}: ${t.slice(0, 200)}`);
    }
    const j = await res.json();
    out.push(...(j.opportunities || []));
    url = j.meta?.nextPageUrl || null;
  }
  return out;
}

function contactName(o) {
  return (
    o.name ||
    o.contact?.name ||
    [o.contact?.firstName, o.contact?.lastName].filter(Boolean).join(' ') ||
    'Nepoznat'
  );
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const opps = await fetchAllOpps();

    const rows = opps
      .filter(o => o.status === 'won' || o.status === 'open')
      .map(o => ({
        name:      contactName(o),
        challenge: Number(o.monetaryValue || 0),
        email:     o.contact?.email || '',
        date:      o.lastStatusChangeAt || o.createdAt || o.dateAdded || null,
        closer:    o.assignedTo ? 'Mateja' : '',
        status:    o.status === 'won' ? 'polozeno' : 'u toku',
      }))
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    // debug: GET /api/ghl-metrics?raw=1 → inspect the opportunity object shape
    if (req.query && req.query.raw === '1') {
      return res.status(200).json({
        count: opps.length,
        statuses: [...new Set(opps.map(o => o.status))],
        keys: Object.keys(opps[0] || {}),
        sample: opps.slice(0, 2),
      });
    }

    res.status(200).json({ rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

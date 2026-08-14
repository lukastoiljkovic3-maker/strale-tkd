const GHL_TOKEN = process.env.GHL_TOKEN;
const GHL_LOC   = 'oZbpjiMjX93qmnQUFB6R';
const BASE      = 'https://services.leadconnectorhq.com';

async function fetchAllContacts() {
  const contacts = [];
  let url = `${BASE}/contacts/?locationId=${GHL_LOC}&limit=100`;

  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GHL_TOKEN}`,
        Version: '2021-07-28',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GHL ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    contacts.push(...(json.contacts || []));
    url = json.meta?.nextPageUrl || null;
  }

  return contacts;
}

/* Custom-field id -> normalized key (e.g. "contact.utm_source" -> "utm_source").
   Lets the frontend read UTM fields by NAME without hardcoding ids, so the
   moment the GHL workflow maps webhook utm data to contact fields, attribution
   flows into the CRM with zero code changes. */
async function fetchCustomFieldNames() {
  try {
    const res = await fetch(`${BASE}/locations/${GHL_LOC}/customFields`, {
      headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: '2021-07-28' },
    });
    if (!res.ok) return {};
    const json = await res.json();
    const map = {};
    (json.customFields || []).forEach(f => {
      const key = String(f.fieldKey || f.name || '')
        .replace(/^contact\./, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (f.id && key) map[f.id] = key;
    });
    return map;
  } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1200');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const [all, cfNames] = await Promise.all([fetchAllContacts(), fetchCustomFieldNames()]);

    const hasTag = (c, ...tags) => tags.some(t => c.tags?.includes(t));

    // STRALETKD VSL funnel buckets (no webinars)
    const qualified    = all.filter(c => hasTag(c, 'straletkd-qualified', 'budget-100-300', 'budget-300-1000', 'budget-1000-plus'));
    const disqualified = all.filter(c => hasTag(c, 'straletkd-disqualified', 'budget-under-100', 'dq'));
    const booked       = all.filter(c => hasTag(c, 'booked-call'));
    const customer     = all.filter(c => hasTag(c, 'customer'));

    res.status(200).json({ qualified, disqualified, booked, customer });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const all = await fetchAllContacts();

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

// Generate a personalized Serbian WhatsApp message for a lead.
// POST body: { lead: {...}, scenario?: 'first-touch' | 'no-pickup' | 'asked-info' | 'cant-now' | 'post-call' | 'closing-nudge' }
//   → { message }
const MODEL = 'claude-haiku-4-5';

// ─────────────────── STRALETKD — SETTER VOICE ─────────────────────
// Setter ton: chill, never chases, confident. We don't pursue leads —
// they pursue us. Every message qualifies whether the lead is a fit,
// not whether they'll buy. Casual, friend-to-friend Serbian. Logic
// over pressure. Mi nikog ne jurimo puskom — idi kod drugih slobodno.
//
// Key playbook phrases capturing the energy:
//   "Idi kod drugih slobodno, mi nikog ne jurimo puskom da dodje kod nas"
//   "Ja nemam magicni stapic i nisam deda mraz"
//   "Ajde da odemo na poziv da vidimo sta je najbolja opcija za tebe?"
// ────────────────────────────────────────────────────────────────

const SCENARIO_PROMPTS = {
  'first-touch': `Ovo je PRVA poruka leadu koji je popunio prijavu preko VSL-a (i možda zakazao poziv).

Format (drži se ovog tačno):
"Ćao [ime], ovde [rep] iz STRALETKD tima, vidim da si popunio prijavu. Jel imaš sekund?"

Ako je već zakazao poziv:
"Ćao [ime], ovde [rep] iz STRALETKD tima, vidim da si zakazao poziv. Jel imaš sekund?"

Ako ime nije poznato — preskoči ", [ime]".
Ako rep nije poznat — koristi "javljam ti se" umesto "ovde [rep]".

Vrati SAMO tekst poruke, 2 rečenice maksimum.`,

  'no-pickup': `Ti, lično, si pokušao da pozoveš leada, on se nije javio. Sada mu pišeš WhatsApp poruku.

KRITIČNO za razumevanje:
- TI (rep iz konteksta) si onaj koji je zvao. Ne neko drugi.
- Ne pričaš o sebi u 3. licu, ne pominješ ime rep-a u poruci.
- Ne pominješ druge ljude iz tima.

VIBE:
- Mi ne jurimo nikoga. Ovo nije "molim te javi se", ovo je "ako te zanima — znaš gde sam".
- Mirno, kratko, bez izvinjavanja, bez molbi.
- Maks 1-2 rečenice. NIKAD više.

Primeri dobre energije (ti si onaj koji piše, ne pominješ svoje ime):
"[ime], probao sam da te dobijem ali se nisi javio. Kad budeš slobodan javi mi se."
"[ime], nisam uspeo da te dobijem. Javi mi se kad možeš."
"Pokušao sam [ime], slobodno se javi kad ti odgovara."

NIKAD:
- "Molim te"
- "Čuo sam za tebe od [neko]"  ← TI si zvao, nije te neko drugi pominjao
- "Bilo bi super da..."
- "Čekam tvoju poruku"`,

  'asked-info': `Lead je pre nekoliko dana tražio info pa nije odgovorio. Ovo je nudge.

VIBE:
- Bez pritiska, bez podsećanja "Hej, šaljem ti opet info!".
- Postavi pitanje koje ga vraća u razgovor, ne dodatni info.
- Kvalifikuj — da li je on uopšte ozbiljan.
- Maks 2 kratke rečenice.

Primeri:
"[ime], jesi pogledao ono? Pitaj ako nešto nije jasno."
"Ej [ime], stigao si da razmisliš? Ako je za tebe — okej, ako ne — slobodno."
"[ime], jesi imao priliku ono da vidiš?"

NIKAD:
- Ne ponavljaj info koji si već poslao.
- Ne preklinji za odgovor.`,

  'cant-now': `Lead je ranije rekao "ne mogu sad" (timing, novac, vreme). Posle pauze.

VIBE — najvažnije:
- Pričaš kao s drugarom posle par meseci. Nema sales-a, nema pressure-a.
- Pitanje treba da otvori vrata, ne da zatvori prodaju.
- Lagana energija — "samo da čujem kako si, ne moraš ništa".
- Maks 2 rečenice.

Primeri:
"[ime], šta ima novo? Da li još uvek razmišljaš o ovome ili je leglo na čekanje?"
"Ej [ime], kako si? Prošlo je već neko vreme, je li za tebe trenutak bolji sada?"
"[ime], javljam ti se posle nekog vremena. Šta se dešava kod tebe?"

NIKAD:
- "Ponuda je istekla"
- "Imam specijalan deal za tebe"
- "Sada je idealan trenutak"`,

  'post-call': `Imali ste poziv. Lead razmišlja, nije još odlučio. Ovo je check-in posle 1-2 dana.

VIBE — kritično:
- Mi ne guramo. Lead sam odlučuje. Naša poruka je samo provera.
- Nikad ne ponavljaj prodajne argumente sa poziva.
- Pitaj otvoreno, daj mu prostor da kaže ne.
- Maks 2 rečenice.

Primeri:
"[ime], šta si zaključio? Slobodno reci ako nije za tebe."
"Ej [ime], jesi razmislio? Kako stojiš?"
"[ime], gde si sa odlukom? Ako ti treba još nešto da vidiš — kaži."

NIKAD:
- "Samo da te podsetim..."
- Ponavljanje funded/cene/garancije
- "Ovo je odlična prilika..."`,

  'closing-nudge': `Lead ima sve info, već warm, sada čeka da odluči. Finalni nudge.

VIBE — direktno ali bez pritiska:
- Direktno pitanje za odluku. Bez "molim te kupi".
- Energija: "ja imam svoj posao da radim, treba mi tvoj odgovor da znam jel idemo".
- Maks 2 rečenice.

Primeri:
"[ime], šta kažeš — krećemo ili ne? Treba mi samo da znam."
"[ime], jesi spreman da krenemo ili još uvek razmišljaš?"
"Ajde [ime], da završimo to. Ako je da — šaljem ti link, ako ne — okej, slobodno."

NIKAD:
- "Specijalna ponuda samo danas"
- "Cena raste sutra"
- Emocionalne ucene`,
};

const BASE_RULES = `OPŠTA PRAVILA — STRIKTNO (STRALETKD — SETTER VOICE):

JEZIK & FORMAT:
- ISKLJUČIVO srpski, latinica.
- BEZ EMOJI-ja. Ni jednog. Nikad.
- Pričaj kao Srbin srpskom, neformalno (ti, ne Vi).
- Maks 2 rečenice (3 samo izuzetno).

ZABRANJENO (NIKAD):
- Ne pominji "webinar"/"predavanje" — Strale nema predavanja, lead je došao preko VSL-a.
- "Funded", "signali", cene, "paketi", "challenge" u prvoj poruci.
- Velika obećanja ("zaradi", "uspeh", "transformacija", "promeniće ti život").
- Sales fraze ("specijalna ponuda", "ne propusti", "idealna prilika", "ekskluzivno").
- Molbe i izvinjavanja ("molim te", "izvini što smetam", "samo da te podsetim").
- "Kada ti odgovara da se čujemo na 10 min".
- Generičnost ("javljam se da pitam jesi razmislio").

SETTER VIBE — OBAVEZNO:
- Chill, opušteno, nikad u žurbi.
- Mi ne jurimo nikoga. Lead nas zove, ne mi njega.
- Confidence: "ako je za tebe — okej, ako nije — slobodno idi dalje".
- Kvalifikacija > closing. Pitanja koja proveravaju da li je on za nas, ne da li mi njemu treba.

Vrati SAMO tekst poruke, bez navodnika, bez objašnjenja, bez potpisa.`;

const ASKFX_KB = `
=== CJURE / CjureFX (Marko Ćurguz, @cjuree) ===
Offer: AI Trading Bot (Trading AI Mind, tradingaimind.com) + funded nalozi. Jezik: srpski (ekavica).
Funnel: cjurefx.org (webinar optin) -> /pitanja kvalifikacija -> WhatsApp grupa; poziv se zakazuje na cjurefx.org/zakazi (30 min, besplatan).
Paketi: funded nalog (npr. 100.000 EUR nalog = 1.000 EUR jednokratno) + pristup botu: mesečni plan, godišnji plan ili doživotni (lifetime, npr. 2.000 EUR jednokratno). VIP grupa sa signalima kao bonus.
Bot: radi automatizovano na MT5, XAUUSD fokus, klijent dobija podešavanja od tima (nikad sam ne podešava). Radi i na malim i na funded nalozima.
Funded nalozi: preko prop firmi (npr. Tradova), do 500.000 EUR tuđeg kapitala. KYC obavezan. Isplate vrši prop firma po svojim pravilima.
Garancija zamene: ako bot sa ZVANIČNIM podešavanjima spali funded nalog (bez ručnih trejdova/izmena), firma o svom trošku daje nov nalog iste vrednosti (30 dana, uz proveru istorije trgovanja).
Pravno lice: CJR TOP STRIKER LLC. Ugovor se potpisuje pre uplate.
Social proof: testimonijali na cjurefx.org/david (isplata $2.781) i /miodrag ($1.200 sa Tradove); rezultati članova u kanalima.

=== MAMINJO / MaminjoFX (Leo Alagić, @maminjjo) ===
Jezik: hrvatski (standardni HR). Zajednica 20.000+ članova, signali od 2018, 5-7 signala dnevno.
Offer: besplatni webinar (maminjo.com) -> pitanja (/pitanja) -> WhatsApp grupa (/hvala). Na webinaru: kako čitaju tržište, ulasci/izlasci, risk management, AI bot uživo na pravom računu, put do funded računa.
Posle webinara prodaja: pristup botu + signali + edukacija (uslovi po aktuelnoj ponudi tima).
Ton: bez obećanja zarade, edukativno, "sustav iza signala".

=== STRALE / StraleTKD ===
Jezik: srpski. Offer: precizni forex signali + pristup funded nalozima do $200.000 bez depozita.
Funnel: straletkd.com (VSL + typeform prijava) -> kvalifikovani idu na /hvala sa GHL kalendarom (zakazivanje poziva) -> /booked potvrda; nekvalifikovani idu u besplatnu Telegram grupu (t.me/tkdvision1).
Partnerstvo: Cjure uzima 20% od svakog Strale close-a (bot + funded); CPA dealovi bez provizije.
Bot: isti AI trading bot (Tradova), H1 za forex parove, H4 za XAUUSD.

=== ZAJEDNIČKA PRAVILA ZA TIM ===
- NIKAD ne obećavaj zaradu, profit ni "garantovane" prinose. Trading nosi rizik. Prošli rezultati nisu garancija.
- Cene i uslovi iz ugovora su merodavni; ako nisi siguran za cenu, reci da proveriš sa Lukom/Markom.
- Poziv je konsultativan: situacija, cilj, kapital, pa preporuka paketa.
- Isplate uvek radi prop firma / platforma, ne mi.
- DQ lead (dq/low-value tag): ne gurati na poziv, uputiti na besplatnu grupu i sadržaj.
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY missing' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  /* Ask FX AI mode: internal knowledge assistant for the dialer team. */
  if (body && body.ask === true) {
    const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    if (!messages.length) return res.status(400).json({ error: 'No messages' });
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 700,
          system: `Ti si "FX AI", interni asistent za sales/dialer tim agencije 2Busy. Odgovaraš na pitanja o tri ponude: CJURE, MAMINJO i STRALE, isključivo na osnovu baze znanja ispod. Odgovaraj kratko, konkretno i praktično, na srpskom (za Maminjo pitanja možeš na hrvatskom). Ako nešto nije u bazi, reci iskreno da ne znaš i da se proveri sa Lukom. Nikad ne obećavaj zaradu.\n\nBAZA ZNANJA:\n${ASKFX_KB}`,
          messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
        }),
      });
      const json = await r.json();
      if (!r.ok) return res.status(500).json({ error: json.error?.message || `Anthropic ${r.status}` });
      const answer = (json.content || []).map(c => c.text || '').join('').trim();
      if (!answer) return res.status(500).json({ error: 'Empty response' });
      return res.status(200).json({ answer });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }


  const lead = body.lead || {};
  const scenario = body.scenario || 'first-touch';
  const scenarioPrompt = SCENARIO_PROMPTS[scenario] || SCENARIO_PROMPTS['first-touch'];

  const firstName = (lead.name || '').split(' ')[0] || '';
  const repName = lead.assigned_to === 'nikola' ? 'closer-goat' : '';
  const booked = (lead.tags || []).includes('booked-call');

  const ctx = [];
  if (lead.experience)    ctx.push(`Iskustvo: ${lead.experience}`);
  if (lead.knowledge)     ctx.push(`Nivo znanja: ${lead.knowledge}`);
  if (lead.time_frame)    ctx.push(`Vremenski okvir: ${lead.time_frame}`);
  if (lead.pain_point)    ctx.push(`Pain point: ${lead.pain_point}`);
  if (lead.qualification) ctx.push(`Kvalifikacija: ${lead.qualification}`);
  if (lead.notes)         ctx.push(`Beleške rep-a: ${lead.notes}`);

  const systemPrompt = scenarioPrompt + '\n\n' + BASE_RULES;
  const userPrompt = `Lead:
Ime: ${firstName || 'nepoznato'}
${repName ? `Šalje: ${repName}` : ''}
${booked ? 'Zakazao poziv: DA' : 'Zakazao poziv: NE/nepoznato'}
${ctx.length ? ctx.join('\n') : '(Nema dodatnih detalja.)'}

Napiši poruku.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: `Claude API ${r.status}: ${t.slice(0, 240)}` });
    }
    const json = await r.json();
    const message = (json.content || []).map(c => c.text || '').join('').trim();
    if (!message) return res.status(500).json({ error: 'Empty AI response' });
    res.status(200).json({ message, scenario });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

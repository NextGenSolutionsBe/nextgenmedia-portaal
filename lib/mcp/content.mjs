/**
 * De inhoud van de MCP-connector: welke gereedschappen er zijn en wat ze
 * teruggeven.
 *
 * Bewust los van hoe de connector bereikt wordt. Er zijn twee ingangen — een
 * lokaal programma via stdin/stdout (mcp/nextgenmedia-server.mjs) en een route
 * op het internet (app/api/mcp/[sleutel]) — en die moeten exact hetzelfde
 * antwoorden. Eén bestand met de logica is de enige manier om dat vol te houden.
 *
 * Bewust .mjs en geen .ts: zo kan zowel het losse Node-programma als de
 * Next-route het rechtstreeks importeren, zonder bouwstap ertussen.
 *
 * READ-ONLY. Hier wordt nooit naar de database geschreven.
 */

export const normaliseer = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** "2026-07" → "2026-07-01"; als einde → de laatste dag van die maand.
 *  "juli" zonder jaar weigeren we bewust: raden welk jaar iemand bedoelt geeft
 *  stille fouten, en dan krijg je content van vorig jaar zonder het te merken. */
export function alsDatum(waarde, kant) {
  const s = String(waarde ?? '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}$/.test(s)) {
    if (kant === 'tot') {
      const [j, m] = s.split('-').map(Number)
      const dag = new Date(j, m, 0).getDate()
      return `${s}-${String(dag).padStart(2, '0')}`
    }
    return `${s}-01`
  }
  throw new Error(`"${waarde}" is geen bruikbare datum. Gebruik JJJJ-MM-DD of JJJJ-MM.`)
}

/**
 * Elk tekstveld dat inhoud kan hebben, met het label dat de gebruiker ziet.
 *
 * DIT IS DE KERN VAN DE CONNECTOR. In de praktijk staat de scripttekst lang niet
 * altijd in `script`: bij Metaalwerken Bartels staan 39 items met nul gevulde
 * scripts, terwijl de volledige teksten in `media_notes` staan. Zou je alleen
 * naar `script` kijken, dan krijg je niets terug en denk je dat er geen content
 * is. Daarom komt alles mee, mét vermelding van waar het vandaan komt.
 */
export const TEKSTVELDEN = [
  ['script', 'Script'],
  ['media_notes', 'Media / script-notities'],
  ['caption', 'Caption'],
  ['body', 'Tekst'],
  ['client_feedback', 'Feedback van de klant'],
]

export function itemAlsTekst(item, nr) {
  const kop = [
    `### ${nr}. ${item.planned_date ?? 'geen datum'} — ${item.title ?? '(zonder titel)'}`,
    [
      item.content_type ? `type: ${item.content_type}` : null,
      Array.isArray(item.platforms) && item.platforms.length ? `platforms: ${item.platforms.join(', ')}` : null,
      item.status ? `status: ${item.status}` : null,
    ].filter(Boolean).join(' · '),
  ].filter(Boolean)

  const delen = []
  for (const [kolom, label] of TEKSTVELDEN) {
    const waarde = String(item[kolom] ?? '').trim()
    if (waarde) delen.push(`**${label}**\n${waarde}`)
  }
  if (delen.length === 0) delen.push('_(geen tekst ingevuld bij dit item)_')

  return [...kop, '', ...delen].join('\n')
}

/** Bovengrens per oproep. Bij meer zeggen we het, in plaats van stil af te kappen. */
export const MAX_ITEMS = 300

export const TOOLS = [
  {
    name: 'klanten',
    description:
      'Alle klanten waarvan er content in het portaal staat, met het aantal items en de periode ' +
      'die beschikbaar is. Gebruik dit om een klantnaam te controleren of te zien welke maanden er zijn.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'content_ophalen',
    description:
      'Alle socialmediacontent van één klant over een periode, met ÀLLE ingevulde tekstvelden: ' +
      'script, media-/scriptnotities, caption, tekst en klantfeedback. Gebruik dit om alles van een ' +
      'klant over een aantal maanden in één keer op te halen, bijvoorbeeld om er posts van te laten ' +
      'opmaken. Let op: de scripttekst staat lang niet altijd in het veld "script" — vaak staat hij ' +
      'bij de media-notities. Daarom komt alles mee.',
    inputSchema: {
      type: 'object',
      properties: {
        klant: { type: 'string', description: 'Naam van de klant, bv. "Metaalwerken Bartels". Deels mag ook.' },
        van: { type: 'string', description: 'Begin van de periode: JJJJ-MM-DD of JJJJ-MM. Weglaten = vanaf het begin.' },
        tot: { type: 'string', description: 'Einde van de periode: JJJJ-MM-DD of JJJJ-MM (hele maand). Weglaten = tot het einde.' },
        alleen_met_tekst: {
          type: 'boolean',
          description: 'Alleen items die ergens tekst hebben staan. Standaard false: dan zie je ook de lege, zodat je weet wat er nog ontbreekt.',
        },
      },
      required: ['klant'],
      additionalProperties: false,
    },
  },
]

async function klantenMetContent(sb) {
  const { data, error } = await sb
    .from('social_content_items')
    .select('client_id, planned_date, clients ( company_name )')
  if (error) throw new Error(error.message)

  const per = new Map()
  for (const rij of data ?? []) {
    const naam = rij.clients?.company_name ?? '(zonder naam)'
    const b = per.get(rij.client_id) ?? { id: rij.client_id, naam, items: 0, van: null, tot: null }
    b.items++
    const d = rij.planned_date
    if (d) {
      if (!b.van || d < b.van) b.van = d
      if (!b.tot || d > b.tot) b.tot = d
    }
    per.set(rij.client_id, b)
  }
  return [...per.values()].sort((a, b) => a.naam.localeCompare(b.naam))
}

/** Klantnaam oplossen. Bij twijfel geven we de kandidaten terug in plaats van er
 *  zelf een te kiezen — de verkeerde klant teruggeven is erger dan doorvragen. */
async function zoekKlant(sb, naam) {
  const alle = await klantenMetContent(sb)
  const z = normaliseer(naam)
  if (!z) throw new Error('Geef een klantnaam op.')

  const exact = alle.filter((k) => normaliseer(k.naam) === z)
  if (exact.length === 1) return exact[0]

  const bevat = alle.filter((k) => normaliseer(k.naam).includes(z) || z.includes(normaliseer(k.naam)))
  if (bevat.length === 1) return bevat[0]
  if (bevat.length > 1) {
    throw new Error(`"${naam}" past op meerdere klanten: ${bevat.map((k) => k.naam).join(', ')}. Wees specifieker.`)
  }
  throw new Error(`Geen klant gevonden voor "${naam}". Bekend zijn: ${alle.map((k) => k.naam).join(', ')}.`)
}

/**
 * Eén gereedschap uitvoeren. `sb` is een Supabase-client; elke ingang levert
 * zijn eigen exemplaar aan.
 */
export async function roepTool(sb, naam, args = {}) {
  if (naam === 'klanten') {
    const lijst = await klantenMetContent(sb)
    if (lijst.length === 0) return 'Er staat nog geen content in het portaal.'
    return [
      `${lijst.length} klant(en) met content:`,
      '',
      ...lijst.map((k) => `- **${k.naam}** — ${k.items} items, ${k.van ?? '?'} t/m ${k.tot ?? '?'}`),
    ].join('\n')
  }

  if (naam === 'content_ophalen') {
    const klant = await zoekKlant(sb, args?.klant)
    const van = alsDatum(args?.van, 'van')
    const tot = alsDatum(args?.tot, 'tot')

    let q = sb
      .from('social_content_items')
      .select('planned_date, title, content_type, platforms, status, script, media_notes, caption, body, client_feedback')
      .eq('client_id', klant.id)
      .order('planned_date', { ascending: true })
      .limit(MAX_ITEMS + 1)
    if (van) q = q.gte('planned_date', van)
    if (tot) q = q.lte('planned_date', tot)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    let items = data ?? []
    const afgekapt = items.length > MAX_ITEMS
    if (afgekapt) items = items.slice(0, MAX_ITEMS)

    const heeftTekst = (i) => TEKSTVELDEN.some(([k]) => String(i[k] ?? '').trim())
    const metTekst = items.filter(heeftTekst)
    const getoond = args?.alleen_met_tekst ? metTekst : items

    const periode = van || tot ? `${van ?? 'begin'} t/m ${tot ?? 'einde'}` : 'volledige periode'

    if (items.length === 0) {
      return `Geen content gevonden voor **${klant.naam}** in ${periode}. ` +
        `Er is wel materiaal van ${klant.van ?? '?'} t/m ${klant.tot ?? '?'}.`
    }

    // De telling vóór de inhoud: als er weinig tekst is, moet dat meteen
    // duidelijk zijn en niet pas nadat je door twintig lege items gescrold hebt.
    //
    // LET OP bij het aanpassen: filter hier GEEN lege regels weg. Die lege
    // strings zijn de witregels; wegfilteren plakt de kop tegen het eerste item
    // aan en je krijgt "24 zonder.---### 1.".
    const regels = [
      `# ${klant.naam} — ${periode}`,
      '',
      `${items.length} item(s), waarvan **${metTekst.length} met tekst** en ${items.length - metTekst.length} zonder.`,
    ]
    if (metTekst.length === 0) {
      regels.push('', '> Let op: bij geen enkel item staat tekst ingevuld — niet in script, niet bij de media-notities, nergens.')
    }
    if (afgekapt) {
      regels.push('', `> Er zijn er meer dan ${MAX_ITEMS}; enkel de eerste ${MAX_ITEMS} staan hieronder. Vraag een kortere periode voor de rest.`)
    }
    regels.push('', '---', '')

    return regels.join('\n') + '\n'
      + getoond.map((it, n) => itemAlsTekst(it, n + 1)).join('\n\n---\n\n') + '\n'
  }

  throw new Error(`Onbekend gereedschap: ${naam}`)
}

/**
 * Eén JSON-RPC-bericht afhandelen. Geeft het antwoordobject terug, of null bij
 * een melding (die verwacht geen antwoord).
 *
 * Gedeeld door beide ingangen, zodat een client via het internet exact hetzelfde
 * protocol ziet als een client op de eigen machine.
 */
export async function behandelBericht(sb, bericht) {
  const { id, method, params } = bericht ?? {}
  if (id === undefined || id === null) return null

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'nextgenmedia-portaal', version: '1.1.0' },
        },
      }
    }
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
    if (method === 'tools/call') {
      const tekst = await roepTool(sb(), params?.name, params?.arguments ?? {})
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: tekst }] } }
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Onbekende methode: ${method}` } }
  } catch (e) {
    const boodschap = e instanceof Error ? e.message : String(e)
    // Een fout in een gereedschap teruggeven als resultaat, niet als
    // protocolfout: dan ziet de gebruiker wát er misging in plaats van enkel
    // "de connector doet het niet".
    if (method === 'tools/call') {
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Fout: ${boodschap}` }], isError: true } }
    }
    return { jsonrpc: '2.0', id, error: { code: -32603, message: boodschap } }
  }
}

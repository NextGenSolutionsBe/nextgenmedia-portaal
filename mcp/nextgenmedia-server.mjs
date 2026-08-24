#!/usr/bin/env node
/**
 * MCP-connector voor het NextGenMedia-portaal.
 *
 * Waarvoor: content van een klant over een periode ophalen en er alles uithalen
 * wat er staat, zodat je het in één keer kan doorgeven aan iets dat er posts van
 * maakt.
 *
 * DE REDEN DAT DIT ALLE VELDEN TERUGGEEFT en niet enkel `script`: in de praktijk
 * staat de tekst niet altijd waar je hem verwacht. Bij Metaalwerken Bartels
 * bijvoorbeeld staat de volledige scripttekst in `media_notes` en is `script`
 * leeg — 39 items, nul scripts, terwijl de teksten er wel degelijk zijn. Een
 * connector die alleen naar `script` kijkt, geeft dan niets terug en je denkt
 * dat er geen content is. Daarom halen we élk gevuld tekstveld op en zetten we
 * erbij waar het vandaan komt.
 *
 * READ-ONLY. Deze server schrijft nooit naar de database.
 *
 * Bewust zonder extra afhankelijkheden: JSON-RPC over stdin/stdout doen we zelf,
 * en @supabase/supabase-js zit al in het project. Zo groeit de bundel van de app
 * niet mee met dit hulpmiddel.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const HIER = dirname(fileURLToPath(import.meta.url))
const PROJECT = join(HIER, '..')

// ── Omgeving ────────────────────────────────────────────────────────────────
// .env.local wint van .env, net als bij Next.js.
function laadEnv() {
  for (const naam of ['.env', '.env.local']) {
    const pad = join(PROJECT, naam)
    if (!existsSync(pad)) continue
    for (const regel of readFileSync(pad, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(regel)
      if (!m) continue
      const waarde = m[2].trim().replace(/^["']|["']$/g, '')
      if (waarde) process.env[m[1]] = waarde
    }
  }
}
laadEnv()

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/** Alles naar stderr: stdout is het protocolkanaal en mag niets anders bevatten. */
const log = (...a) => process.stderr.write(a.join(' ') + '\n')

let db = null
function supabase() {
  if (!URL_ || !KEY) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt. ' +
      'Zet ze in .env.local in de projectmap, of geef ze mee als omgevingsvariabelen.',
    )
  }
  if (!db) db = createClient(URL_, KEY, { auth: { persistSession: false }, db: { schema: 'public' } })
  return db
}

// ── Hulpjes ─────────────────────────────────────────────────────────────────
export const normaliseer = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** "2026-07" → "2026-07-01"; "juli" zonder jaar laten we bewust aan de kant die
 *  belt, want raden welk jaar iemand bedoelt levert stille fouten op. */
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

async function klantenMetContent() {
  const sb = supabase()
  const { data, error } = await sb
    .from('social_content_items')
    .select('client_id, planned_date, clients ( company_name )')
  if (error) throw new Error(error.message)

  const per = new Map()
  for (const rij of data ?? []) {
    const naam = rij.clients?.company_name ?? '(zonder naam)'
    const bestaand = per.get(rij.client_id) ?? { id: rij.client_id, naam, items: 0, van: null, tot: null }
    bestaand.items++
    const d = rij.planned_date
    if (d) {
      if (!bestaand.van || d < bestaand.van) bestaand.van = d
      if (!bestaand.tot || d > bestaand.tot) bestaand.tot = d
    }
    per.set(rij.client_id, bestaand)
  }
  return [...per.values()].sort((a, b) => a.naam.localeCompare(b.naam))
}

/** Klantnaam oplossen. Bij twijfel geven we de kandidaten terug in plaats van
 *  er zelf een te kiezen — de verkeerde klant teruggeven is erger dan vragen. */
async function zoekKlant(naam) {
  const alle = await klantenMetContent()
  const z = normaliseer(naam)
  if (!z) throw new Error('Geef een klantnaam op.')

  const exact = alle.filter((k) => normaliseer(k.naam) === z)
  if (exact.length === 1) return exact[0]

  const bevat = alle.filter((k) => normaliseer(k.naam).includes(z) || z.includes(normaliseer(k.naam)))
  if (bevat.length === 1) return bevat[0]
  if (bevat.length > 1) {
    throw new Error(
      `"${naam}" past op meerdere klanten: ${bevat.map((k) => k.naam).join(', ')}. Wees specifieker.`,
    )
  }
  throw new Error(
    `Geen klant gevonden voor "${naam}". Bekend zijn: ${alle.map((k) => k.naam).join(', ')}.`,
  )
}

/** Elk tekstveld dat inhoud heeft, met de kolom erbij zodat duidelijk is waar
 *  het vandaan komt. Dat laatste is niet cosmetisch: het verklaart waarom een
 *  script soms onder "media notities" staat. */
const TEKSTVELDEN = [
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

// ── De gereedschappen ───────────────────────────────────────────────────────
const TOOLS = [
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

/** Bovengrens per oproep. Bij meer zeggen we het, in plaats van stil af te kappen. */
const MAX_ITEMS = 300

async function roepTool(naam, args) {
  if (naam === 'klanten') {
    const lijst = await klantenMetContent()
    if (lijst.length === 0) return 'Er staat nog geen content in het portaal.'
    return [
      `${lijst.length} klant(en) met content:`,
      '',
      ...lijst.map((k) => `- **${k.naam}** — ${k.items} items, ${k.van ?? '?'} t/m ${k.tot ?? '?'}`),
    ].join('\n')
  }

  if (naam === 'content_ophalen') {
    const klant = await zoekKlant(args?.klant)
    const van = alsDatum(args?.van, 'van')
    const tot = alsDatum(args?.tot, 'tot')

    const sb = supabase()
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
    const kop = [
      `# ${klant.naam} — ${periode}`,
      '',
      `${items.length} item(s), waarvan **${metTekst.length} met tekst** en ${items.length - metTekst.length} zonder.`,
      metTekst.length === 0
        ? '\n> Let op: bij geen enkel item staat tekst ingevuld — niet in script, niet bij de media-notities, nergens.'
        : '',
      afgekapt ? `\n> Er zijn er meer dan ${MAX_ITEMS}; enkel de eerste ${MAX_ITEMS} staan hieronder. Vraag een kortere periode voor de rest.` : '',
      '',
      '---',
      '',
    ].filter((r) => r !== '').join('\n')

    return kop + getoond.map((i, n) => itemAlsTekst(i, n + 1)).join('\n\n---\n\n')
  }

  throw new Error(`Onbekend gereedschap: ${naam}`)
}

// ── JSON-RPC over stdio ─────────────────────────────────────────────────────
function stuur(bericht) {
  process.stdout.write(JSON.stringify(bericht) + '\n')
}

async function behandel(bericht) {
  const { id, method, params } = bericht

  // Meldingen verwachten geen antwoord.
  if (id === undefined || id === null) return

  try {
    if (method === 'initialize') {
      return stuur({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'nextgenmedia-portaal', version: '1.0.0' },
        },
      })
    }
    if (method === 'ping') return stuur({ jsonrpc: '2.0', id, result: {} })
    if (method === 'tools/list') return stuur({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    if (method === 'tools/call') {
      const tekst = await roepTool(params?.name, params?.arguments ?? {})
      return stuur({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: tekst }] } })
    }
    return stuur({ jsonrpc: '2.0', id, error: { code: -32601, message: `Onbekende methode: ${method}` } })
  } catch (e) {
    const boodschap = e instanceof Error ? e.message : String(e)
    log('[fout]', boodschap)
    // Als tool-fout terugsturen, niet als protocolfout: dan ziet de gebruiker
    // wát er misging in plaats van "de connector doet het niet".
    if (method === 'tools/call') {
      return stuur({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: `Fout: ${boodschap}` }], isError: true },
      })
    }
    return stuur({ jsonrpc: '2.0', id, error: { code: -32603, message: boodschap } })
  }
}

// Alleen luisteren wanneer dit bestand als programma draait. Bij een import
// (de tests) willen we enkel de functies, geen server die op stdin blijft wachten.
const RECHTSTREEKS = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (RECHTSTREEKS) {
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (stuk) => {
  buffer += stuk
  let n
  while ((n = buffer.indexOf('\n')) >= 0) {
    const regel = buffer.slice(0, n).trim()
    buffer = buffer.slice(n + 1)
    if (!regel) continue
    let bericht
    try { bericht = JSON.parse(regel) } catch { log('[fout] onleesbaar bericht'); continue }
    behandel(bericht)
  }
})
process.stdin.on('end', () => process.exit(0))

log('nextgenmedia-portaal MCP-server gestart' + (URL_ && KEY ? '' : ' — LET OP: Supabase-omgeving ontbreekt'))
}

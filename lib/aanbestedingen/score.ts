import 'server-only'
import { createHash } from 'node:crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

/**
 * Voorselectie: elke opdracht een score van 0 tot 100, op titel, omschrijving
 * en CPV-code alleen. Geen bestekken, geen bijlagen.
 *
 * Waarom apart van de volledige analyse: een filter levert al snel honderden
 * opdrachten op en de meeste zijn meteen duidelijk niets voor ons. Die met een
 * goedkoop model wegstrepen kost centen; ze allemaal volledig uitwerken kost
 * tientallen euro's per run. Enkel de top van deze lijst gaat door naar de
 * echte analyse.
 *
 * Twee harde regels:
 *  • Nooit twee keer hetzelfde scoren. De content_hash dekt precies de velden
 *    die we aan het model geven; verandert er niets, dan gebeurt er niets.
 *  • Een opdracht die al VOLLEDIG geanalyseerd is raken we hier niet meer aan.
 *    Anders zou een goedkope score een uitgewerkt dossier overschrijven.
 */

const MODEL = () => process.env.AANBESTEDINGEN_SCORE_MODEL || 'claude-haiku-4-5-20251001'

/** Zoveel opdrachten per AI-oproep. Groter is goedkoper, maar bij een te lange
 *  lijst gaat een model slordig tellen en raken scores en referenties door
 *  elkaar. Twintig bleek de grens waarbij het antwoord nog netjes klopt. */
const PER_OPROEP = 20

/** Prijs per miljoen tokens, om de kost van een run te kunnen tonen. */
const PRIJS_IN = Number(process.env.AANBESTEDINGEN_SCORE_PRIJS_IN ?? 1)
const PRIJS_UIT = Number(process.env.AANBESTEDINGEN_SCORE_PRIJS_UIT ?? 5)

export type TeScoren = {
  referentienummer: string
  titel: string | null
  beschrijving: string | null
  organisatie: string | null
  cpv_hoofdcode: string | null
  cpv_hoofd_omschrijving: string | null
  aard: string | null
  procedure: string | null
  uiterste_indieningsdatum: string | null
}

export type ScoreUitkomst = {
  referentienummer: string
  score: number
  kwalificatie_reden: string
  uitleg_kort: string
}

/**
 * Vingerafdruk van precies datgene wat het model te zien krijgt.
 *
 * Neem hier NOOIT velden in op die niets met de inhoud te maken hebben
 * (last_seen_at, record_status): dan verandert de hash bij elke ophaal en
 * scoren we alles elke keer opnieuw.
 */
export function contentHash(o: TeScoren): string {
  const kern = [
    o.titel ?? '', o.beschrijving ?? '', o.organisatie ?? '',
    o.cpv_hoofdcode ?? '', o.cpv_hoofd_omschrijving ?? '',
    o.aard ?? '', o.procedure ?? '',
  ].join(' ')
  return createHash('sha256').update(kern).digest('hex').slice(0, 32)
}

/** De kennisbank in het kort — waar dit team goed in is. */
export async function kennisSamenvatting(filterId: string): Promise<string> {
  const admin = createAdminSupabaseClient()
  const [kennis, referenties] = await Promise.all([
    admin.from('aanbesteding_kennis').select('visie').eq('filter_id', filterId).maybeSingle(),
    admin.from('aanbesteding_referenties').select('klant, wat_we_deden, sector_type')
      .eq('filter_id', filterId).limit(25),
  ])

  const visie = (kennis.data as { visie: string | null } | null)?.visie?.trim() ?? ''
  const refs = ((referenties.data ?? []) as {
    klant: string | null; wat_we_deden: string | null; sector_type: string | null
  }[])

  const delen: string[] = []
  if (visie) delen.push(`Wat wij doen:\n${visie}`)
  if (refs.length) {
    delen.push('Eerdere opdrachten:\n' + refs
      .map((r) => `- ${r.klant ?? '?'}: ${r.wat_we_deden ?? ''}${r.sector_type ? ` (${r.sector_type})` : ''}`)
      .join('\n'))
  }
  return delen.join('\n\n')
}

/**
 * Het antwoord van het model uitlezen.
 *
 * Los van de AI-oproep zodat het te testen is, en streng: een score die we niet
 * kunnen thuisbrengen gooien we weg in plaats van hem aan de verkeerde opdracht
 * te hangen. Een fout gekoppelde score is erger dan een ontbrekende — dan mailt
 * hij straks over een dossier dat niet bestaat.
 */
export function parseScores(tekst: string, verwacht: string[]): ScoreUitkomst[] {
  const geldig = new Set(verwacht)
  const start = tekst.indexOf('[')
  const eind = tekst.lastIndexOf(']')
  if (start === -1 || eind === -1 || eind < start) return []

  let ruw: unknown
  try { ruw = JSON.parse(tekst.slice(start, eind + 1)) } catch { return [] }
  if (!Array.isArray(ruw)) return []

  const gezien = new Set<string>()
  const uit: ScoreUitkomst[] = []
  for (const item of ruw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const ref = String(r.referentie ?? r.referentienummer ?? '').trim()
    // Onbekende of dubbele referentie: overslaan.
    if (!geldig.has(ref) || gezien.has(ref)) continue
    const n = Number(r.score)
    if (!Number.isFinite(n)) continue
    gezien.add(ref)
    uit.push({
      referentienummer: ref,
      score: Math.max(0, Math.min(100, Math.round(n))),
      kwalificatie_reden: String(r.reden ?? r.kwalificatie_reden ?? '').trim().slice(0, 300),
      uitleg_kort: String(r.uitleg ?? r.uitleg_kort ?? '').trim().slice(0, 600),
    })
  }
  return uit
}

/** Eén opdracht compact beschrijven voor het model. */
function beschrijf(o: TeScoren): string {
  const knip = (s: string | null, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
  return [
    `referentie: ${o.referentienummer}`,
    `titel: ${knip(o.titel, 250)}`,
    o.organisatie ? `aanbesteder: ${knip(o.organisatie, 120)}` : '',
    o.cpv_hoofdcode ? `cpv: ${o.cpv_hoofdcode} ${knip(o.cpv_hoofd_omschrijving, 120)}` : '',
    o.aard ? `aard: ${knip(o.aard, 60)}` : '',
    o.procedure ? `procedure: ${knip(o.procedure, 80)}` : '',
    // Bewust kort: de omschrijving is soms een half bestek en dat willen we
    // hier niet betalen. Voor de diepte is er straks de volledige analyse.
    o.beschrijving ? `omschrijving: ${knip(o.beschrijving, 900)}` : '',
  ].filter(Boolean).join('\n')
}

function prompt(kennis: string, groep: TeScoren[]): string {
  return `Je beoordeelt Belgische overheidsopdrachten voor een bureau, en zegt per opdracht hoe kansrijk die is.

${kennis || 'Er is nog geen profiel ingevuld. Beoordeel dan enkel op hoe uitvoerbaar en afgebakend de opdracht op zichzelf lijkt, en zeg dat in de reden.'}

Geef UITSLUITEND een JSON-array terug, één object per opdracht, in dezelfde volgorde:
[{"referentie":"...","score":0-100,"reden":"één zin","uitleg":"twee tot drie zinnen"}]

Hoe je scoort:
- 80-100: past duidelijk bij wat dit bureau doet, en het is te behappen.
- 50-79: raakvlak, maar er is twijfel over omvang, vereisten of vakgebied.
- 20-49: zijdelings verwant; enkel de moeite bij weinig ander werk.
- 0-19: ander vakgebied, of veel te groot of te klein.

Belangrijk:
- Beoordeel op wat er STAAT. Vul niets aan wat er niet is en verzin geen bedragen.
- Weet je te weinig om te oordelen, geef dan een score rond 40 en zeg in de reden wát je mist. Een eerlijk "onduidelijk" is bruikbaarder dan een gokje.
- Neem de referentie letterlijk over.

De opdrachten:

${groep.map((o) => beschrijf(o)).join('\n---\n')}`
}

export type ScoreRonde = {
  scores: ScoreUitkomst[]
  input_tokens: number
  output_tokens: number
  kost_usd: number
  model: string
}

/** Eén groep opdrachten laten scoren. */
async function scoreGroep(kennis: string, groep: TeScoren[]): Promise<ScoreRonde> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt(kennis, groep) }],
      }),
    })
  } catch (e) {
    throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`)
  }

  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)
  }

  const tekst: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  const inTok = Number(json?.usage?.input_tokens ?? 0)
  const uitTok = Number(json?.usage?.output_tokens ?? 0)

  return {
    scores: parseScores(tekst, groep.map((o) => o.referentienummer)),
    input_tokens: inTok,
    output_tokens: uitTok,
    kost_usd: (inTok / 1e6) * PRIJS_IN + (uitTok / 1e6) * PRIJS_UIT,
    model: MODEL(),
  }
}

export type ScoreResultaat = {
  bekeken: number
  gescoord: number
  gestopt: boolean
  overgeslagen: number
  zonder_antwoord: number
  input_tokens: number
  output_tokens: number
  kost_usd: number
}

/**
 * Alle opdrachten van een workspace scoren die dat nog nodig hebben.
 *
 * Overslaan we: ingediend, genegeerd, verdwenen, deadline voorbij, al volledig
 * geanalyseerd, en alles waarvan de inhoud niet veranderd is sinds de vorige keer.
 */
export async function scoreWorkspace(
  filterId: string,
  opties: {
    onVoortgang?: (nu: number, totaal: number) => void | Promise<void>
    /** Tussen twee groepen gevraagd; wat al gescoord is blijft bewaard. */
    stoppen?: () => Promise<boolean>
  } = {},
): Promise<ScoreResultaat> {
  const admin = createAdminSupabaseClient()
  const uit: ScoreResultaat = {
    bekeken: 0, gescoord: 0, overgeslagen: 0, zonder_antwoord: 0, gestopt: false,
    input_tokens: 0, output_tokens: 0, kost_usd: 0,
  }

  const { data: rijen, error } = await admin
    .from('aanbestedingen')
    .select('referentienummer, titel, beschrijving, organisatie, cpv_hoofdcode, cpv_hoofd_omschrijving, aard, procedure, uiterste_indieningsdatum')
    .eq('filter_id', filterId)
    .eq('ingediend', false)
    .eq('genegeerd', false)
    .neq('record_status', 'verdwenen')
  if (error) throw new Error(error.message)

  const opdrachten = (rijen ?? []) as TeScoren[]
  uit.bekeken = opdrachten.length
  if (opdrachten.length === 0) return uit

  // Wat kennen we al? Hash én "volledig" bepalen samen of we mogen overslaan.
  const { data: bestaandeRijen } = await admin
    .from('aanbesteding_analyse')
    .select('referentienummer, content_hash, volledig')
    .eq('filter_id', filterId)
  const bestaand = new Map(
    ((bestaandeRijen ?? []) as { referentienummer: string; content_hash: string | null; volledig: boolean }[])
      .map((r) => [r.referentienummer, r]),
  )

  const nu = Date.now()
  const todo: TeScoren[] = []
  for (const o of opdrachten) {
    // Deadline voorbij: niets meer aan te beginnen, dus ook niets aan uit te geven.
    if (o.uiterste_indieningsdatum && new Date(o.uiterste_indieningsdatum).getTime() < nu) {
      uit.overgeslagen++
      continue
    }
    const al = bestaand.get(o.referentienummer)
    // Een uitgewerkt dossier nooit overschrijven met een goedkope score.
    if (al?.volledig) { uit.overgeslagen++; continue }
    if (al && al.content_hash === contentHash(o)) { uit.overgeslagen++; continue }
    todo.push(o)
  }
  if (todo.length === 0) return uit

  const kennis = await kennisSamenvatting(filterId)

  for (let i = 0; i < todo.length; i += PER_OPROEP) {
    const groep = todo.slice(i, i + PER_OPROEP)
    const ronde = await scoreGroep(kennis, groep)

    uit.input_tokens += ronde.input_tokens
    uit.output_tokens += ronde.output_tokens
    uit.kost_usd += ronde.kost_usd

    const perRef = new Map(ronde.scores.map((s) => [s.referentienummer, s]))
    const nuIso = new Date().toISOString()
    const teBewaren = groep
      .filter((o) => perRef.has(o.referentienummer))
      .map((o) => {
        const s = perRef.get(o.referentienummer)!
        return {
          filter_id: filterId,
          referentienummer: o.referentienummer,
          score: s.score,
          volledig: false,
          kwalificatie_reden: s.kwalificatie_reden,
          uitleg_kort: s.uitleg_kort,
          model: ronde.model,
          input_tokens: Math.round(ronde.input_tokens / groep.length),
          output_tokens: Math.round(ronde.output_tokens / groep.length),
          kost_usd: ronde.kost_usd / groep.length,
          content_hash: contentHash(o),
          gegenereerd_op: nuIso,
        }
      })

    if (teBewaren.length) {
      const { error: bewaarFout } = await admin
        .from('aanbesteding_analyse')
        .upsert(teBewaren, { onConflict: 'filter_id,referentienummer' })
      if (bewaarFout) throw new Error(bewaarFout.message)
      uit.gescoord += teBewaren.length
    }
    // Een opdracht waar het model niets over zei tellen we apart. Zwijgend
    // laten vallen is hoe je nooit merkt dat een prompt scheef zit.
    uit.zonder_antwoord += groep.length - teBewaren.length

    await opties.onVoortgang?.(Math.min(i + PER_OPROEP, todo.length), todo.length)

    // Tussen twee groepen, nooit binnen een oproep: anders betaal je wel voor
    // een antwoord dat je daarna weggooit.
    if (await opties.stoppen?.()) { uit.gestopt = true; break }
  }

  return uit
}

// Shoot planner — pure regels (client-safe, getest in tests/shoots.test.ts).
//
// Een shoot is één rij in shoot_briefings (per klant, ook zichtbaar in de
// klantapp). Het shootplan komt erbij: locaties, een programma per tijdstip
// (11:00 op locatie A, 12:30 op locatie B …), wie erbij is, wat mee moet, een
// shotlist en praktische info. De oude velden (datum, start, einde, locatie)
// worden uit het plan afgeleid, zodat klantfiche, klantapp en het bestaande
// shootdocument blijven kloppen.

import type { ShootTijd } from './tijd'
import type { Ontvanger } from '@/lib/opleveringen-ontvangers'

export const SHOOT_STATUSSEN = ['concept', 'gepland', 'afgerond', 'geannuleerd'] as const
export type ShootStatus = (typeof SHOOT_STATUSSEN)[number]
export const STATUS_INFO: Record<ShootStatus, { label: string; cls: string; stip: string }> = {
  concept: { label: 'Concept', cls: 'bg-gray-100 text-gray-700 border-gray-200', stip: 'bg-gray-400' },
  gepland: { label: 'Gepland', cls: 'bg-sky-50 text-sky-800 border-sky-200', stip: 'bg-sky-500' },
  afgerond: { label: 'Afgerond', cls: 'bg-green-50 text-green-800 border-green-200', stip: 'bg-green-500' },
  geannuleerd: { label: 'Geannuleerd', cls: 'bg-red-50 text-red-700 border-red-200', stip: 'bg-red-400' },
}
export const statusVan = (v: unknown): ShootStatus => (SHOOT_STATUSSEN as readonly string[]).includes(String(v)) ? (v as ShootStatus) : 'gepland'

export type ShootLocatie = { id: string; naam: string; adres: string; contact: string; telefoon: string; notitie: string }
export type ProgrammaPunt = { id: string; van: string; tot: string; locatie: string; wat: string; wie: string }
export type Betrokkene = { id: string; naam: string; rol: string; email: string; telefoon: string }

export type ShootPlan = {
  titel: string
  datum: string
  status: ShootStatus
  doel: string
  locaties: ShootLocatie[]
  programma: ProgrammaPunt[]
  betrokkenen: Betrokkene[]
  paklijst: string[]
  shotlist: string[]
  praktisch: string
  briefing: string
}

export type Shoot = ShootPlan & {
  id: string
  client_id: string
  klant: string | null
  start: string | null
  einde: string | null
  versie: number
  briefing_pad: string | null
  briefing_naam: string | null
  briefing_type: string | null
  laatst_verstuurd_op: string | null
  updated_at: string | null
  /** Fase 6: tijd per onderdeel en soort afspraak (los van het plan). */
  tijd?: ShootTijd
  bijgewerkt_door: string | null
}

/** Een shoot in de kalender of de lijst met komende shoots. */
export type ShootKort = Pick<Shoot, 'id' | 'client_id' | 'klant' | 'titel' | 'datum' | 'status' | 'start' | 'einde'> & { locaties: string[]; punten: number; mensen: number; verstuurd: string | null; tijd?: ShootTijd }

export const LEEG_PLAN: ShootPlan = {
  titel: '', datum: '', status: 'gepland', doel: '', locaties: [], programma: [], betrokkenen: [], paklijst: [], shotlist: [], praktisch: '', briefing: '',
}

export const MAX = { titel: 160, doel: 2000, kort: 200, adres: 300, notitie: 1000, praktisch: 5000, briefing: 30000, lijst: 80, regel: 300 }

export function nieuwId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const tekst = (v: unknown, max: number): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\r\n/g, '\n').trim().slice(0, max)
const kort = (v: unknown, max = MAX.kort): string => tekst(v, max).replace(/\s+/g, ' ')
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
export const isEmail = (v: unknown): boolean => typeof v === 'string' && EMAIL.test(v.trim())
export const isDatum = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime())

/**
 * Een tijdstip zoals mensen het typen naar HH:MM: "11", "11u", "11u30",
 * "11.30", "11:30", "9h15", "09:00". Onleesbaar of buiten 0–23:59 = ''.
 */
export function tijd(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return ''
  const m = /^(\d{1,2})(?:[:.uh](\d{2})?)?(?:u|h|uur)?$/.exec(s)
  if (!m) return ''
  const u = Number(m[1]), min = m[2] ? Number(m[2]) : 0
  if (u > 23 || min > 59) return ''
  return `${String(u).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const minuten = (t: string) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : Number.POSITIVE_INFINITY)

/** Programma op tijd: zonder tijdstip achteraan, verder in de volgorde waarin het stond. */
export function sorteerProgramma(p: ProgrammaPunt[]): ProgrammaPunt[] {
  return p.map((x, i) => ({ x, i })).sort((a, b) => minuten(a.x.van) - minuten(b.x.van) || a.i - b.i).map((y) => y.x)
}

/** Lijst uit tekst: één punt per regel, opsommingstekens vooraan vallen weg. */
export function lijstUitTekst(t: unknown): string[] {
  const bron = Array.isArray(t) ? t.map((x) => String(x ?? '')) : String(t ?? '').split(/\r?\n/)
  return bron.map((r) => r.replace(/^\s*(?:[-–•*·☐□]|\d+[.)])\s*/, '').trim().slice(0, MAX.regel)).filter(Boolean).slice(0, 200)
}

const lijstVan = <T,>(v: unknown, f: (x: Record<string, unknown>) => T | null): T[] =>
  (Array.isArray(v) ? v : []).slice(0, MAX.lijst).map((x) => (x && typeof x === 'object' ? f(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null)

const id = (v: unknown) => (typeof v === 'string' && /^[\w-]{4,64}$/.test(v) ? v : nieuwId())

/** Alles wat binnenkomt (scherm, AI, databank) netjes en begrensd. Nooit een fout: lege velden vallen weg. */
export function normaliseerPlan(b: unknown): ShootPlan {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
  const locaties = lijstVan<ShootLocatie>(o.locaties, (x) => {
    const l = { id: id(x.id), naam: kort(x.naam), adres: kort(x.adres, MAX.adres), contact: kort(x.contact), telefoon: kort(x.telefoon, 40), notitie: tekst(x.notitie, MAX.notitie) }
    return l.naam || l.adres ? { ...l, naam: l.naam || l.adres.split(',')[0].trim() } : null
  })
  const programma = sorteerProgramma(lijstVan<ProgrammaPunt>(o.programma, (x) => {
    const p = { id: id(x.id), van: tijd(x.van), tot: tijd(x.tot), locatie: kort(x.locatie), wat: tekst(x.wat, MAX.notitie), wie: kort(x.wie) }
    if (p.tot && p.van && minuten(p.tot) <= minuten(p.van)) p.tot = ''
    return p.van || p.wat || p.locatie ? p : null
  }))
  const gezien = new Set<string>()
  const betrokkenen = lijstVan<Betrokkene>(o.betrokkenen, (x) => {
    const mail = kort(x.email).toLowerCase()
    const r = { id: id(x.id), naam: kort(x.naam), rol: kort(x.rol), email: isEmail(mail) ? mail : '', telefoon: kort(x.telefoon, 40) }
    if (!r.naam && !r.email) return null
    // Hetzelfde adres twee keer = één persoon.
    if (r.email) { if (gezien.has(r.email)) return null; gezien.add(r.email) }
    return r
  })
  return {
    titel: kort(o.titel, MAX.titel),
    datum: isDatum(o.datum) ? o.datum : '',
    status: statusVan(o.status),
    doel: tekst(o.doel, MAX.doel),
    locaties, programma, betrokkenen,
    paklijst: lijstUitTekst(o.paklijst),
    shotlist: lijstUitTekst(o.shotlist),
    praktisch: tekst(o.praktisch, MAX.praktisch),
    briefing: tekst(o.briefing, MAX.briefing),
  }
}

/** Wat moet er zijn om te bewaren: een klant en een datum. */
export function controleerBewaren(plan: ShootPlan, clientId: string | null | undefined): string | null {
  if (!clientId) return 'Kies voor welke klant de shoot is.'
  if (!plan.datum) return 'Kies de datum van de shoot.'
  return null
}

/** Wat nog ontbreekt voor een duidelijk plan (enkel een seintje, versturen mag altijd). */
export function nogAanTeVullen(plan: ShootPlan): string[] {
  const uit: string[] = []
  if (!plan.programma.some((p) => p.van)) uit.push('Nog geen uur in het programma')
  if (plan.locaties.length === 0) uit.push('Nog geen locatie')
  for (const l of plan.locaties) if (!l.adres) uit.push(`Geen adres voor ${l.naam}`)
  const namen = new Set(plan.locaties.map((l) => l.naam.toLowerCase()))
  for (const p of plan.programma) if (p.locatie && !namen.has(p.locatie.toLowerCase())) { uit.push(`"${p.locatie}" staat in het programma maar niet bij de locaties`); break }
  if (!plan.betrokkenen.some((b) => b.email)) uit.push('Niemand met een e-mailadres om het plan naar te sturen')
  return uit
}

/** De oude velden, afgeleid uit het plan: begin, einde en de locatie in één regel. */
export function afgeleid(plan: ShootPlan): { start_time: string | null; end_time: string | null; location: string | null } {
  const met = plan.programma.filter((p) => p.van)
  const start = met.length ? met.reduce((a, p) => (minuten(p.van) < minuten(a) ? p.van : a), met[0].van) : ''
  const einde = met.reduce((a, p) => { const e = p.tot || p.van; return !a || minuten(e) > minuten(a) ? e : a }, '')
  const location = plan.locaties.length === 0 ? null
    : plan.locaties.length === 1 ? [plan.locaties[0].naam, plan.locaties[0].adres].filter((x, i, l) => x && l.indexOf(x) === i).join(', ')
      : plan.locaties.map((l) => l.naam).join(' · ')
  return { start_time: start || null, end_time: einde && einde !== start ? einde : null, location: location ? location.slice(0, 500) : null }
}

/** De locatie van een programmapunt (op naam), als die bij de locaties staat. */
export const locatieVan = (plan: Pick<ShootPlan, 'locaties'>, naam: string): ShootLocatie | null =>
  plan.locaties.find((l) => l.naam.toLowerCase() === naam.trim().toLowerCase()) ?? null

/** Een routelink naar Google Maps (geen sleutel nodig, opent de app op de gsm). */
export const kaartLink = (adres: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adres)}`
export const belLink = (tel: string) => `tel:${tel.replace(/[^\d+]/g, '')}`

/** Voorstel voor een nieuw programmapunt: na het einde van het vorige, anders een uur later. */
export function volgendTijdstip(p: ProgrammaPunt[]): string {
  const laatste = [...p].reverse().find((x) => x.tot || x.van)
  if (!laatste) return '09:00'
  if (laatste.tot) return laatste.tot
  const m = Math.min(minuten(laatste.van) + 60, 23 * 60 + 30)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// ── Datums ──────────────────────────────────────────────────────────────────

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']
const datumVan = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`)

/** "vrijdag 28 november 2026" */
export function datumLang(iso: string | null | undefined): string {
  if (!isDatum(iso)) return ''
  const d = datumVan(iso)
  return `${DAGEN[d.getUTCDay()]} ${d.getUTCDate()} ${MAANDEN[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
/** "28 nov" */
export const datumKort = (iso: string | null | undefined) => (isDatum(iso) ? `${datumVan(iso).getUTCDate()} ${MAANDEN[datumVan(iso).getUTCMonth()].slice(0, 3)}` : '')
export const maandNaam = (maand: string) => `${MAANDEN[Number(maand.slice(5, 7)) - 1]} ${maand.slice(0, 4)}`
export const tijdBereik = (start: string | null | undefined, einde: string | null | undefined) => [start, einde].filter(Boolean).join(' – ')

export function plusDagen(iso: string, n: number): string {
  const d = datumVan(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function volgendeMaand(maand: string, n = 1): string {
  const d = new Date(Date.UTC(Number(maand.slice(0, 4)), Number(maand.slice(5, 7)) - 1 + n, 1, 12))
  return d.toISOString().slice(0, 7)
}

/** Het maandraster van de kalender: weken van maandag tot zondag, met de dagen van de buurmaanden erbij. */
export function maandRaster(maand: string): string[][] {
  const eerste = `${maand}-01`
  const wd = (datumVan(eerste).getUTCDay() + 6) % 7
  let dag = plusDagen(eerste, -wd)
  const weken: string[][] = []
  do {
    const week: string[] = []
    for (let i = 0; i < 7; i++) { week.push(dag); dag = plusDagen(dag, 1) }
    weken.push(week)
  } while (dag.slice(0, 7) === maand)
  return weken
}

/** De naam van een shoot: de titel, anders "Shoot <klant>". */
export const shootNaam = (s: { titel?: string | null; klant?: string | null }) => s.titel?.trim() || `Shoot${s.klant ? ` ${s.klant}` : ''}`

/** De persoonlijke link blijft geldig tot twee weken na de shoot (minstens twee weken vanaf nu). */
export function linkVerlooptOp(datum: string | null | undefined, nu: Date): string {
  const minstens = nu.getTime() + 14 * 86_400_000
  const naShoot = isDatum(datum) ? new Date(`${plusDagen(datum, 14)}T23:59:00Z`).getTime() : 0
  return new Date(Math.max(minstens, naShoot)).toISOString()
}

// ── Mail ────────────────────────────────────────────────────────────────────

/** Wie de mail kan krijgen: iedereen met een e-mailadres bij "Wie is erbij", plus het adres van de klant. */
export function shootOntvangers(betrokkenen: Betrokkene[], klant?: { email?: string | null; naam?: string | null } | null): Ontvanger[] {
  const uit: Ontvanger[] = []
  for (const b of betrokkenen) {
    if (!isEmail(b.email) || uit.some((o) => o.email.toLowerCase() === b.email.toLowerCase())) continue
    uit.push({ email: b.email, naam: b.naam || null, soort: 'gebruiker', kan: true, reden: null, label: b.rol || 'Betrokken bij de shoot' })
  }
  const k = klant?.email?.trim()
  if (k && isEmail(k) && !uit.some((o) => o.email.toLowerCase() === k.toLowerCase())) uit.push({ email: k, naam: klant?.naam ?? null, soort: 'klantadres', kan: true, reden: null, label: 'Algemeen adres van de klant' })
  return uit
}

/** Standaard aangevinkt: iedereen bij "Wie is erbij" (niet het algemene klantadres). */
export const standaardShootKeuze = (lijst: Ontvanger[]) => lijst.filter((o) => o.soort !== 'klantadres').map((o) => o.email)

export function shootMail(s: { titel?: string | null; klant?: string | null; datum: string; start?: string | null; einde?: string | null; locaties: ShootLocatie[] }): { onderwerp: string; tekst: string; knop: string } {
  const naam = shootNaam(s)
  const wanneer = [datumLang(s.datum), tijdBereik(s.start, s.einde) ? `van ${tijdBereik(s.start, s.einde).replace(' – ', ' tot ')}` : ''].filter(Boolean).join(', ')
  const waar = s.locaties.length === 1 ? `\nWe spreken af op ${[s.locaties[0].naam, s.locaties[0].adres].filter((x, i, l) => x && l.indexOf(x) === i).join(', ')}.`
    : s.locaties.length > 1 ? `\nWe draaien op ${s.locaties.length} locaties: ${s.locaties.map((l) => l.naam).join(', ')}.` : ''
  return {
    onderwerp: `Shootplan: ${naam}${s.datum ? ` (${datumKort(s.datum)})` : ''}`,
    tekst: `Beste [voornaam],\n\nHier is het plan voor ${naam}${wanneer ? ` op ${wanneer}` : ''}.${waar}\n\nVia de knop zie je alles: het programma per uur, de adressen, wie er is en wat je meebrengt. De link toont altijd de laatste versie, dus wijzigt er nog iets, dan zie je dat meteen.\n\nTot dan!\nNextGenMedia`,
    knop: 'Shootplan bekijken',
  }
}

// ── AI-voorstel ─────────────────────────────────────────────────────────────

export type ShootVoorstel = { plan: ShootPlan; onduidelijk: string[] }

/** Het antwoord van de AI (JSON) naar een plan; wat niet klopt valt weg. */
export function naarVoorstel(antwoord: string): ShootVoorstel | null {
  const a = antwoord.indexOf('{'), z = antwoord.lastIndexOf('}')
  if (a === -1 || z <= a) return null
  let p: Record<string, unknown>
  try { p = JSON.parse(antwoord.slice(a, z + 1)) } catch { return null }
  const plan = normaliseerPlan({ ...p, status: 'gepland', briefing: '' })
  // Programmapunten verwijzen naar een locatie die er niet bij stond: die locatie toevoegen (zonder adres).
  for (const pr of plan.programma) {
    if (pr.locatie && !locatieVan(plan, pr.locatie)) plan.locaties.push({ id: nieuwId(), naam: pr.locatie, adres: '', contact: '', telefoon: '', notitie: '' })
  }
  return { plan, onduidelijk: lijstUitTekst(p.onduidelijk).slice(0, 12) }
}

/**
 * Het voorstel over het huidige plan leggen. Wat de AI vond, komt erin; wat de
 * AI leeg liet, blijft zoals het stond. Mensen worden aangevuld, nooit gewist.
 * Status en briefing blijven altijd van het scherm.
 */
export function voegVoorstelSamen(huidig: ShootPlan, v: ShootPlan): ShootPlan {
  const of = <T,>(nieuw: T[], oud: T[]) => (nieuw.length ? nieuw : oud)
  const voornaam = (n: string) => n.trim().toLowerCase().split(/\s+/)[0] ?? ''
  // Dezelfde persoon: zelfde e-mail, zelfde naam, of "Bram" tegenover "Bram Reinquin" zolang de e-mailadressen niet botsen.
  const zelfde = (a: Betrokkene, b: Betrokkene) => {
    if (a.email && b.email) return a.email === b.email
    const na = a.naam.trim().toLowerCase(), nb = b.naam.trim().toLowerCase()
    if (!na || !nb) return false
    return na === nb || ((!na.includes(' ') || !nb.includes(' ')) && voornaam(na) === voornaam(nb))
  }
  const betrokkenen = huidig.betrokkenen.map((b) => ({ ...b }))
  for (const b of v.betrokkenen) {
    const al = betrokkenen.find((x) => zelfde(x, b))
    if (!al) { betrokkenen.push({ ...b }); continue }
    // Aanvullen wat ontbrak bij iemand die er al stond (de volledigste naam blijft).
    if (b.naam.trim().length > al.naam.trim().length) al.naam = b.naam
    if (!al.email && b.email) al.email = b.email
    if (!al.telefoon && b.telefoon) al.telefoon = b.telefoon
    if (!al.rol && b.rol) al.rol = b.rol
  }
  return {
    ...huidig,
    titel: v.titel || huidig.titel,
    datum: v.datum || huidig.datum,
    doel: v.doel || huidig.doel,
    locaties: of(v.locaties, huidig.locaties),
    programma: of(v.programma, huidig.programma),
    betrokkenen,
    paklijst: of(v.paklijst, huidig.paklijst),
    shotlist: of(v.shotlist, huidig.shotlist),
    praktisch: v.praktisch || huidig.praktisch,
  }
}

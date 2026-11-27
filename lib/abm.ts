// Account-based marketing — pure regels (client-safe, getest in tests/abm.test.ts).
//
// Bedrijven waar we gericht achter gaan. Ze komen binnen via een csv- of
// xlsx-bestand met een vaste structuur (zie ABM_KOLOMMEN en het voorbeeld-
// bestand). De kolomnamen mogen wat afwijken: "Bedrijf", "Firma" of "Company"
// is allemaal de bedrijfsnaam.

import { normalizeBtw } from './btw'

export type AbmVeld = 'naam' | 'btw_nummer' | 'telefoon' | 'email' | 'website' | 'contactpersoon' | 'functie' | 'gemeente' | 'sector' | 'notitie'

export const ABM_KOLOMMEN: { veld: AbmVeld; kop: string; voorbeeld: string; namen: string[] }[] = [
  { veld: 'naam', kop: 'Bedrijfsnaam', voorbeeld: 'Bakkerij Peeters BV', namen: ['bedrijfsnaam', 'bedrijf', 'naam', 'firma', 'company', 'organisatie', 'onderneming', 'klant'] },
  { veld: 'btw_nummer', kop: 'Btw-nummer', voorbeeld: 'BE0123456789', namen: ['btw', 'btwnummer', 'btwnr', 'vat', 'vatnumber', 'ondernemingsnummer', 'kbo', 'kbonummer'] },
  { veld: 'telefoon', kop: 'Telefoon', voorbeeld: '+32 11 22 33 44', namen: ['telefoon', 'tel', 'telefoonnummer', 'gsm', 'phone', 'mobiel', 'nummer'] },
  { veld: 'email', kop: 'E-mail', voorbeeld: 'info@bakkerijpeeters.be', namen: ['email', 'e-mail', 'mail', 'emailadres', 'e-mailadres'] },
  { veld: 'website', kop: 'Website', voorbeeld: 'https://bakkerijpeeters.be', namen: ['website', 'site', 'url', 'web', 'websitelink', 'link'] },
  { veld: 'contactpersoon', kop: 'Contactpersoon', voorbeeld: 'Jan Peeters', namen: ['contactpersoon', 'contact', 'naamcontactpersoon', 'zaakvoerder', 'beslisser'] },
  { veld: 'functie', kop: 'Functie', voorbeeld: 'Zaakvoerder', namen: ['functie', 'rol', 'titel', 'job', 'jobtitel'] },
  { veld: 'gemeente', kop: 'Gemeente', voorbeeld: 'Hasselt', namen: ['gemeente', 'stad', 'plaats', 'city', 'locatie', 'woonplaats'] },
  { veld: 'sector', kop: 'Sector', voorbeeld: 'Voeding', namen: ['sector', 'branche', 'industrie', 'niche', 'industry'] },
  { veld: 'notitie', kop: 'Notitie', voorbeeld: 'Kent ons via Kristof', namen: ['notitie', 'notities', 'opmerking', 'opmerkingen', 'notes', 'info', 'waarom'] },
]

export type AbmRij = Partial<Record<AbmVeld, string | null>> & { naam: string }
export type AbmBedrijf = AbmRij & {
  id: string; client_id: string | null; opdracht_id: string | null; created_at: string; created_by: string | null
  /** Geen interesse: uit de kolom, in het vuilbakje (terugzetten kan). */
  geen_interesse_op?: string | null; geen_interesse_door?: string | null
  /** Wanneer we het bedrijf opnieuw contacteren (datum, Belgische dag). */
  opvolgen_op?: string | null
  /** Voor welk bedrijf we dit bedrijf benaderen (NextGenMedia of NextGenSolutions); leeg = nog niet gekozen. */
  bedrijf?: string | null
  /** De laatste notitie (voor de kaart in de kolom) en hoeveel er zijn. */
  laatste_notitie?: AbmNotitie | null; aantal_notities?: number
}

// ── Notities en gesprekken (26 nov 2026) ────────────────────────────────────

export type AbmUitkomst = 'niet_opgenomen' | 'voicemail' | 'terugbellen' | 'gesproken' | 'interesse'
export const UITKOMSTEN: { key: AbmUitkomst; label: string }[] = [
  { key: 'niet_opgenomen', label: 'Niet opgenomen' },
  { key: 'voicemail', label: 'Voicemail ingesproken' },
  { key: 'terugbellen', label: 'Terugbellen' },
  { key: 'gesproken', label: 'Gesproken' },
  { key: 'interesse', label: 'Interesse' },
]
export const uitkomstLabel = (u: string | null | undefined) => UITKOMSTEN.find((x) => x.key === u)?.label ?? null
export type AbmNotitie = { id: string; abm_id: string; soort: 'notitie' | 'gesprek'; uitkomst: AbmUitkomst | null; telefoon: string | null; tekst: string | null; door: string | null; created_at: string }

/** Een notitie of gesprek nakijken. Een gesprek mag zonder tekst (enkel de uitkomst). */
export function controleerNotitie(b: { tekst?: unknown; soort?: unknown; uitkomst?: unknown; telefoon?: unknown }): { ok: true; waarde: { soort: 'notitie' | 'gesprek'; uitkomst: AbmUitkomst | null; telefoon: string | null; tekst: string | null } } | { ok: false; fout: string } {
  const soort = b.soort === 'gesprek' ? 'gesprek' : 'notitie'
  const tekst = typeof b.tekst === 'string' && b.tekst.trim() ? b.tekst.trim().slice(0, 5000) : null
  const uitkomst = UITKOMSTEN.some((u) => u.key === b.uitkomst) ? (b.uitkomst as AbmUitkomst) : null
  const telefoon = typeof b.telefoon === 'string' && b.telefoon.trim() ? b.telefoon.trim().slice(0, 40) : null
  if (!tekst && !uitkomst) return { ok: false, fout: 'Schrijf een notitie of kies hoe het gesprek ging.' }
  return { ok: true, waarde: { soort: uitkomst ? 'gesprek' : soort, uitkomst, telefoon, tekst } }
}

/**
 * Telefoonnummers uit één veld ("+32470831282; 011 45 48 45 / 0479…") als
 * aparte nummers: netjes om te lezen en als tel:-link (bellen via de gsm, op een
 * Mac via de gekoppelde iPhone).
 */
export function belNummers(tekst: string | null | undefined): { weergave: string; tel: string }[] {
  if (!tekst) return []
  const uit: { weergave: string; tel: string }[] = []
  for (const ruw of tekst.split(/[;,/|]|\s{2,}|\bof\b|\ben\b/i)) {
    const t = ruw.trim()
    if (!t) continue
    let cijfers = t.replace(/[^\d+]/g, '')
    if (cijfers.startsWith('00')) cijfers = `+${cijfers.slice(2)}`
    if (/^0\d{8,9}$/.test(cijfers)) cijfers = `+32${cijfers.slice(1)}`
    if (/^32\d{8,9}$/.test(cijfers)) cijfers = `+${cijfers}`
    if (!/^\+?\d{6,15}$/.test(cijfers)) continue
    if (uit.some((x) => x.tel === cijfers)) continue
    uit.push({ weergave: netNummer(cijfers), tel: cijfers })
  }
  return uit
}

/** +32499433036 → +32 499 43 30 36; +3211212641 → +32 11 21 26 41; +3223456789 → +32 2 345 67 89. */
export function netNummer(n: string): string {
  const m = /^\+32(\d{8,9})$/.exec(n)
  if (!m) return n
  const r = m[1]
  if (r.length === 9) return `+32 ${r.slice(0, 3)} ${r.slice(3, 5)} ${r.slice(5, 7)} ${r.slice(7)}`
  if (/^[2349]/.test(r)) return `+32 ${r[0]} ${r.slice(1, 4)} ${r.slice(4, 6)} ${r.slice(6)}`
  return `+32 ${r.slice(0, 2)} ${r.slice(2, 4)} ${r.slice(4, 6)} ${r.slice(6)}`
}

/** "Opvolgen vandaag", "2 dagen te laat", "Opvolgen morgen", "Opvolgen op do 27 nov". */
export function opvolgLabel(datum: string | null | undefined, vandaag: string): { tekst: string; toon: 'laat' | 'vandaag' | 'later' } | null {
  if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null
  const n = Math.round((Date.parse(`${datum}T12:00:00Z`) - Date.parse(`${vandaag}T12:00:00Z`)) / 86_400_000)
  if (n < 0) return { tekst: n === -1 ? '1 dag te laat' : `${-n} dagen te laat`, toon: 'laat' }
  if (n === 0) return { tekst: 'Opvolgen vandaag', toon: 'vandaag' }
  if (n === 1) return { tekst: 'Opvolgen morgen', toon: 'later' }
  const d = new Date(`${datum}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '')
  return { tekst: `Opvolgen op ${d}`, toon: 'later' }
}

const sleutel = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

/** Welke kolom van het bestand hoort bij welk veld? Onbekende kolommen vallen weg. */
export function koppelKoppen(koppen: string[]): (AbmVeld | null)[] {
  const gebruikt = new Set<AbmVeld>()
  return koppen.map((k) => {
    const s = sleutel(k)
    if (!s) return null
    const hit = ABM_KOLOMMEN.find((c) => !gebruikt.has(c.veld) && (c.namen.some((n) => sleutel(n) === s) || sleutel(c.kop) === s))
    if (!hit) return null
    gebruikt.add(hit.veld)
    return hit.veld
  })
}

/** Csv lezen: komma of puntkomma (wat het meest voorkomt in de eerste regel), aanhalingstekens, regels binnen een veld. */
export function leesCsv(tekst: string): string[][] {
  const t = tekst.replace(/^﻿/, '')
  const eerste = t.split(/\r?\n/, 1)[0] ?? ''
  const sep = (eerste.match(/;/g)?.length ?? 0) > (eerste.match(/,/g)?.length ?? 0) ? ';' : (eerste.match(/\t/g)?.length ?? 0) > (eerste.match(/,/g)?.length ?? 0) ? '\t' : ','
  const rijen: string[][] = []
  let rij: string[] = [], veld = '', inQuotes = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (inQuotes) {
      if (c === '"') { if (t[i + 1] === '"') { veld += '"'; i++ } else inQuotes = false }
      else veld += c
    } else if (c === '"') inQuotes = true
    else if (c === sep) { rij.push(veld); veld = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      rij.push(veld); rijen.push(rij); rij = []; veld = ''
    } else veld += c
  }
  if (veld !== '' || rij.length) { rij.push(veld); rijen.push(rij) }
  return rijen.filter((r) => r.some((v) => v.trim() !== ''))
}

const netjes = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  return s || null
}

export function website(v: unknown): string | null {
  const s = netjes(v, 300)
  if (!s) return null
  const metSchema = /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`
  try { const u = new URL(metSchema); return /\./.test(u.hostname) ? u.toString().replace(/\/$/, '') : null } catch { return null }
}

/** Eén rij netjes maken. Zonder bedrijfsnaam: null (wordt overgeslagen). */
export function normaliseerRij(r: Partial<Record<AbmVeld, unknown>>): AbmRij | null {
  const naam = netjes(r.naam, 160)
  if (!naam || naam.length < 2) return null
  const email = netjes(r.email, 200)?.toLowerCase() ?? null
  const btw = netjes(r.btw_nummer, 40)
  return {
    naam,
    btw_nummer: btw ? (normalizeBtw(btw) || btw) : null,
    telefoon: netjes(r.telefoon, 40),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null,
    website: website(r.website),
    contactpersoon: netjes(r.contactpersoon, 120),
    functie: netjes(r.functie, 80),
    gemeente: netjes(r.gemeente, 120),
    sector: netjes(r.sector, 80),
    notitie: netjes(r.notitie, 2000),
  }
}

/** Van een tabel (eerste rij = koppen) naar bedrijven. */
export function rijenUitTabel(tabel: string[][]): { rijen: AbmRij[]; overgeslagen: number; herkend: AbmVeld[] } {
  if (!tabel.length) return { rijen: [], overgeslagen: 0, herkend: [] }
  const velden = koppelKoppen(tabel[0])
  const rijen: AbmRij[] = []
  let overgeslagen = 0
  for (const r of tabel.slice(1)) {
    const ruw: Partial<Record<AbmVeld, unknown>> = {}
    velden.forEach((v, i) => { if (v) ruw[v] = r[i] })
    const n = normaliseerRij(ruw)
    if (n) rijen.push(n); else overgeslagen++
  }
  return { rijen, overgeslagen, herkend: velden.filter((v): v is AbmVeld => !!v) }
}

/** Dubbel? Zelfde btw-nummer, of zelfde naam zonder rechtsvorm. */
export function dubbelSleutel(r: Pick<AbmRij, 'naam' | 'btw_nummer'>): string {
  if (r.btw_nummer) return `btw:${r.btw_nummer.replace(/[^0-9A-Z]/gi, '').toUpperCase()}`
  return `naam:${sleutel(r.naam.replace(/\b(bv|bvba|nv|vof|cv|comm\.?v|srl|sa|bvba|vzw)\b\.?/gi, ''))}`
}

/** Het voorbeeldbestand (csv met puntkomma, opent zo in Excel). */
export function voorbeeldCsv(): string {
  const kop = ABM_KOLOMMEN.map((c) => c.kop).join(';')
  const rij = ABM_KOLOMMEN.map((c) => c.voorbeeld).join(';')
  return `﻿${kop}\n${rij}\n`
}

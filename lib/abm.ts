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
export type AbmBedrijf = AbmRij & { id: string; client_id: string | null; opdracht_id: string | null; created_at: string; created_by: string | null }

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

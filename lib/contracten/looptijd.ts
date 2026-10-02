/**
 * Looptijdstatus van een contract — pure logica.
 *
 * Staat bewust LOS van de ondertekeningsstatus (`contracts.status`:
 * draft/sent/viewed/signed/…). Een contract kan "lopend" zijn en toch nog
 * niet ondertekend. De looptijdstatus zit in `contracts.looptijd_status` en
 * wordt enkel door een mens aangepast (klik op de status).
 *
 * Kleuren zijn overal dezelfde: blauw = lopend, groen = afgerond,
 * rood = stopgezet, grijs = verlopen. Scherm én test gebruiken deze module.
 */

import { canonicalStatus } from '@/lib/contract-status'

export type Looptijd = 'lopend' | 'afgerond' | 'stopgezet' | 'verlopen'
export const LOOPTIJDEN: Looptijd[] = ['lopend', 'afgerond', 'stopgezet', 'verlopen']
export const STANDAARD_LOOPTIJD: Looptijd = 'lopend'

export const LOOPTIJD_INFO: Record<Looptijd, { label: string; meervoud: string; chip: string; stip: string; kaart: string; tekst: string }> = {
  lopend:    { label: 'Lopend',    meervoud: 'lopend',    chip: 'bg-blue-100 text-blue-800 border-blue-200',    stip: 'bg-blue-500',  kaart: 'ring-blue-300',  tekst: 'text-blue-700' },
  afgerond:  { label: 'Afgerond',  meervoud: 'afgerond',  chip: 'bg-green-100 text-green-800 border-green-200', stip: 'bg-green-500', kaart: 'ring-green-300', tekst: 'text-green-700' },
  stopgezet: { label: 'Stopgezet', meervoud: 'stopgezet', chip: 'bg-red-100 text-red-800 border-red-200',       stip: 'bg-red-500',   kaart: 'ring-red-300',   tekst: 'text-red-700' },
  verlopen:  { label: 'Verlopen',  meervoud: 'verlopen',  chip: 'bg-gray-100 text-gray-700 border-gray-300',    stip: 'bg-gray-400',  kaart: 'ring-gray-300',  tekst: 'text-gray-600' },
}

/** Onbekend of leeg wordt "lopend" — zo krijgt elk bestaand contract een status. */
export function looptijdVan(v: string | null | undefined): Looptijd {
  const t = String(v ?? '').trim().toLowerCase()
  return (LOOPTIJDEN as string[]).includes(t) ? (t as Looptijd) : STANDAARD_LOOPTIJD
}

/** Een contract dat klaar is (afgerond/stopgezet/verlopen) vraagt geen actie meer. */
export function isAfgesloten(l: Looptijd): boolean {
  return l !== 'lopend'
}

/** Volledig ondertekend? Dat bepaalt de ondertekeningsstatus, niet de looptijd. */
export function isOndertekend(status: string | null | undefined): boolean {
  return canonicalStatus(status) === 'getekend'
}

export type LooptijdContract = {
  status: string | null
  looptijd_status?: string | null
  sent_at?: string | null
  created_at?: string | null
  expires_at?: string | null
  signed_at?: string | null
  start_date?: string | null
  end_date?: string | null
  contract_type?: string | null
  client_id?: string | null
  heeftPdf?: boolean
}

/**
 * Nog te ondertekenen: niet volledig ondertekend én nog lopend. Afgeronde,
 * stopgezette en verlopen contracten tellen hier nooit mee. Een geannuleerd
 * of vervangen document vraagt ook geen handtekening meer.
 */
export function nogTeOndertekenen(c: LooptijdContract): boolean {
  if (isAfgesloten(looptijdVan(c.looptijd_status))) return false
  const k = canonicalStatus(c.status)
  if (k === 'getekend' || k === 'geannuleerd' || k === 'vervangen' || k === 'template') return false
  return true
}

const DAG = 86400000
const dagen = (van: string | null | undefined, nu: number) => (van ? Math.floor((nu - new Date(van).getTime()) / DAG) : null)

/**
 * Waarom dit contract opvolging nodig heeft — lege lijst = niets te doen.
 * Enkel lopende contracten; stopgezet/afgerond/verlopen verschijnen hier nooit.
 */
export function opvolgRedenen(c: LooptijdContract, nu: Date = new Date()): string[] {
  if (isAfgesloten(looptijdVan(c.looptijd_status))) return []
  const t = nu.getTime()
  const vandaag = nu.toISOString().slice(0, 10)
  const k = canonicalStatus(c.status)
  const uit: string[] = []

  if (nogTeOndertekenen(c)) {
    const leeftijd = k === 'klaar_voor_verzenden' ? null : (dagen(c.sent_at, t) ?? dagen(c.created_at, t))
    if (leeftijd !== null && leeftijd >= 7) uit.push(`Handtekening blijft uit (${leeftijd} dagen)`)
    else uit.push(k === 'klaar_voor_verzenden' ? 'Nog niet verstuurd om te tekenen' : 'Nog niet ondertekend')
    if (c.expires_at && String(c.expires_at).slice(0, 10) < vandaag) uit.push('Tekenlink verlopen')
  }

  const eind = c.end_date ? String(c.end_date).slice(0, 10) : null
  if (eind) {
    const tot = Math.ceil((new Date(eind + 'T12:00:00Z').getTime() - t) / DAG)
    if (tot < 0) uit.push('Einddatum voorbij — status nakijken')
    else if (tot <= 30) uit.push(`Einddatum over ${tot} dag${tot === 1 ? '' : 'en'}`)
  }

  const ontbreekt: string[] = []
  if (!c.client_id) ontbreekt.push('klant')
  if (!c.start_date) ontbreekt.push('startdatum')
  if (c.heeftPdf === false) ontbreekt.push('document')
  if (ontbreekt.length) uit.push(`Ontbrekend: ${ontbreekt.join(', ')}`)
  return uit
}

export function opvolgingNodig(c: LooptijdContract, nu: Date = new Date()): boolean {
  return opvolgRedenen(c, nu).length > 0
}

// ── Categorieën bovenaan ─────────────────────────────────────────────────────

export type Categorie = 'alle' | Looptijd | 'te_ondertekenen' | 'opvolging'
export const CATEGORIEEN: { key: Categorie; label: string }[] = [
  { key: 'alle', label: 'Alle contracten' },
  { key: 'lopend', label: 'Lopend' },
  { key: 'afgerond', label: 'Afgerond' },
  { key: 'stopgezet', label: 'Stopgezet' },
  { key: 'verlopen', label: 'Verlopen' },
  { key: 'te_ondertekenen', label: 'Nog te ondertekenen' },
  { key: 'opvolging', label: 'Opvolging nodig' },
]

export function isCategorie(v: string | null | undefined): v is Categorie {
  return CATEGORIEEN.some((c) => c.key === v)
}

export function inCategorie(c: LooptijdContract, cat: Categorie, nu: Date = new Date()): boolean {
  if (cat === 'alle') return true
  if (cat === 'te_ondertekenen') return nogTeOndertekenen(c)
  if (cat === 'opvolging') return opvolgingNodig(c, nu)
  return looptijdVan(c.looptijd_status) === cat
}

export function telCategorieen(contracten: LooptijdContract[], nu: Date = new Date()): Record<Categorie, number> {
  const uit = Object.fromEntries(CATEGORIEEN.map((c) => [c.key, 0])) as Record<Categorie, number>
  for (const c of contracten) for (const cat of CATEGORIEEN) if (inCategorie(c, cat.key, nu)) uit[cat.key]++
  return uit
}

/** Verdeling per looptijdstatus (voor de badges en tooltip bij een klantmap). */
export function verdeling(contracten: LooptijdContract[]): Record<Looptijd, number> {
  const uit: Record<Looptijd, number> = { lopend: 0, afgerond: 0, stopgezet: 0, verlopen: 0 }
  for (const c of contracten) uit[looptijdVan(c.looptijd_status)]++
  return uit
}

/** "2 lopend · 1 stopgezet" — enkel de statussen die voorkomen. */
export function verdelingTekst(v: Record<Looptijd, number>): string {
  return LOOPTIJDEN.filter((l) => v[l] > 0).map((l) => `${v[l]} ${LOOPTIJD_INFO[l].meervoud}`).join(' · ') || 'geen contracten'
}

/** Controle op een statuswijziging vanuit de API. */
export function valideerWijziging(b: { looptijd_status?: unknown; stop_datum?: unknown; stop_reden?: unknown }): { ok: true; status: Looptijd; stopDatum: string | null; stopReden: string | null } | { ok: false; fout: string } {
  const s = String(b.looptijd_status ?? '').trim().toLowerCase()
  if (!(LOOPTIJDEN as string[]).includes(s)) return { ok: false, fout: 'Onbekende status. Kies lopend, afgerond, stopgezet of verlopen.' }
  const status = s as Looptijd
  if (status !== 'stopgezet') return { ok: true, status, stopDatum: null, stopReden: null }
  const d = String(b.stop_datum ?? '').trim()
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, fout: 'Stopdatum is geen geldige datum.' }
  const r = String(b.stop_reden ?? '').trim().slice(0, 1000)
  return { ok: true, status, stopDatum: d || null, stopReden: r || null }
}

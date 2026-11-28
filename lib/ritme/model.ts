/**
 * Ritme van de zaak (verbeterplan fase 7, punten 90–97): scorecard,
 * weekoverleg, kwartaaldoelen, beslissingen met stemming, beloftes,
 * 1-op-1's en werkvoorraad. Pure regels, getest in tests/ritme-fase7.test.ts.
 * Niets wordt vanzelf ingepland: de app biedt enkel de plek.
 */

// ── 90. Scorecard ───────────────────────────────────────────────────────────

export type CijferKey =
  | 'gefactureerd' | 'nieuwe_projecten' | 'offertes_verstuurd' | 'offertes_aanvaard' | 'contracten_getekend'
  | 'solutions_gewonnen' | 'klantmeetings' | 'abm_gesprekken' | 'opleveringen_gedeeld' | 'aanvragen'

export const CIJFERS: { key: CijferKey; label: string; euro?: boolean; uitleg: string }[] = [
  { key: 'gefactureerd', label: 'Gefactureerd', euro: true, uitleg: 'Uitgereikte facturen op factuurdatum, excl. btw.' },
  { key: 'nieuwe_projecten', label: 'Nieuwe projecten', uitleg: 'Nieuwe kaarten op Projecten.' },
  { key: 'offertes_verstuurd', label: 'Offertes verstuurd', uitleg: 'Offertes die naar de klant vertrokken.' },
  { key: 'offertes_aanvaard', label: 'Offertes aanvaard', uitleg: 'Offertes die de klant aanvaardde.' },
  { key: 'contracten_getekend', label: 'Contracten getekend', uitleg: 'Klantcontracten getekend door de klant.' },
  { key: 'solutions_gewonnen', label: 'Solutions gewonnen', uitleg: 'Deals naar Closed Won bij NextGenSolutions.' },
  { key: 'klantmeetings', label: 'Klantmeetings', uitleg: 'Meetings in de Meeting Inplanner (niet geannuleerd).' },
  { key: 'abm_gesprekken', label: 'ABM-gesprekken', uitleg: 'Belnotities met een uitkomst bij account-based marketing.' },
  { key: 'opleveringen_gedeeld', label: 'Opleveringen gedeeld', uitleg: 'Versies die met de klant gedeeld werden.' },
  { key: 'aanvragen', label: 'Aanvragen van klanten', uitleg: 'Nieuwe aanvragen in de klantapp.' },
]

export type CijferInstelling = { eigenaar: string | null; doel: number | null; aan: boolean }
export type ScorecardInstellingen = Record<CijferKey, CijferInstelling>

export function leesScorecard(v: unknown): ScorecardInstellingen {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, Record<string, unknown> | undefined>
  return Object.fromEntries(CIJFERS.map((c) => {
    const x = r[c.key] ?? {}
    const doel = Number(String(x.doel ?? '').replace(',', '.'))
    const eigenaar = typeof x.eigenaar === 'string' && x.eigenaar.trim() ? x.eigenaar.trim().slice(0, 40) : null
    return [c.key, { eigenaar, doel: Number.isFinite(doel) && doel > 0 ? doel : null, aan: x.aan !== false }]
  })) as ScorecardInstellingen
}

export type Week = { van: string; tot: string; label: string }

const dag = (iso: string, plus: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + plus); return d.toISOString().slice(0, 10) }
export const maandagVan = (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); return dag(iso.slice(0, 10), -((d.getUTCDay() + 6) % 7)) }

/** ISO-weeknummer (maandag start). */
export function weekNummer(iso: string): number {
  const d = new Date(`${maandagVan(iso)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 3)
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
}

/** De laatste n weken, de huidige als laatste. */
export function weken(vandaag: string, n = 13): Week[] {
  const nu = maandagVan(vandaag)
  return Array.from({ length: n }, (_, i) => {
    const van = dag(nu, -7 * (n - 1 - i))
    return { van, tot: dag(van, 6), label: `w${weekNummer(van)}` }
  })
}

/** Per week optellen: elke rij is een datum (en eventueel een bedrag). Buiten de weken telt niet. */
export function perWeek(rijen: { datum: string | null; waarde?: number }[], w: Week[]): number[] {
  const uit = w.map(() => 0)
  for (const r of rijen) {
    if (!r.datum) continue
    const d = r.datum.slice(0, 10)
    const i = w.findIndex((x) => d >= x.van && d <= x.tot)
    if (i >= 0) uit[i] += r.waarde ?? 1
  }
  return uit.map((x) => Math.round(x * 100) / 100)
}

/** Groen als het doel gehaald is, rood als niet, niets zonder doel. De lopende week telt nog niet als rood. */
export function kleurVan(waarde: number, doel: number | null, lopend = false): 'groen' | 'rood' | null {
  if (!doel) return null
  if (waarde >= doel) return 'groen'
  return lopend ? null : 'rood'
}

// ── 91. Weekoverleg ─────────────────────────────────────────────────────────

export const OVERLEG_AGENDA = [
  { key: 'goed_nieuws', label: 'Goed nieuws', min: 5 },
  { key: 'scorecard', label: 'Scorecard', min: 5 },
  { key: 'doelen', label: 'Kwartaaldoelen: op schema of niet', min: 5 },
  { key: 'klanten_team', label: 'Klanten en team', min: 5 },
  { key: 'beloftes', label: 'Beloftes van vorige week', min: 5 },
  { key: 'problemen', label: 'Problemen oplossen', min: 30 },
  { key: 'afsluiten', label: 'Afspraken en beloftes', min: 5 },
] as const
export type AgendaKey = (typeof OVERLEG_AGENDA)[number]['key']

export type Actiepunt = { id: string; tekst: string; wie: string; aan_wie: string | null; tegen: string | null; taak_id?: string | null; klaar?: boolean }

const isDatum = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export function controleerActie(b: Record<string, unknown>): { ok: true; actie: Omit<Actiepunt, 'id'> } | { ok: false; fout: string } {
  const tekst = String(b.tekst ?? '').trim().slice(0, 300)
  if (tekst.length < 3) return { ok: false, fout: 'Wat moet er gebeuren?' }
  const wie = String(b.wie ?? '').trim().slice(0, 60)
  if (!wie) return { ok: false, fout: 'Wie doet het?' }
  const aan = String(b.aan_wie ?? '').trim().slice(0, 60) || null
  return { ok: true, actie: { tekst, wie, aan_wie: aan, tegen: isDatum(b.tegen) ? b.tegen : null, klaar: b.klaar === true } }
}

export function leesActies(v: unknown): Actiepunt[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    const c = controleerActie(o)
    return c.ok && typeof o.id === 'string' ? [{ id: o.id, ...c.actie, taak_id: typeof o.taak_id === 'string' ? o.taak_id : null }] : []
  }).slice(0, 100)
}

export function leesNotities(v: unknown): Partial<Record<AgendaKey, string>> {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return Object.fromEntries(OVERLEG_AGENDA.flatMap((a) => (typeof r[a.key] === 'string' && (r[a.key] as string).trim() ? [[a.key, (r[a.key] as string).slice(0, 10000)]] : [])))
}

// ── 92. Kwartaaldoelen ──────────────────────────────────────────────────────

export const DOEL_STATUS = [
  { key: 'op_schema', label: 'Op schema' },
  { key: 'achter', label: 'Loopt achter' },
  { key: 'af', label: 'Gehaald' },
  { key: 'niet_gehaald', label: 'Niet gehaald' },
] as const
export type DoelStatus = (typeof DOEL_STATUS)[number]['key']

export const kwartaalVan = (iso: string) => `${iso.slice(0, 4)}-Q${Math.ceil(Number(iso.slice(5, 7)) / 3)}`
export function volgendKwartaal(k: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(k)
  if (!m) return k
  const j = Number(m[1]), q = Number(m[2])
  return q === 4 ? `${j + 1}-Q1` : `${j}-Q${q + 1}`
}

export function controleerDoel(b: Record<string, unknown>): { ok: true; doel: { kwartaal: string; titel: string; bedrijf: string | null; eigenaar: string; status: DoelStatus; notitie: string | null } } | { ok: false; fout: string } {
  const kwartaal = String(b.kwartaal ?? '')
  if (!/^\d{4}-Q[1-4]$/.test(kwartaal)) return { ok: false, fout: 'Kies een kwartaal.' }
  const titel = String(b.titel ?? '').trim().slice(0, 200)
  if (titel.length < 3) return { ok: false, fout: 'Wat is het doel?' }
  const eigenaar = String(b.eigenaar ?? '').trim().slice(0, 60)
  if (!eigenaar) return { ok: false, fout: 'Wie is eigenaar?' }
  const bedrijf = b.bedrijf === 'nextgenmedia' || b.bedrijf === 'nextgensolutions' ? b.bedrijf : null
  const status = DOEL_STATUS.find((s) => s.key === b.status)?.key ?? 'op_schema'
  const notitie = String(b.notitie ?? '').trim().slice(0, 2000) || null
  return { ok: true, doel: { kwartaal, titel, bedrijf, eigenaar, status, notitie } }
}

// ── 93. Beslissingen met stemming (twee van de drie) ────────────────────────

export type Stem = 'voor' | 'tegen' | 'onthouding'
export const isStem = (v: unknown): v is Stem => v === 'voor' || v === 'tegen' || v === 'onthouding'

/** Aangenomen bij twee keer voor, verworpen bij twee keer tegen; anders open. */
export function uitslag(stemmen: { stem: Stem }[], nodig = 2): 'aangenomen' | 'verworpen' | 'open' {
  const voor = stemmen.filter((s) => s.stem === 'voor').length
  const tegen = stemmen.filter((s) => s.stem === 'tegen').length
  if (voor >= nodig) return 'aangenomen'
  if (tegen >= nodig) return 'verworpen'
  return 'open'
}

/**
 * Beslissingen per domein (nieuwe werking, 28 nov 2026). Binnen één domein
 * beslist de eigenaar, zonder stemming: legt die het zelf vast, dan is het
 * meteen beslist; legt iemand anders het vast, dan wacht het op de eigenaar.
 * Over meerdere domeinen (of geen) blijft het de stemming twee op drie.
 */
export type BeslisWijze = 'eigenaar' | 'stemming'
export function beslisWijze(domein: string | null | undefined, eigenaar: string | null): BeslisWijze {
  return domein && domein !== 'meerdere' && eigenaar ? 'eigenaar' : 'stemming'
}
export function startStatus(wijze: BeslisWijze, ikBenEigenaar: boolean): 'open' | 'aangenomen' {
  return wijze === 'eigenaar' && ikBenEigenaar ? 'aangenomen' : 'open'
}

// ── 94. Beloftes ────────────────────────────────────────────────────────────

export type Belofte = { id: string; wat: string; wie: string | null; aan_wie: string; tegen: string | null; klaar: boolean }

/** Per persoon de open beloftes, wat te laat is eerst. */
export function beloftesPerPersoon(l: Belofte[], vandaag: string): { wie: string; open: number; teLaat: number; lijst: (Belofte & { teLaat: boolean })[] }[] {
  const m = new Map<string, (Belofte & { teLaat: boolean })[]>()
  for (const b of l) {
    if (b.klaar) continue
    const k = b.wie ?? 'Niemand'
    const x = m.get(k) ?? []
    x.push({ ...b, teLaat: !!b.tegen && b.tegen < vandaag })
    m.set(k, x)
  }
  return [...m.entries()].map(([wie, lijst]) => {
    lijst.sort((a, b) => Number(b.teLaat) - Number(a.teLaat) || String(a.tegen ?? '9').localeCompare(String(b.tegen ?? '9')))
    return { wie, open: lijst.length, teLaat: lijst.filter((x) => x.teLaat).length, lijst }
  }).sort((a, b) => b.teLaat - a.teLaat || b.open - a.open || a.wie.localeCompare(b.wie))
}

// ── 95. 1-op-1's ────────────────────────────────────────────────────────────

/** Een 1-op-1 zien: de zaakvoerders, de medewerker zelf en wie het gesprek voerde. */
export function magEenOpEenZien(ik: { isAdmin: boolean; userId: string }, r: { medewerker_user_id: string | null; met_user_id: string | null }): boolean {
  return ik.isAdmin || (!!ik.userId && (r.medewerker_user_id === ik.userId || r.met_user_id === ik.userId))
}

// ── 97. Werkvoorraad ────────────────────────────────────────────────────────

/**
 * Hoeveel weken werk er ligt: wat getekend en nog te factureren is, gedeeld
 * door wat we gemiddeld per week factureerden (de laatste 13 weken).
 */
export function werkvoorraad(teFactureren: number, gefactureerd13Weken: number): { weken: number | null; band: 'kort' | 'goed' | 'lang' | null } {
  const perWeek = gefactureerd13Weken / 13
  if (perWeek <= 0) return { weken: null, band: null }
  const w = Math.round((teFactureren / perWeek) * 10) / 10
  return { weken: w, band: w < 2 ? 'kort' : w <= 4 ? 'goed' : 'lang' }
}
export const BAND_TEKST = { kort: 'minder dan 2 weken', goed: '2 tot 4 weken', lang: 'meer dan 4 weken' } as const

/**
 * Tijd per shoot en soort afspraak (verbeterplan fase 6, punten 66 en 67):
 * hoe lang rijden, shooten en nabewerken, en of de shoot binnen een retainer,
 * een brandingtraject valt of eenmalig is. Met een rapport per klant per maand.
 * Pure regels, getest in tests/sales-fase6.test.ts. Los van het shootplan zelf.
 */
export const AFSPRAKEN = [
  { key: 'retainer', label: 'Binnen retainer' },
  { key: 'traject', label: 'Brandingtraject' },
  { key: 'eenmalig', label: 'Eenmalig' },
] as const
export type Afspraak = (typeof AFSPRAKEN)[number]['key']
export const afspraakLabel = (k: string | null | undefined) => AFSPRAKEN.find((a) => a.key === k)?.label ?? 'Niet aangeduid'

export type ShootTijd = { rijden_min: number | null; shoot_min: number | null; nabewerking_min: number | null; afspraak: Afspraak | null }
export const LEGE_TIJD: ShootTijd = { rijden_min: null, shoot_min: null, nabewerking_min: null, afspraak: null }

/** Minuten uit "1u30", "90", "1,5u" of "1:30". Leeg of onzin = null. */
export function minuten(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= 10000 ? Math.round(v) : null
  const s = String(v).trim().toLowerCase().replace(',', '.')
  if (!s) return null
  let m = /^(\d+)\s*[u:h]\s*(\d{1,2})?\s*(min)?$/.exec(s)
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0)
  m = /^(\d+(?:\.\d+)?)\s*u(ur)?$/.exec(s)
  if (m) return Math.round(Number(m[1]) * 60)
  m = /^(\d+)\s*(min)?$/.exec(s)
  if (m) return Math.min(10000, Number(m[1]))
  return null
}

export function controleerTijd(b: unknown): ShootTijd {
  const r = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
  return {
    rijden_min: minuten(r.rijden_min), shoot_min: minuten(r.shoot_min), nabewerking_min: minuten(r.nabewerking_min),
    afspraak: AFSPRAKEN.find((a) => a.key === r.afspraak)?.key ?? null,
  }
}

export const totaalMin = (t: Pick<ShootTijd, 'rijden_min' | 'shoot_min' | 'nabewerking_min'>) => (t.rijden_min ?? 0) + (t.shoot_min ?? 0) + (t.nabewerking_min ?? 0)

export function urenTekst(min: number): string {
  if (!min) return '0 u'
  const u = Math.floor(min / 60), m = min % 60
  return m ? `${u} u ${String(m).padStart(2, '0')}` : `${u} u`
}

export type RapportShoot = ShootTijd & { client_id: string; klant: string | null; datum: string; status: string }
export type RapportRij = { klant: string; client_id: string; shoots: number; rijden: number; shoot: number; nabewerking: number; totaal: number; perAfspraak: Record<string, number>; zonderTijd: number }

/** Per klant in een periode: aantal shoots, de tijd per onderdeel en per soort afspraak. Geannuleerde tellen niet. */
export function shootRapport(shoots: RapportShoot[]): RapportRij[] {
  const m = new Map<string, RapportRij>()
  for (const s of shoots) {
    if (s.status === 'geannuleerd') continue
    const r = m.get(s.client_id) ?? { klant: s.klant ?? 'Klant', client_id: s.client_id, shoots: 0, rijden: 0, shoot: 0, nabewerking: 0, totaal: 0, perAfspraak: {}, zonderTijd: 0 }
    r.shoots++
    r.rijden += s.rijden_min ?? 0; r.shoot += s.shoot_min ?? 0; r.nabewerking += s.nabewerking_min ?? 0
    r.totaal = r.rijden + r.shoot + r.nabewerking
    const a = s.afspraak ?? 'onbekend'
    r.perAfspraak[a] = (r.perAfspraak[a] ?? 0) + 1
    if (!totaalMin(s)) r.zonderTijd++
    m.set(s.client_id, r)
  }
  return [...m.values()].sort((a, b) => b.totaal - a.totaal || b.shoots - a.shoots)
}

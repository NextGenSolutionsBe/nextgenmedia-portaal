/**
 * Financieel (verbeterplan fase 7, punten 78–85): pure regels, getest in
 * tests/financieel-fase7.test.ts. Enkel lezen en rekenen; niets wordt
 * vanzelf aangepast, ingepland of verstuurd.
 */
import type { DienstFicheKey, Prijs, Waarden } from '@/lib/offerte-fiche'

const rond = (n: number) => Math.round(n * 100) / 100
const getal = (v: unknown) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }

// ── 79. Maanddoel per bedrijf ───────────────────────────────────────────────

/** totaal = het doel van nu (zoals vroeger € 30.000), ambitie = waar we naartoe groeien (€ 100.000 per maand). */
export type Maanddoelen = { totaal: number; ambitie: number; nextgenmedia: number | null; nextgensolutions: number | null }
export const STANDAARD_DOELEN: Maanddoelen = { totaal: 30_000, ambitie: 100_000, nextgenmedia: null, nextgensolutions: null }

export function leesDoelen(v: unknown): Maanddoelen {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  // Bedragen zoals mensen ze typen: "30.000" of "30 000" = dertigduizend.
  const pos = (x: unknown) => { const n = Number(String(x ?? '').replace(/[.\s]/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 && n < 100_000_000 ? Math.round(n) : null }
  return { totaal: pos(r.totaal) ?? STANDAARD_DOELEN.totaal, ambitie: pos(r.ambitie) ?? STANDAARD_DOELEN.ambitie, nextgenmedia: pos(r.nextgenmedia), nextgensolutions: pos(r.nextgensolutions) }
}

export type DoelRij = { sleutel: 'totaal' | 'nextgenmedia' | 'nextgensolutions'; doel: number | null; gefactureerd: number; gepland: number; pct: number | null; nogTeGaan: number | null }

/**
 * Voortgang van een maand: wat al gefactureerd is en wat nog gepland staat
 * (Te factureren), tegenover het doel. Facturen zonder bedrijf tellen enkel in het totaal.
 */
export function maandVoortgang(rijen: { bedrijf: string | null; bedrag: number; gefactureerd: boolean }[], doelen: Maanddoelen): DoelRij[] {
  const som = (f: (r: { bedrijf: string | null }) => boolean, gef: boolean) => rond(rijen.filter((r) => f(r) && r.gefactureerd === gef).reduce((t, r) => t + r.bedrag, 0))
  const rij = (sleutel: DoelRij['sleutel'], doel: number | null, f: (r: { bedrijf: string | null }) => boolean): DoelRij => {
    const g = som(f, true), p = som(f, false)
    return { sleutel, doel, gefactureerd: g, gepland: p, pct: doel ? Math.round((g / doel) * 100) : null, nogTeGaan: doel ? Math.max(0, rond(doel - g - p)) : null }
  }
  return [
    rij('totaal', doelen.totaal, () => true),
    rij('nextgenmedia', doelen.nextgenmedia, (r) => r.bedrijf === 'nextgenmedia'),
    rij('nextgensolutions', doelen.nextgensolutions, (r) => r.bedrijf === 'nextgensolutions'),
  ]
}

// ── 81 en 84. Marge en klantwaarde ──────────────────────────────────────────

export type GeldRij = { bedrijf: string | null; bedrag: number; datum: string | null; project?: string | null }
export type Waarde = {
  gefactureerd: number; teFactureren: number; kosten: number; uren: number; urenKost: number
  marge: number; margePct: number | null; sinds: string | null; perBedrijf: { bedrijf: string; gefactureerd: number; kosten: number; marge: number }[]
}

/**
 * Klantwaarde over de hele relatie: alles wat gefactureerd is (excl. btw),
 * wat nog te factureren staat, de kosten die aan de klant hangen en, als er
 * een intern uurtarief is, de uren. Marge = gefactureerd − kosten − uren.
 */
export function klantWaarde(o: { facturen: GeldRij[]; gepland: GeldRij[]; kosten: GeldRij[]; uren?: number; uurtarief?: number | null }): Waarde {
  const som = (l: GeldRij[]) => rond(l.reduce((t, r) => t + r.bedrag, 0))
  const gef = som(o.facturen), kos = som(o.kosten)
  const uren = Math.round((o.uren ?? 0) * 4) / 4
  const urenKost = o.uurtarief ? rond(uren * o.uurtarief) : 0
  const marge = rond(gef - kos - urenKost)
  const bedrijven = [...new Set([...o.facturen, ...o.kosten].map((r) => r.bedrijf ?? 'onbekend'))]
  const perBedrijf = bedrijven.map((b) => {
    const g = som(o.facturen.filter((r) => (r.bedrijf ?? 'onbekend') === b)), k = som(o.kosten.filter((r) => (r.bedrijf ?? 'onbekend') === b))
    return { bedrijf: b, gefactureerd: g, kosten: k, marge: rond(g - k) }
  }).sort((a, b) => b.gefactureerd - a.gefactureerd)
  const data = o.facturen.map((r) => r.datum).filter((d): d is string => !!d).sort()
  return { gefactureerd: gef, teFactureren: som(o.gepland), kosten: kos, uren, urenKost, marge, margePct: gef > 0 ? Math.round((marge / gef) * 100) : null, sinds: data[0] ?? null, perBedrijf }
}

/** Per project: gefactureerd tegenover kosten. */
export function margePerProject(facturen: GeldRij[], kosten: GeldRij[]): { project: string; gefactureerd: number; kosten: number; marge: number; margePct: number | null }[] {
  const ids = [...new Set([...facturen, ...kosten].map((r) => r.project).filter((x): x is string => !!x))]
  return ids.map((p) => {
    const g = rond(facturen.filter((r) => r.project === p).reduce((t, r) => t + r.bedrag, 0))
    const k = rond(kosten.filter((r) => r.project === p).reduce((t, r) => t + r.bedrag, 0))
    return { project: p, gefactureerd: g, kosten: k, marge: rond(g - k), margePct: g > 0 ? Math.round(((g - k) / g) * 100) : null }
  }).sort((a, b) => b.gefactureerd - a.gefactureerd)
}

// ── 82. Minimumprijs en minimale marge in de offerte ────────────────────────

/** Welke dienst uit de catalogus hoort bij welke fiche van de offerte. */
export const FICHE_NAAR_CATALOGUS: Record<DienstFicheKey, string> = {
  social_media: 'social_media', video_foto: 'foto_video', website: 'websites', ads: 'ads', seo: 'seo',
  branding: 'branding', email: 'emailmarketing', consultancy: 'marketingstrategie', ai: 'ai_automatisatie',
}

/** Kosten die we doorrekenen (geen honorarium): advertentiebudget via ons, verplaatsing, huur, licenties, extern. */
export function doorgerekend(p: Waarden): number {
  const b = (k: string) => Math.max(0, getal(p[k]))
  return rond((p.budget_via_ons === 'ja' ? b('advertentiebudget') : 0) + b('verplaatsing') + b('huur') + b('licenties') + b('extern'))
}

export type MinimumCheck = {
  /** Honorarium = totaal excl. btw zonder de doorgerekende kosten. */
  honorarium: number
  minimum: number
  regels: { naam: string; min: number }[]
  margePct: number | null
  minMarge: number | null
  onder: boolean
  redenen: string[]
}

type CatDienst = { slug: string; naam: string; min_prijs: number | null; min_marge_pct: number | null }

export function minimumCheck(diensten: DienstFicheKey[], prijs: Pick<Prijs, 'excl'>, waarden: Waarden, catalogus: CatDienst[]): MinimumCheck {
  const kat = [...new Set(diensten.map((d) => FICHE_NAAR_CATALOGUS[d]))].map((s) => catalogus.find((c) => c.slug === s)).filter((c): c is CatDienst => !!c)
  const regels = kat.filter((c) => c.min_prijs !== null && c.min_prijs > 0).map((c) => ({ naam: c.naam, min: Number(c.min_prijs) }))
  const minimum = rond(regels.reduce((t, r) => t + r.min, 0))
  const kosten = doorgerekend(waarden)
  const honorarium = rond(Math.max(0, prijs.excl - kosten))
  const marges = kat.map((c) => c.min_marge_pct).filter((x): x is number => x !== null && x > 0)
  const minMarge = marges.length ? Math.max(...marges) : null
  const margePct = prijs.excl > 0 && kosten > 0 ? Math.round((honorarium / prijs.excl) * 100) : null
  const redenen: string[] = []
  if (minimum > 0 && prijs.excl > 0 && honorarium < minimum) redenen.push(`Onder de minimumprijs: ${euro(honorarium)} tegenover ${euro(minimum)} (${regels.map((r) => `${r.naam} ${euro(r.min)}`).join(', ')}).`)
  if (minMarge !== null && margePct !== null && margePct < minMarge) redenen.push(`Marge ${margePct}% is lager dan de minimale marge van ${minMarge}%.`)
  return { honorarium, minimum, regels, margePct, minMarge, onder: redenen.length > 0, redenen }
}

const euro = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

/** De reden om toch door te gaan: minstens 10 tekens, hoogstens 500. */
export function controleerReden(v: unknown): string | null {
  const t = String(v ?? '').trim().replace(/\s+/g, ' ')
  return t.length >= 10 ? t.slice(0, 500) : null
}

// ── 83. Verlengingsgesprek ──────────────────────────────────────────────────

/** Een getekend contract met een einddatum binnen 60 dagen (en niet gestopt) vraagt een verlengingsgesprek. */
export function verlengingNodig(c: { status: string | null; end_date: string | null; looptijd_status?: string | null; stop_datum?: string | null }, vandaag: string, dagen = 60): number | null {
  if (!c.end_date || !['signed', 'getekend'].includes(String(c.status))) return null
  if (c.stop_datum || ['stopgezet', 'afgerond'].includes(String(c.looptijd_status ?? ''))) return null
  const over = Math.round((Date.parse(`${c.end_date.slice(0, 10)}T12:00:00Z`) - Date.parse(`${vandaag}T12:00:00Z`)) / 86_400_000)
  return over >= 0 && over <= dagen ? over : null
}

/** Wanneer het gesprek moet: 45 dagen voor het einde, of vandaag als dat al voorbij is. */
export function verlengingDeadline(eind: string, vandaag: string): string {
  const d = new Date(`${eind.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 45)
  const iso = d.toISOString().slice(0, 10)
  return iso < vandaag ? vandaag : iso
}

// ── 85. Export naar het facturatieprogramma ────────────────────────────────

export type ExportRegel = {
  factuurnummer: string; datum: string; klant: string; btw_nummer: string; handelsnaam: string; bedrijf: string; dienst: string
  omschrijving: string; aantal: number; eenheidsprijs: number; btw_pct: number; excl: number; btw: number; incl: number; referentie: string
}

const KOPPEN: [keyof ExportRegel, string][] = [
  ['factuurnummer', 'Factuurnummer'], ['datum', 'Factuurdatum'], ['klant', 'Klant'], ['btw_nummer', 'Btw-nummer klant'], ['handelsnaam', 'Handelsnaam'],
  ['bedrijf', 'Bedrijf'], ['dienst', 'Dienst'], ['omschrijving', 'Omschrijving'], ['aantal', 'Aantal'], ['eenheidsprijs', 'Eenheidsprijs excl. btw'],
  ['btw_pct', 'Btw %'], ['excl', 'Totaal excl. btw'], ['btw', 'Btw'], ['incl', 'Totaal incl. btw'], ['referentie', 'Referentie klant'],
]

/** CSV met puntkomma's en komma als decimaal (zoals Excel en Belgische boekhoudpakketten het lezen). */
export function naarCsv(regels: ExportRegel[]): string {
  const cel = (v: unknown) => {
    const s = typeof v === 'number' ? String(rond(v)).replace('.', ',') : String(v ?? '')
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // Een cel die met = + - @ begint, kan Excel als formule lezen: altijd als tekst.
  const veilig = (v: unknown) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v)
  return [KOPPEN.map(([, k]) => k).join(';'), ...regels.map((r) => KOPPEN.map(([k]) => cel(veilig(r[k]))).join(';'))].join('\r\n')
}

// ── Kosten over de tijd (voor de marge) ─────────────────────────────────────

/**
 * Wat een kost tot vandaag kostte: eenmalig = het bedrag (als de datum al
 * voorbij is), terugkerend = het bedrag per maand, kwartaal of jaar zo vaak
 * als het al gefactureerd werd (van de start tot het einde of vandaag).
 */
export function kostTotaal(c: { type: string | null; amount_excl: number | string | null; cost_date?: string | null; start_date?: string | null; end_date?: string | null; billing_frequency?: string | null }, vandaag: string): number {
  const bedrag = Number(c.amount_excl) || 0
  if (c.type !== 'recurring') return !c.cost_date || c.cost_date.slice(0, 10) <= vandaag ? rond(bedrag) : 0
  if (!c.start_date || c.start_date.slice(0, 10) > vandaag) return 0
  const eind = c.end_date && c.end_date.slice(0, 10) < vandaag ? c.end_date.slice(0, 10) : vandaag
  const [sj, sm] = c.start_date.slice(0, 7).split('-').map(Number), [ej, em] = eind.slice(0, 7).split('-').map(Number)
  const maanden = (ej - sj) * 12 + (em - sm) + 1
  const stap = c.billing_frequency === 'annual' ? 12 : c.billing_frequency === 'quarterly' ? 3 : 1
  return rond(Math.max(0, Math.ceil(maanden / stap)) * bedrag)
}

// Omzetrapportage — pure rekenkern (client-safe, getest in tests/omzet-analyse.test.ts).
//
// Eén bron: de facturen (invoices + invoice_lines) en de gefactureerde maanden
// van terugkerende facturatie (recurring_invoice_months). Niets handmatig.
// Alles in EUROCENTEN op factuurregelniveau, zodat de som van alle diensten
// exact gelijk is aan het totaal.
//
// Regels:
//  · Gefactureerd = uitgereikt (status verstuurd/gefactureerd/betaald), op de factuurdatum.
//    "Te factureren" (nog niet uitgereikt) en geannuleerd tellen niet.
//  · Ontvangen = werkelijk betaald, op de betaaldatum. Ontbreekt die datum,
//    dan "betaaldatum onbekend" — nooit een verzonnen datum.
//  · Openstaand = gefactureerd − ontvangen (per factuur, nooit negatief).
//  · Gedeeltelijke betaling: proportioneel over de regels (geen afrondingsverlies).
//  · Gecrediteerd: +bedrag op de factuurdatum en −bedrag op de creditdatum, per
//    dienst van de oorspronkelijke regels. Een negatieve factuur telt negatief.
//  · Kilometers en doorgerekende kosten (is_extra) = aparte categorie.
//  · Regel zonder dienst → dienst van de factuur → anders "Niet gecategoriseerd".
//  · WAM- en setterfacturen zijn geen NextGenMedia-omzet.

import { berekenRegel } from '@/lib/facturen/regels'
import { DOORGEREKEND, NIET_GECATEGORISEERD, isDienst } from './diensten'

export type FeitStatus = 'betaald' | 'gedeeltelijk' | 'open' | 'gecrediteerd'
export type Feit = {
  sleutel: string
  factuur: string
  invoice_id: string | null
  recurring_id: string | null
  ref: string | null
  omschrijving: string
  client_id: string | null
  dienst: string
  recurring: boolean
  datum: string
  soort: 'factuur' | 'credit'
  bedrag: number
  ontvangen: number
  betaaldatum: string | null
  open: number
  status: FeitStatus
}

const c = (euro: unknown) => Math.round((Number(euro) || 0) * 100)
const dag = (v: unknown) => (v ? String(v).slice(0, 10) : null)

/** Verdeel `totaal` centen over gewichten zonder verlies (grootste rest). */
export function verdeel(totaal: number, gewichten: number[]): number[] {
  const som = gewichten.reduce((t, g) => t + Math.max(0, g), 0)
  if (!som) return gewichten.map((_, i) => (i === 0 ? totaal : 0))
  const ruw = gewichten.map((g) => (Math.max(0, g) / som) * totaal)
  const uit = ruw.map((r) => Math.floor(r))
  let rest = totaal - uit.reduce((t, x) => t + x, 0)
  const volgorde = ruw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f)
  for (let k = 0; rest > 0 && k < volgorde.length; k++, rest--) uit[volgorde[k].i]++
  return uit
}

export type RuweFactuur = {
  id: string; client_id: string | null; invoice_date: string | null; description: string | null; status: string | null
  amount_excl: number | string | null; amount_incl: number | string | null; service_slug: string | null; kind?: string | null; source?: string | null
  factuur_type?: string | null; terugkerende_omzet?: boolean | null; betaalstatus?: string | null; betaald_bedrag?: number | string | null
  betaald_op?: string | null; credited_at?: string | null; extern_factuurnummer?: string | null; reference?: string | null
}
export type RuweRegel = {
  id: string; invoice_id: string | null; recurring_id: string | null; aantal: number | string | null; prijs_excl: number | string | null
  btw_pct: number | string | null; korting_pct: number | string | null; korting_eur?: number | string | null; is_extra: boolean | null
  service_slug?: string | null; artikel?: string | null; omschrijving?: string | null
}
export type RuweReeks = { id: string; client_id: string | null; description: string | null; amount_excl: number | string | null; service_slug: string | null; start_month?: string; end_month?: string | null; active?: boolean | null; deleted_at?: string | null }
export type RuweMaand = { recurring_id: string; month: string; status: string | null; amount_excl?: number | string | null; billing_date?: string | null; invoice_id?: string | null; betaald_op?: string | null; verwijderd_op?: string | null; extern_factuurnummer?: string | null }

const regelCent = (r: RuweRegel) => c(berekenRegel({ aantal: Number(r.aantal) || 0, prijs_excl: Number(r.prijs_excl) || 0, btw_pct: Number(r.btw_pct) || 0, korting_pct: Number(r.korting_pct) || 0, korting_eur: Number(r.korting_eur) || 0 }).excl)
const dienstVan = (r: Pick<RuweRegel, 'is_extra' | 'service_slug'> | null, fallback: string | null) =>
  r?.is_extra ? DOORGEREKEND : isDienst(r?.service_slug) ? String(r!.service_slug) : isDienst(fallback) ? String(fallback) : NIET_GECATEGORISEERD

const uitgereikt = (s: string | null | undefined) => ['verstuurd', 'gefactureerd', 'betaald', 'gecrediteerd'].includes(String(s ?? '').toLowerCase())

/** Alle omzetfeiten (regelniveau) uit de facturen en de gefactureerde reeksmaanden. */
export function bouwFeiten(facturen: RuweFactuur[], regels: RuweRegel[], reeksen: RuweReeks[], maanden: RuweMaand[]): Feit[] {
  const uit: Feit[] = []
  const perFactuur = new Map<string, RuweRegel[]>()
  const perReeks = new Map<string, RuweRegel[]>()
  for (const r of regels) {
    if (r.invoice_id) { const l = perFactuur.get(r.invoice_id) ?? []; l.push(r); perFactuur.set(r.invoice_id, l) }
    else if (r.recurring_id) { const l = perReeks.get(r.recurring_id) ?? []; l.push(r); perReeks.set(r.recurring_id, l) }
  }
  const maandFactuur = new Set(maanden.map((m) => m.invoice_id).filter(Boolean) as string[])

  for (const f of facturen) {
    const kind = String(f.kind ?? 'client')
    if (kind === 'wam' || kind.startsWith('setter')) continue
    if (!uitgereikt(f.status) || !f.invoice_date) continue
    const eigen = perFactuur.get(f.id) ?? []
    const delen = eigen.length
      ? eigen.map((r) => ({ sleutel: r.id, cent: regelCent(r), dienst: dienstVan(r, f.service_slug), tekst: r.artikel || r.omschrijving || f.description || 'Factuur' }))
      : [{ sleutel: `${f.id}:0`, cent: c(f.amount_excl), dienst: dienstVan(null, f.service_slug), tekst: f.description || 'Factuur' }]
    const totaal = delen.reduce((t, d) => t + d.cent, 0)
    const incl = Number(f.amount_incl) || 0
    const gecrediteerd = String(f.status).toLowerCase() === 'gecrediteerd'
    const betaaldIncl = f.betaalstatus === 'betaald' ? incl : Math.min(incl, Math.max(0, Number(f.betaald_bedrag) || 0))
    const ontvangenTot = totaal <= 0 ? 0 : incl > 0 ? Math.min(totaal, Math.round((totaal * betaaldIncl) / incl)) : f.betaalstatus === 'betaald' ? totaal : 0
    const ontvangenDelen = verdeel(ontvangenTot, delen.map((d) => d.cent))
    const openTot = gecrediteerd ? 0 : Math.max(0, totaal - ontvangenTot)
    const openDelen = verdeel(openTot, delen.map((d) => d.cent))
    const status: FeitStatus = gecrediteerd ? 'gecrediteerd' : openTot === 0 ? 'betaald' : ontvangenTot > 0 ? 'gedeeltelijk' : 'open'
    const recurring = f.source === 'recurring' || f.factuur_type === 'terugkerend' || f.terugkerende_omzet === true || maandFactuur.has(f.id)
    const basis = { factuur: `inv:${f.id}`, invoice_id: f.id, recurring_id: null, ref: f.extern_factuurnummer || f.reference || null, client_id: f.client_id, recurring }
    delen.forEach((d, i) => {
      uit.push({ ...basis, sleutel: `inv:${d.sleutel}`, omschrijving: d.tekst, dienst: d.dienst, datum: dag(f.invoice_date)!, soort: 'factuur', bedrag: d.cent, ontvangen: ontvangenDelen[i], betaaldatum: ontvangenDelen[i] ? dag(f.betaald_op) : null, open: openDelen[i], status })
      if (gecrediteerd) uit.push({ ...basis, sleutel: `cred:${d.sleutel}`, omschrijving: `Creditnota — ${d.tekst}`, dienst: d.dienst, datum: dag(f.credited_at) ?? dag(f.invoice_date)!, soort: 'credit', bedrag: -d.cent, ontvangen: 0, betaaldatum: null, open: 0, status })
    })
  }

  const reeksMap = new Map(reeksen.map((r) => [r.id, r]))
  for (const m of maanden) {
    if (String(m.status) !== 'verstuurd' || m.invoice_id || m.verwijderd_op) continue
    const r = reeksMap.get(m.recurring_id); if (!r) continue
    const maand = m.month.slice(0, 7)
    const bedrag = m.amount_excl !== null && m.amount_excl !== undefined ? c(m.amount_excl) : c(r.amount_excl)
    const eigen = perReeks.get(r.id) ?? []
    const somRegels = eigen.reduce((t, x) => t + regelCent(x), 0)
    // Regels van de reeks enkel als ze het maandbedrag dragen; anders één regel met de dienst van de reeks.
    const delen = eigen.length && somRegels === bedrag
      ? eigen.map((x) => ({ sleutel: x.id, cent: regelCent(x), dienst: dienstVan(x, r.service_slug), tekst: x.artikel || x.omschrijving || r.description || 'Maandelijkse facturatie' }))
      : [{ sleutel: '0', cent: bedrag, dienst: dienstVan(null, r.service_slug), tekst: r.description || 'Maandelijkse facturatie' }]
    const betaald = !!m.betaald_op
    delen.forEach((d) => {
      uit.push({
        sleutel: `rec:${r.id}:${maand}:${d.sleutel}`, factuur: `rec:${r.id}:${maand}`, invoice_id: null, recurring_id: r.id, ref: m.extern_factuurnummer ?? null,
        omschrijving: d.tekst, client_id: r.client_id, dienst: d.dienst, recurring: true, datum: dag(m.billing_date) ?? `${maand}-01`, soort: 'factuur',
        bedrag: d.cent, ontvangen: betaald ? d.cent : 0, betaaldatum: betaald ? dag(m.betaald_op) : null, open: betaald ? 0 : d.cent, status: betaald ? 'betaald' : 'open',
      })
    })
  }
  return uit
}

// ── Periodes ────────────────────────────────────────────────────────────────
export type Periode = { van: string; tot: string; label: string }
const pad = (n: number) => String(n).padStart(2, '0')
const laatsteDag = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const maandRange = (y: number, m: number, n = 1): Periode => {
  const eind = new Date(Date.UTC(y, m - 1 + n - 1, 1))
  const ey = eind.getUTCFullYear(), em = eind.getUTCMonth() + 1
  return { van: `${y}-${pad(m)}-01`, tot: `${ey}-${pad(em)}-${pad(laatsteDag(ey, em))}`, label: '' }
}
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

/** preset: deze_maand | vorige_maand | dit_kwartaal | vorig_kwartaal | dit_jaar | vorig_jaar | laatste_12 | maand:YYYY-MM | kwartaal:YYYY-Qn | jaar:YYYY | aangepast:YYYY-MM-DD:YYYY-MM-DD */
export function periodeVan(preset: string, vandaag: string): Periode {
  const y = Number(vandaag.slice(0, 4)), m = Number(vandaag.slice(5, 7)), q = Math.ceil(m / 3)
  const kw = (yy: number, qq: number): Periode => ({ ...maandRange(yy, (qq - 1) * 3 + 1, 3), label: `Q${qq} ${yy}` })
  const ma = (yy: number, mm: number): Periode => ({ ...maandRange(yy, mm), label: `${MAANDEN[mm - 1]} ${yy}` })
  if (preset === 'deze_maand') return ma(y, m)
  if (preset === 'vorige_maand') return m === 1 ? ma(y - 1, 12) : ma(y, m - 1)
  if (preset === 'dit_kwartaal') return kw(y, q)
  if (preset === 'vorig_kwartaal') return q === 1 ? kw(y - 1, 4) : kw(y, q - 1)
  if (preset === 'dit_jaar') return { van: `${y}-01-01`, tot: `${y}-12-31`, label: String(y) }
  if (preset === 'vorig_jaar') return { van: `${y - 1}-01-01`, tot: `${y - 1}-12-31`, label: String(y - 1) }
  if (preset === 'laatste_12') { const s = new Date(Date.UTC(y, m - 12, 1)); return { ...maandRange(s.getUTCFullYear(), s.getUTCMonth() + 1, 12), label: 'Laatste 12 maanden' } }
  let x = preset.match(/^maand:(\d{4})-(\d{2})$/); if (x) return ma(Number(x[1]), Number(x[2]))
  x = preset.match(/^kwartaal:(\d{4})-Q([1-4])$/); if (x) return kw(Number(x[1]), Number(x[2]))
  x = preset.match(/^jaar:(\d{4})$/); if (x) return { van: `${x[1]}-01-01`, tot: `${x[1]}-12-31`, label: x[1] }
  x = preset.match(/^aangepast:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/); if (x && x[1] <= x[2]) return { van: x[1], tot: x[2], label: `${x[1].split('-').reverse().join('/')} – ${x[2].split('-').reverse().join('/')}` }
  return ma(y, m)
}

/** De vorige vergelijkbare periode: vorige maand / kwartaal / jaar, of even lang ervoor. */
export function vorigePeriode(p: Periode): Periode {
  const [vy, vm, vd] = p.van.split('-').map(Number), [ty, tm, td] = p.tot.split('-').map(Number)
  const heleMaanden = vd === 1 && td === laatsteDag(ty, tm)
  if (heleMaanden) {
    const n = (ty - vy) * 12 + (tm - vm) + 1
    const s = new Date(Date.UTC(vy, vm - 1 - n, 1))
    return { ...maandRange(s.getUTCFullYear(), s.getUTCMonth() + 1, n), label: 'vorige periode' }
  }
  const dagen = Math.round((Date.parse(p.tot) - Date.parse(p.van)) / 86_400_000) + 1
  const tot = new Date(Date.parse(p.van) - 86_400_000), van = new Date(tot.getTime() - (dagen - 1) * 86_400_000)
  return { van: van.toISOString().slice(0, 10), tot: tot.toISOString().slice(0, 10), label: 'vorige periode' }
}

// ── Filters en totalen ──────────────────────────────────────────────────────
export type Filter = { dienst?: string | null; klant?: string | null; status?: FeitStatus | null; type?: 'eenmalig' | 'terugkerend' | null }
export function filter(feiten: Feit[], f: Filter): Feit[] {
  return feiten.filter((x) => (!f.dienst || x.dienst === f.dienst) && (!f.klant || x.client_id === f.klant) && (!f.status || x.status === f.status) && (!f.type || (f.type === 'terugkerend') === x.recurring))
}
const inP = (d: string | null, p: Periode) => !!d && d >= p.van && d <= p.tot

export type Totalen = { gefactureerd: number; ontvangen: number; ontvangenOnbekend: number; open: number; aantal: number; recurring: number; recurringOntvangen: number }
export function totalen(feiten: Feit[], p: Periode): Totalen {
  const t: Totalen = { gefactureerd: 0, ontvangen: 0, ontvangenOnbekend: 0, open: 0, aantal: 0, recurring: 0, recurringOntvangen: 0 }
  const facturen = new Set<string>()
  for (const x of feiten) {
    if (inP(x.datum, p)) {
      t.gefactureerd += x.bedrag
      if (x.recurring) t.recurring += x.bedrag
      if (x.soort === 'factuur') {
        t.open += x.open; facturen.add(x.factuur)
        if (x.ontvangen && !x.betaaldatum) t.ontvangenOnbekend += x.ontvangen
      }
    }
    if (x.soort === 'factuur' && x.ontvangen && inP(x.betaaldatum, p)) { t.ontvangen += x.ontvangen; if (x.recurring) t.recurringOntvangen += x.ontvangen }
  }
  t.aantal = facturen.size
  return t
}

export type Groep = { sleutel: string; gefactureerd: number; ontvangen: number; open: number; aantal: number; vorige: number; groeiPct: number | null; aandeel: number }
/** Groeperen per dienst of klant; de som over alle groepen = het totaal. */
export function groepeer(feiten: Feit[], p: Periode, vorige: Periode, op: 'dienst' | 'client_id'): Groep[] {
  const m = new Map<string, Groep & { _f: Set<string> }>()
  const g = (k: string) => { let x = m.get(k); if (!x) { x = { sleutel: k, gefactureerd: 0, ontvangen: 0, open: 0, aantal: 0, vorige: 0, groeiPct: null, aandeel: 0, _f: new Set() }; m.set(k, x) } return x }
  for (const x of feiten) {
    const k = String((op === 'dienst' ? x.dienst : x.client_id) ?? '—')
    if (inP(x.datum, p)) { const y = g(k); y.gefactureerd += x.bedrag; if (x.soort === 'factuur') { y.open += x.open; y._f.add(x.factuur) } }
    if (x.soort === 'factuur' && x.ontvangen && inP(x.betaaldatum, p)) g(k).ontvangen += x.ontvangen
    if (inP(x.datum, vorige)) g(k).vorige += x.bedrag
  }
  const totaal = [...m.values()].reduce((t, x) => t + x.gefactureerd, 0)
  return [...m.values()].filter((x) => x.gefactureerd || x.ontvangen || x.open || x.vorige).map(({ _f, ...x }) => ({
    ...x, aantal: _f.size, groeiPct: x.vorige ? Math.round(((x.gefactureerd - x.vorige) / Math.abs(x.vorige)) * 1000) / 10 : null,
    aandeel: totaal ? Math.round((x.gefactureerd / totaal) * 1000) / 10 : 0,
  })).sort((a, b) => b.gefactureerd - a.gefactureerd)
}

export type Gran = 'maand' | 'kwartaal' | 'jaar'
export const bucketVan = (d: string, gran: Gran) => gran === 'jaar' ? d.slice(0, 4) : gran === 'kwartaal' ? `${d.slice(0, 4)}-Q${Math.ceil(Number(d.slice(5, 7)) / 3)}` : d.slice(0, 7)
/** Evolutie: alle buckets van de periode (ook lege), totaal + per gekozen dienst. */
export function evolutie(feiten: Feit[], p: Periode, gran: Gran, diensten: string[]): { bucket: string; totaal: number; [dienst: string]: number | string }[] {
  const buckets: string[] = []
  for (let d = new Date(`${p.van.slice(0, 7)}-01T12:00:00Z`); d.toISOString().slice(0, 10) <= p.tot; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const b = bucketVan(d.toISOString().slice(0, 10), gran); if (!buckets.includes(b)) buckets.push(b)
  }
  const rij = new Map(buckets.map((b) => [b, { bucket: b, totaal: 0, ...Object.fromEntries(diensten.map((x) => [x, 0])) } as { bucket: string; totaal: number; [k: string]: number | string }]))
  for (const x of feiten) {
    if (!inP(x.datum, p)) continue
    const r = rij.get(bucketVan(x.datum, gran)); if (!r) continue
    r.totaal = (r.totaal as number) + x.bedrag
    if (diensten.includes(x.dienst)) r[x.dienst] = (r[x.dienst] as number) + x.bedrag
  }
  return [...rij.values()]
}

export type FactuurRij = { factuur: string; invoice_id: string | null; recurring_id: string | null; ref: string | null; omschrijving: string; client_id: string | null; datum: string; bedrag: number; ontvangen: number; open: number; status: FeitStatus; recurring: boolean; diensten: string[] }
/** De facturen achter een selectie (voor de doorklik), met enkel het deel dat bij de selectie hoort. */
export function facturen(feiten: Feit[], p: Periode): FactuurRij[] {
  const m = new Map<string, FactuurRij>()
  for (const x of feiten) {
    if (!inP(x.datum, p)) continue
    const k = `${x.factuur}:${x.soort}`
    const r = m.get(k) ?? { factuur: x.factuur, invoice_id: x.invoice_id, recurring_id: x.recurring_id, ref: x.ref, omschrijving: x.soort === 'credit' ? 'Creditnota' : x.omschrijving, client_id: x.client_id, datum: x.datum, bedrag: 0, ontvangen: 0, open: 0, status: x.status, recurring: x.recurring, diensten: [] }
    r.bedrag += x.bedrag; r.ontvangen += x.ontvangen; r.open += x.open
    if (!r.diensten.includes(x.dienst)) r.diensten.push(x.dienst)
    m.set(k, r)
  }
  return [...m.values()].sort((a, b) => b.datum.localeCompare(a.datum))
}

/** Verwachte MRR uit actieve maandelijkse facturatie — NOOIT bij gerealiseerde omzet tellen. */
export function verwachteMrr(reeksen: RuweReeks[], maand: string): number {
  return reeksen.filter((r) => !r.deleted_at && r.active !== false && (r.start_month ?? '0000-00').slice(0, 7) <= maand && (!r.end_month || r.end_month.slice(0, 7) >= maand)).reduce((t, r) => t + c(r.amount_excl), 0)
}

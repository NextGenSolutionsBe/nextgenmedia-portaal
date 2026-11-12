// Aflettering laden uit de databank — één bron voor contractdetail én contractenlijst.
// Leest de bestaande facturatietabellen (geen kopieën) en rekent via de pure module.

import {
  berekenAflettering, berekenContractWinst, itemUitFactuur, itemsUitReeks, verminderingVan,
  type AflItem, type Aflettering, type ContractWinst, type RuweFactuur, type RuweKost, type RuweMaand, type RuweReeks, type RuweRegel, type Wijziging,
} from './aflettering'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type ContractAflettering = {
  contract_id: string
  waarde: number | null
  waarde_gewijzigd_op: string | null
  waarde_gewijzigd_door: string | null
  items: AflItem[]
  doorlopend: boolean
  aflettering: Aflettering
  /** Verminderingen en crediteringen (ook verwijderde, voor de geschiedenis). */
  wijzigingen: Wijziging[]
  /** Kosten en winst over de gekoppelde facturen (zelfde regel als Kosten en winst per factuur). */
  winst: ContractWinst
}

const FACTUUR_VELDEN = 'id, contract_id, invoice_date, description, status, amount_excl, amount_incl, contract_bedrag_excl, betaalstatus, betaald_bedrag, extern_factuurnummer, reference, kind'
const brusselsMaand = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)

const stukken = <T,>(a: T[], n = 150): T[][] => { const uit: T[][] = []; for (let i = 0; i < a.length; i += n) uit.push(a.slice(i, i + n)); return uit }
async function inLijst<T>(admin: Admin, tabel: string, velden: string, kolom: string, ids: string[]): Promise<T[]> {
  if (!ids.length) return []
  const uit: T[] = []
  for (const s of stukken([...new Set(ids)])) {
    const { data, error } = await admin.from(tabel).select(velden).in(kolom, s)
    if (error) throw new Error(error.message)
    uit.push(...((data ?? []) as T[]))
  }
  return uit
}

/** Aflettering voor de gegeven contracten (of alle contracten als ids leeg is). */
export async function laadAflettering(admin: Admin, contractIds?: string[]): Promise<Map<string, ContractAflettering>> {
  let q = admin.from('contracts').select('id, end_date, contract_waarde_excl, contract_waarde_gewijzigd_op, contract_waarde_gewijzigd_door')
  if (contractIds?.length) q = q.in('id', contractIds)
  let { data: contracten, error } = await q
  if (error && /contract_waarde/.test(error.message)) {
    // Vóór de migratie: zonder contractwaarde verder.
    let q2 = admin.from('contracts').select('id, end_date'); if (contractIds?.length) q2 = q2.in('id', contractIds)
    ;({ data: contracten, error } = await q2)
  }
  if (error) throw new Error(error.message)
  const ids = ((contracten ?? []) as { id: string }[]).map((c) => c.id)
  const uit = new Map<string, ContractAflettering>()
  if (!ids.length) return uit

  // Facturen van deze contracten + facturen waarvan een regel expliciet bij een van deze contracten hoort.
  const [rechtstreeks, regelsMetContract, reeksen] = await Promise.all([
    inLijst<RuweFactuur & { kind?: string }>(admin, 'invoices', FACTUUR_VELDEN, 'contract_id', ids),
    inLijst<RuweRegel>(admin, 'invoice_lines', '*', 'contract_id', ids).catch(() => [] as RuweRegel[]),
    inLijst<RuweReeks & { contract_id: string }>(admin, 'recurring_invoices', 'id, contract_id, description, start_month, end_month, amount_excl, deleted_at', 'contract_id', ids),
  ])
  const maanden = await inLijst<RuweMaand>(admin, 'recurring_invoice_months', 'recurring_id, month, status, amount_excl, billing_date, invoice_id, betaald_op, verwijderd_op, cancelled_at, extern_factuurnummer', 'recurring_id', reeksen.map((r) => r.id)).catch(async () =>
    inLijst<RuweMaand>(admin, 'recurring_invoice_months', 'recurring_id, month, status, amount_excl, billing_date, invoice_id, cancelled_at', 'recurring_id', reeksen.map((r) => r.id)))
  const wijzigingen = await inLijst<Wijziging & { contract_id: string }>(admin, 'contract_waarde_wijzigingen', '*', 'contract_id', ids).catch(() => [] as (Wijziging & { contract_id: string })[])
  const bekend = new Set(rechtstreeks.map((f) => f.id))
  const extraIds = [...regelsMetContract.map((r) => r.invoice_id), ...maanden.map((m) => m.invoice_id)].filter((x): x is string => !!x && !bekend.has(x))
  const extra = await inLijst<RuweFactuur & { kind?: string }>(admin, 'invoices', FACTUUR_VELDEN, 'id', extraIds)
  const facturen = [...rechtstreeks, ...extra].filter((f) => !String(f.kind ?? '').startsWith('setter'))
  const regels = [
    ...(await inLijst<RuweRegel>(admin, 'invoice_lines', '*', 'invoice_id', facturen.map((f) => f.id))),
    ...(await inLijst<RuweRegel>(admin, 'invoice_lines', '*', 'recurring_id', reeksen.map((r) => r.id))),
  ]
  // Interne kosten van die facturen en reeksmaanden (Kosten en winst).
  const kosten = [
    ...(await inLijst<RuweKost>(admin, 'invoice_costs', 'invoice_id, recurring_id, maand, line_id, kostprijs_excl, status', 'invoice_id', facturen.map((f) => f.id)).catch(() => [] as RuweKost[])),
    ...(await inLijst<RuweKost>(admin, 'invoice_costs', 'invoice_id, recurring_id, maand, line_id, kostprijs_excl, status', 'recurring_id', reeksen.map((r) => r.id)).catch(() => [] as RuweKost[])),
  ]
  const factuurIds = new Set(facturen.map((f) => f.id))
  // Een maandfactuur uit een contractreeks hoort bij dat contract, ook als ze zelf (nog) geen contract_id heeft.
  const maandFactuurContract = new Map<string, string>()
  for (const m of maanden) if (m.invoice_id) { const r = reeksen.find((x) => x.id === m.recurring_id); if (r) maandFactuurContract.set(m.invoice_id, r.contract_id) }

  const nuMaand = brusselsMaand()
  for (const c of (contracten ?? []) as { id: string; end_date: string | null; contract_waarde_excl?: number | string | null; contract_waarde_gewijzigd_op?: string | null; contract_waarde_gewijzigd_door?: string | null }[]) {
    const items: AflItem[] = []
    for (const f of facturen) {
      const eff = f.contract_id ?? maandFactuurContract.get(f.id) ?? null
      const it = itemUitFactuur({ ...f, contract_id: eff }, regels, c.id)
      if (it) items.push(it)
    }
    let doorlopend = false
    for (const r of reeksen.filter((x) => x.contract_id === c.id)) {
      const res = itemsUitReeks(r, maanden, regels, c.end_date ? String(c.end_date).slice(0, 7) : null, nuMaand, factuurIds)
      items.push(...res.items); doorlopend = doorlopend || res.doorlopend
    }
    items.sort((a, b) => (a.datum ?? '9999').localeCompare(b.datum ?? '9999'))
    const waarde = c.contract_waarde_excl === null || c.contract_waarde_excl === undefined || c.contract_waarde_excl === '' ? null : Number(c.contract_waarde_excl)
    const eigenWijzigingen = wijzigingen.filter((w) => w.contract_id === c.id).map((w) => ({ ...w, bedrag_excl: Number(w.bedrag_excl) || 0 }))
      .sort((a, b) => String(b.aangemaakt_op).localeCompare(String(a.aangemaakt_op)))
    const factuurContract = new Map(facturen.map((f) => [f.id, f.contract_id ?? maandFactuurContract.get(f.id) ?? null]))
    const regelContract = new Map(regels.filter((r) => r.invoice_id).map((r) => [r.id, r.contract_id]))
    uit.set(c.id, {
      contract_id: c.id, waarde, waarde_gewijzigd_op: c.contract_waarde_gewijzigd_op ?? null, waarde_gewijzigd_door: c.contract_waarde_gewijzigd_door ?? null,
      items, doorlopend, aflettering: berekenAflettering(waarde, items, verminderingVan(eigenWijzigingen)),
      wijzigingen: eigenWijzigingen, winst: berekenContractWinst(items, kosten, regelContract, factuurContract, c.id),
    })
  }
  return uit
}

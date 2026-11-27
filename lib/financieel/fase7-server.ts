import 'server-only'
import { projectOnderwerp } from '@/lib/opdrachten-kanban'
import { klantWaarde, margePerProject, kostTotaal, type GeldRij, type Waarde } from './fase7'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export const UURTARIEF_SLEUTEL = 'intern_uurtarief'
const UITGEREIKT = ['verstuurd', 'gefactureerd', 'betaald']
const vandaagBrussel = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

export async function leesUurtarief(admin: Admin): Promise<number | null> {
  const { data } = await admin.from('app_settings').select('value').eq('key', UURTARIEF_SLEUTEL).maybeSingle()
  const n = Number((data?.value as { tarief?: unknown } | null)?.tarief)
  return Number.isFinite(n) && n > 0 ? n : null
}

export type KlantWaardeAntwoord = Waarde & { projecten: { id: string; naam: string; gefactureerd: number; kosten: number; marge: number; margePct: number | null }[]; uurtarief: number | null }

/**
 * Klantwaarde en marge van één klant (verbeterplan fase 7, punten 81 en 84).
 * Enkel lezen. Facturen = uitgereikte facturen (geen WAM of setter, geen
 * gecrediteerde) en gefactureerde maanden van terugkerende facturatie.
 * Kosten = kosten met deze klant (eenmalig of tot vandaag) en goedgekeurde
 * aankopen die nog geen kost werden. Uren = shoots en Solutions-stories,
 * enkel als er een intern uurtarief is.
 */
export async function klantWaardeVan(admin: Admin, clientId: string): Promise<KlantWaardeAntwoord> {
  const vandaag = vandaagBrussel()
  const kostenQ = async () => {
    const a = await admin.from('cost_entries').select('type, amount_excl, cost_date, start_date, end_date, billing_frequency, bedrijf, opdracht_id').eq('client_id', clientId)
    return a.error ? await admin.from('cost_entries').select('type, amount_excl, cost_date, start_date, end_date, billing_frequency, bedrijf').eq('client_id', clientId) : a
  }
  const aankopenQ = async () => {
    const a = await admin.from('purchases').select('amount_excl, entry_date, bedrijf, opdracht_id, status, cost_entry_id, deleted_at').eq('client_id', clientId)
    return a.error ? { data: [] } : a
  }
  const [{ data: inv }, { data: reeksen }, { data: kos }, { data: aank }, { data: kaarten }, { data: shoots }, { data: ngs }, uurtarief] = await Promise.all([
    admin.from('invoices').select('amount_excl, invoice_date, status, kind, bedrijf, contract_id').eq('client_id', clientId).limit(2000),
    admin.from('recurring_invoices').select('id, bedrijf, contract_id').eq('client_id', clientId),
    kostenQ(), aankopenQ(),
    admin.from('opdrachten').select('id, titel, diensten, contract_id').eq('client_id', clientId),
    admin.from('shoot_briefings').select('tijd_rijden_min, tijd_shoot_min, tijd_nabewerking_min, status').eq('client_id', clientId).then((r: { error: unknown; data: unknown }) => (r.error ? { data: [] } : r)),
    admin.from('ngs_projecten').select('id').eq('client_id', clientId).is('gearchiveerd_op', null).then((r: { error: unknown; data: unknown }) => (r.error ? { data: [] } : r)),
    leesUurtarief(admin).catch(() => null),
  ])
  const kaartVanContract = new Map(((kaarten ?? []) as { id: string; contract_id: string | null }[]).filter((k) => k.contract_id).map((k) => [k.contract_id!, k.id]))
  const facturen: GeldRij[] = [], gepland: GeldRij[] = []
  for (const f of (inv ?? []) as { amount_excl: number | null; invoice_date: string | null; status: string | null; kind: string | null; bedrijf: string | null; contract_id: string | null }[]) {
    const kind = String(f.kind ?? 'client')
    if (kind === 'wam' || kind.startsWith('setter')) continue
    const r: GeldRij = { bedrijf: f.bedrijf, bedrag: Number(f.amount_excl) || 0, datum: f.invoice_date, project: f.contract_id ? kaartVanContract.get(f.contract_id) ?? null : null }
    if (UITGEREIKT.includes(String(f.status))) facturen.push(r)
    else if (f.status === 'te_versturen') gepland.push(r)
  }
  const rs = (reeksen ?? []) as { id: string; bedrijf: string | null; contract_id: string | null }[]
  if (rs.length) {
    const { data: maanden } = await admin.from('recurring_invoice_months').select('recurring_id, month, status, amount_excl, invoice_id, verwijderd_op').in('recurring_id', rs.map((r) => r.id))
    const per = new Map(rs.map((r) => [r.id, r]))
    for (const m of (maanden ?? []) as { recurring_id: string; month: string; status: string | null; amount_excl: number | null; invoice_id: string | null; verwijderd_op: string | null }[]) {
      if (m.invoice_id || m.verwijderd_op || m.status !== 'verstuurd') continue
      const r = per.get(m.recurring_id)
      facturen.push({ bedrijf: r?.bedrijf ?? null, bedrag: Number(m.amount_excl) || 0, datum: `${m.month.slice(0, 7)}-01`, project: r?.contract_id ? kaartVanContract.get(r.contract_id) ?? null : null })
    }
  }
  type KostRij = Parameters<typeof kostTotaal>[0] & { bedrijf: string | null; opdracht_id?: string | null }
  const kosten: GeldRij[] = ((kos ?? []) as KostRij[])
    .map((c) => ({ bedrijf: c.bedrijf, bedrag: kostTotaal(c, vandaag), datum: c.cost_date ?? c.start_date ?? null, project: c.opdracht_id ?? null }))
    .filter((c) => c.bedrag > 0)
  for (const a of (aank ?? []) as { amount_excl: number | null; entry_date: string | null; bedrijf: string | null; opdracht_id: string | null; status: string; cost_entry_id: string | null; deleted_at: string | null }[]) {
    if (a.deleted_at || a.cost_entry_id || !['approved', 'approved_under_threshold'].includes(a.status)) continue
    kosten.push({ bedrijf: a.bedrijf, bedrag: Number(a.amount_excl) || 0, datum: a.entry_date, project: a.opdracht_id })
  }
  let minuten = 0
  for (const s of (shoots ?? []) as { tijd_rijden_min: number | null; tijd_shoot_min: number | null; tijd_nabewerking_min: number | null; status: string | null }[]) {
    if (s.status === 'geannuleerd') continue
    minuten += (s.tijd_rijden_min ?? 0) + (s.tijd_shoot_min ?? 0) + (s.tijd_nabewerking_min ?? 0)
  }
  let uren = minuten / 60
  const ngsIds = ((ngs ?? []) as { id: string }[]).map((p) => p.id)
  if (ngsIds.length) {
    const { data: st } = await admin.from('ngs_user_stories').select('bestede_uren').in('project_id', ngsIds).is('verwijderd_op', null)
    uren += ((st ?? []) as { bestede_uren: number | null }[]).reduce((t, x) => t + Number(x.bestede_uren ?? 0), 0)
  }
  const w = klantWaarde({ facturen, gepland, kosten, uren, uurtarief })
  const naam = new Map(((kaarten ?? []) as { id: string; titel: string | null; diensten: string[] | null }[]).map((k) => [k.id, projectOnderwerp(k.diensten, k.titel) || k.titel || 'Project']))
  const projecten = margePerProject(facturen, kosten).map((p) => ({ id: p.project, naam: naam.get(p.project) ?? 'Project', gefactureerd: p.gefactureerd, kosten: p.kosten, marge: p.marge, margePct: p.margePct }))
  return { ...w, projecten, uurtarief }
}

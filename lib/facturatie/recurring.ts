import 'server-only'
import { billingDateFor, recurringActiveInMonth, inclFromExcl, shiftYM, type RecurringInvoice } from '@/lib/invoices'
import { logAudit } from '@/lib/audit'
import { vandaagBrussel, ymVan } from './planner-model'

/**
 * Terugkerende facturaties: stopzetten (nooit hard verwijderen) en de
 * maandstatus met momentopname. Er gaat niets naar ClickUp: de facturenlijst
 * en de planner zijn de werklijst.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
type Actor = { id: string; email?: string | null }

export const ANNULERING_OPMERKING = 'Deze facturatieopdracht werd automatisch geannuleerd omdat de terugkerende facturatie in de applicatie werd verwijderd.'

async function klantNaam(admin: Admin, clientId: string | null): Promise<string> {
  if (!clientId) return 'Onbekende klant'
  try { const { data } = await admin.from('clients').select('company_name').eq('id', clientId).maybeSingle(); return data?.company_name ?? 'Onbekende klant' } catch { return 'Onbekende klant' }
}

/** Veerkrachtige upsert (kolommen die nog niet gemigreerd zijn vallen weg). */
async function upsertMaand(admin: Admin, rij: Record<string, unknown>): Promise<void> {
  const r = { ...rij }
  for (let i = 0; i < 8; i++) {
    const { error } = await admin.from('recurring_invoice_months').upsert(r, { onConflict: 'recurring_id,month' })
    if (!error) return
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in r) { delete r[col]; continue }
    throw new Error(error.message)
  }
}

export type MaandStatusResultaat = { ok: true; taskId: null; warning: string | null }

/**
 * Status van één maand van een terugkerende facturatie. Bij 'verstuurd' wordt
 * het bedrag en de factuurdatum van dat moment vastgelegd (momentopname), zodat
 * een latere wijziging van de definitie de historiek niet meer raakt.
 */
export async function zetMaandStatus(admin: Admin, recurringId: string, month: string, status: string, actor: Actor): Promise<MaandStatusResultaat> {
  const { data: rec } = await admin.from('recurring_invoices').select('*').eq('id', recurringId).maybeSingle()
  const r = rec as RecurringInvoice | null
  const { data: bestaand } = await admin.from('recurring_invoice_months').select('*').eq('recurring_id', recurringId).eq('month', month).maybeSingle()
  const datum = bestaand?.billing_date ?? (r ? billingDateFor(month, r.invoice_day) : null)
  const rij: Record<string, unknown> = { recurring_id: recurringId, month, status }
  if (status === 'verstuurd' && r) {
    const excl = bestaand?.amount_excl != null ? Number(bestaand.amount_excl) : Number(r.amount_excl) || 0
    const btw = bestaand?.vat_pct != null ? Number(bestaand.vat_pct) : Number(r.vat_pct) || 0
    Object.assign(rij, { amount_excl: excl, vat_pct: btw, amount_incl: inclFromExcl(excl, btw), billing_date: datum })
  }
  if (status !== 'geannuleerd') Object.assign(rij, { cancelled_at: null, cancelled_by_email: null })
  await upsertMaand(admin, rij)
  void actor
  return { ok: true, taskId: null, warning: null }
}

/** Definitie gewijzigd: er is geen externe taak meer om bij te werken. Blijft bestaan voor de aanroepers. */
export async function werkToekomstigeMaandenBij(_admin: Admin, _recurringId: string): Promise<{ bijgewerkt: number; fouten: string[] }> {
  void _admin; void _recurringId
  return { bijgewerkt: 0, fouten: [] }
}

export type StopResultaat = {
  ok: true
  geannuleerdeMaanden: string[]
  behoudenMaanden: string[]
  eindmaand: string | null
  prognoseAangepast: boolean
}

/**
 * Terugkerende facturatie stopzetten ("verwijderen" in het scherm):
 *  - toekomstige en nog niet uitgevoerde maanden → 'geannuleerd'
 *  - de definitie krijgt einddatum = laatste uitgevoerde maand, plus deleted_at/door
 *  - uitgevoerde (verstuurde) maanden en hun facturen blijven staan
 *  - de automatisch aangemaakte prognose (revenue_entries) stopt op dezelfde maand
 * Er wordt niets hard verwijderd.
 */
export async function stopRecurring(admin: Admin, recurringId: string, actor: Actor, ip?: string | null, userAgent?: string | null): Promise<StopResultaat> {
  const { data: rec } = await admin.from('recurring_invoices').select('*').eq('id', recurringId).maybeSingle()
  const r = rec as (RecurringInvoice & { deleted_at?: string | null }) | null
  if (!r) throw new Error('Terugkerende facturatie niet gevonden.')
  const vandaag = vandaagBrussel()
  const vandaagYM = ymVan(vandaag)
  const { data: rijen } = await admin.from('recurring_invoice_months').select('*').eq('recurring_id', recurringId)
  type Rij = { month: string; status: string | null; invoice_id: string | null; billing_date: string | null }
  const maanden = (rijen ?? []) as Rij[]

  const uitgevoerd = maanden.filter((m) => m.status === 'verstuurd' || m.status === 'betaald' || !!m.invoice_id).map((m) => m.month).sort()
  const laatsteUitgevoerd = uitgevoerd.length ? uitgevoerd[uitgevoerd.length - 1] : null
  const start = (r.start_month ?? '').slice(0, 7)
  const eindmaand = laatsteUitgevoerd ?? shiftYM(start || vandaagYM, -1)

  const teAnnuleren = maanden.filter((m) => m.month > eindmaand && m.status !== 'verstuurd' && m.status !== 'betaald' && m.status !== 'geannuleerd' && !m.invoice_id)
  const geannuleerd: string[] = []
  for (const m of teAnnuleren) {
    await upsertMaand(admin, {
      recurring_id: recurringId, month: m.month, status: 'geannuleerd',
      cancelled_at: new Date().toISOString(), cancelled_by_email: actor.email ?? null,
      billing_date: m.billing_date ?? billingDateFor(m.month, r.invoice_day),
    })
    geannuleerd.push(m.month)
  }

  const patch: Record<string, unknown> = { end_month: eindmaand, deleted_at: new Date().toISOString(), deleted_by_email: actor.email ?? null }
  if (!laatsteUitgevoerd) patch.active = false
  {
    const p = { ...patch }
    for (let i = 0; i < 4; i++) {
      const { error } = await admin.from('recurring_invoices').update(p).eq('id', recurringId)
      if (!error) break
      const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
      if (col && col in p) { delete p[col]; continue }
      throw new Error(error.message)
    }
  }

  let prognoseAangepast = false
  if (r.revenue_id) {
    try {
      const { data: prog } = await admin.from('revenue_entries').select('id, type, notes, title, end_month').eq('id', r.revenue_id).maybeSingle()
      if (prog && prog.type === 'recurring' && (/automatisch/i.test(String(prog.notes ?? '')) || /automatische prognose/i.test(String(prog.title ?? '')))) {
        const nieuwEind = `${eindmaand}-01`
        if (!prog.end_month || String(prog.end_month).slice(0, 7) > eindmaand) {
          const { error } = await admin.from('revenue_entries').update({ end_month: nieuwEind }).eq('id', prog.id)
          prognoseAangepast = !error
        }
      }
    } catch { /* best-effort */ }
  }

  const behouden = maanden.filter((m) => !teAnnuleren.includes(m)).map((m) => m.month).sort()
  await logAudit({
    action: 'invoice.recurring.stopgezet', entityType: 'recurring_invoice', entityId: recurringId,
    summary: `Terugkerende facturatie stopgezet (${await klantNaam(admin, r.client_id)}, € ${Number(r.amount_excl).toFixed(2)}/maand): ${geannuleerd.length} toekomstige maand(en) geannuleerd, einde ${eindmaand}`,
    actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff',
    metadata: { geannuleerd, behouden, eindmaand, prognoseAangepast, revenue_id: r.revenue_id },
    ip: ip ?? null, userAgent: userAgent ?? null,
  })
  return { ok: true, geannuleerdeMaanden: geannuleerd, behoudenMaanden: behouden, eindmaand, prognoseAangepast }
}

/** Is een maand van een (eventueel gestopte) terugkerende facturatie nog actief? */
export const maandActief = (r: RecurringInvoice, month: string): boolean => recurringActiveInMonth(r, month)

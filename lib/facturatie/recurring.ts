import 'server-only'
import { billingDateFor, recurringActiveInMonth, inclFromExcl, shiftYM, type RecurringInvoice } from '@/lib/invoices'
import { createInvoiceTask, completeInvoiceTask, annuleerFactuurTaak, werkFactuurTaakBij, INVOICE_ASSIGNEE_NAME } from '@/lib/clickup'
import { logAudit } from '@/lib/audit'
import { vandaagBrussel, ymVan } from './planner-model'

/**
 * Terugkerende facturaties: stopzetten (nooit hard verwijderen), maandstatus
 * met momentopname, en ClickUp-taken van toekomstige maanden bijwerken.
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

export type MaandStatusResultaat = { ok: true; taskId: string | null; warning: string | null }

/**
 * Status van één maand van een terugkerende facturatie. Bij 'verstuurd' wordt
 * het bedrag en de factuurdatum van dat moment vastgelegd (momentopname), zodat
 * een latere wijziging van de definitie de historiek niet meer raakt.
 */
export async function zetMaandStatus(admin: Admin, recurringId: string, month: string, status: string, actor: Actor): Promise<MaandStatusResultaat> {
  const { data: rec } = await admin.from('recurring_invoices').select('*').eq('id', recurringId).maybeSingle()
  const r = rec as RecurringInvoice | null
  const { data: bestaand } = await admin.from('recurring_invoice_months').select('*').eq('recurring_id', recurringId).eq('month', month).maybeSingle()
  let taskId: string | null = bestaand?.clickup_task_id ?? null
  let warning: string | null = null
  const datum = bestaand?.billing_date ?? (r ? billingDateFor(month, r.invoice_day) : null)
  if (!taskId && r && status !== 'geannuleerd') {
    const task = await createInvoiceTask({ clientName: await klantNaam(admin, r.client_id), amountIncl: Number(r.amount_incl) || 0, invoiceDate: datum ?? billingDateFor(month, r.invoice_day), type: 'Recurring' })
    taskId = task.taskId
    if (!task.assigneeFound) warning = `ClickUp-gebruiker "${INVOICE_ASSIGNEE_NAME}" niet gevonden — taak zonder verantwoordelijke aangemaakt.`
  }
  const rij: Record<string, unknown> = { recurring_id: recurringId, month, status, clickup_task_id: taskId }
  if (status === 'verstuurd' && r) {
    const excl = bestaand?.amount_excl != null ? Number(bestaand.amount_excl) : Number(r.amount_excl) || 0
    const btw = bestaand?.vat_pct != null ? Number(bestaand.vat_pct) : Number(r.vat_pct) || 0
    Object.assign(rij, { amount_excl: excl, vat_pct: btw, amount_incl: inclFromExcl(excl, btw), billing_date: datum })
  }
  if (status !== 'geannuleerd') Object.assign(rij, { cancelled_at: null, cancelled_by_email: null })
  await upsertMaand(admin, rij)
  if (status === 'verstuurd' && taskId) await completeInvoiceTask(taskId)
  void actor
  return { ok: true, taskId, warning }
}

/**
 * Definitie gewijzigd (factuurdag, bedrag, omschrijving): toekomstige, nog
 * niet uitgevoerde maanden met een ClickUp-taak krijgen de nieuwe naam/datum.
 * Historische maanden blijven onaangeroerd. Best-effort.
 */
export async function werkToekomstigeMaandenBij(admin: Admin, recurringId: string): Promise<{ bijgewerkt: number; fouten: string[] }> {
  const uit = { bijgewerkt: 0, fouten: [] as string[] }
  try {
    const { data: rec } = await admin.from('recurring_invoices').select('*').eq('id', recurringId).maybeSingle()
    const r = rec as RecurringInvoice | null
    if (!r) return uit
    const vandaagYM = ymVan(vandaagBrussel())
    const { data: rijen } = await admin.from('recurring_invoice_months').select('month, status, clickup_task_id, billing_date').eq('recurring_id', recurringId).gte('month', vandaagYM)
    const klant = await klantNaam(admin, r.client_id)
    for (const m of (rijen ?? []) as { month: string; status: string | null; clickup_task_id: string | null; billing_date: string | null }[]) {
      if (!m.clickup_task_id || m.status === 'verstuurd' || m.status === 'geannuleerd') continue
      try {
        await werkFactuurTaakBij(m.clickup_task_id, { naam: `Factuur versturen — ${klant}`, dueDate: m.billing_date ?? billingDateFor(m.month, r.invoice_day), omschrijving: `Klant: ${klant}\nBedrag: € ${(Number(r.amount_incl) || 0).toFixed(2)} incl. btw\nFactuurdatum: ${m.billing_date ?? billingDateFor(m.month, r.invoice_day)}\nType: Recurring` })
        uit.bijgewerkt++
      } catch (e) { uit.fouten.push(`${m.month}: ${e instanceof Error ? e.message.slice(0, 120) : 'fout'}`) }
    }
  } catch (e) { uit.fouten.push(e instanceof Error ? e.message.slice(0, 120) : 'fout') }
  return uit
}

export type StopResultaat = {
  ok: true
  geannuleerdeMaanden: string[]
  behoudenMaanden: string[]
  eindmaand: string | null
  clickup: { afgesloten: string[]; fouten: string[] }
  prognoseAangepast: boolean
}

/**
 * Terugkerende facturatie stopzetten ("verwijderen" in het scherm):
 *  - toekomstige en nog niet uitgevoerde maanden → 'geannuleerd' (incl. ClickUp-taak afsluiten + opmerking)
 *  - de definitie krijgt einddatum = laatste uitgevoerde maand, plus deleted_at/door
 *  - uitgevoerde (verstuurde) maanden en hun facturen blijven staan
 *  - de automatisch aangemaakte prognose (revenue_entries) stopt op dezelfde maand
 * Er wordt niets hard verwijderd, en er komt nooit een nieuwe taak bij.
 */
export async function stopRecurring(admin: Admin, recurringId: string, actor: Actor, ip?: string | null, userAgent?: string | null): Promise<StopResultaat> {
  const { data: rec } = await admin.from('recurring_invoices').select('*').eq('id', recurringId).maybeSingle()
  const r = rec as (RecurringInvoice & { deleted_at?: string | null }) | null
  if (!r) throw new Error('Terugkerende facturatie niet gevonden.')
  const vandaag = vandaagBrussel()
  const vandaagYM = ymVan(vandaag)
  const { data: rijen } = await admin.from('recurring_invoice_months').select('*').eq('recurring_id', recurringId)
  type Rij = { month: string; status: string | null; clickup_task_id: string | null; invoice_id: string | null; billing_date: string | null }
  const maanden = (rijen ?? []) as Rij[]

  const uitgevoerd = maanden.filter((m) => m.status === 'verstuurd' || m.status === 'betaald' || !!m.invoice_id).map((m) => m.month).sort()
  const laatsteUitgevoerd = uitgevoerd.length ? uitgevoerd[uitgevoerd.length - 1] : null
  const start = (r.start_month ?? '').slice(0, 7)
  // Einddatum: de laatste uitgevoerde maand; is er nooit iets uitgevoerd, dan
  // de maand vóór de start (= geen enkele maand meer actief).
  const eindmaand = laatsteUitgevoerd ?? shiftYM(start || vandaagYM, -1)

  // Alle maanden die nog niet uitgevoerd zijn en na de einddatum vallen: annuleren.
  const teAnnuleren = maanden.filter((m) => m.month > eindmaand && m.status !== 'verstuurd' && m.status !== 'betaald' && m.status !== 'geannuleerd' && !m.invoice_id)
  const geannuleerd: string[] = []
  const clickup = { afgesloten: [] as string[], fouten: [] as string[] }
  for (const m of teAnnuleren) {
    await upsertMaand(admin, {
      recurring_id: recurringId, month: m.month, status: 'geannuleerd', clickup_task_id: m.clickup_task_id,
      cancelled_at: new Date().toISOString(), cancelled_by_email: actor.email ?? null,
      billing_date: m.billing_date ?? billingDateFor(m.month, r.invoice_day),
    })
    geannuleerd.push(m.month)
    if (m.clickup_task_id) {
      try { await annuleerFactuurTaak(m.clickup_task_id, ANNULERING_OPMERKING); clickup.afgesloten.push(m.clickup_task_id) }
      catch (e) { clickup.fouten.push(`${m.clickup_task_id}: ${e instanceof Error ? e.message.slice(0, 120) : 'fout'}`) }
    }
  }
  // Maanden zonder rij bestaan enkel afgeleid; door de einddatum verschijnen ze niet meer.

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

  // De automatisch aangemaakte prognose stopt mee — nooit verwijderen (historiek).
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
    metadata: { geannuleerd, behouden, eindmaand, clickup, prognoseAangepast, revenue_id: r.revenue_id },
    ip: ip ?? null, userAgent: userAgent ?? null,
  })
  return { ok: true, geannuleerdeMaanden: geannuleerd, behoudenMaanden: behouden, eindmaand, clickup, prognoseAangepast }
}

/** Is een maand van een (eventueel gestopte) terugkerende facturatie nog actief? */
export const maandActief = (r: RecurringInvoice, month: string): boolean => recurringActiveInMonth(r, month)

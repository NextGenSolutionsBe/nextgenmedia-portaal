import 'server-only'
import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
type Actor = { userId: string; email?: string | null }

/**
 * Eén facturatie-item (invoice) definitief verwijderen uit de INTERNE planner.
 * Klant, contract, opdracht en WAM-termijn blijven bestaan (enkel losgekoppeld);
 * regels, historiek, kosten en bijlagen gaan mee (cascade). Er wordt nooit iets
 * in externe boekhoudsoftware verwijderd. Hing het item aan een maand van een
 * terugkerende reeks, dan wordt die maand als verwijderd gemarkeerd zodat ze
 * niet opnieuw opduikt.
 */
export async function verwijderFactuur(admin: Admin, id: string, actor: Actor, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<{ losgemaakt: Record<string, number>; maand: { recurring_id: string; month: string } | null }> {
  const { data: inv } = await admin.from('invoices').select('*').eq('id', id).maybeSingle()
  if (!inv) throw new Error('Factuur niet gevonden')
  let klant: string | null = null
  if (inv.client_id) {
    const { data: c } = await admin.from('clients').select('company_name').eq('id', inv.client_id).maybeSingle()
    klant = (c?.company_name as string | null) ?? null
  }
  const { data: maand } = await admin.from('recurring_invoice_months').select('recurring_id, month').eq('invoice_id', id).maybeSingle()
  const losgemaakt: Record<string, number> = {}
  for (const [tabel, kolom] of [['contract_facturatie_opdrachten', 'invoice_id'], ['opdrachten', 'invoice_id'], ['vesting_wam_termijnen', 'invoice_id'], ['recurring_invoice_months', 'invoice_id']] as const) {
    try {
      const { data } = await admin.from(tabel).update({ [kolom]: null }).eq(kolom, id).select('id')
      if ((data ?? []).length) losgemaakt[tabel] = (data ?? []).length
    } catch { /* tabel of kolom kan ontbreken */ }
  }
  if (maand) {
    await admin.from('recurring_invoice_months').update({ verwijderd_op: new Date().toISOString(), verwijderd_door: actor.email ?? null, status: 'geannuleerd' }).eq('recurring_id', maand.recurring_id).eq('month', maand.month)
  }
  const { error } = await admin.from('invoices').delete().eq('id', id)
  if (error) throw new Error(error.message)
  await logAudit({
    action: 'invoice.deleted', entityType: 'invoice', entityId: id,
    summary: `Facturatie-item verwijderd: ${inv.extern_factuurnummer ? `${inv.extern_factuurnummer} · ` : ''}${klant ?? 'zonder klant'} · € ${Number(inv.amount_excl ?? 0).toFixed(2)} excl. (${String(inv.invoice_date).slice(0, 10)})`,
    actorUserId: actor.userId, actorEmail: actor.email ?? null, actorRole: 'staff',
    metadata: { klant, bedrag_excl: inv.amount_excl, status: inv.status, contract_id: inv.contract_id ?? null, losgemaakt, reeksmaand: maand ?? null },
    ip: meta.ip ?? null, userAgent: meta.userAgent ?? null,
  })
  try {
    revalidatePath('/admin/invoices'); revalidatePath('/admin/invoices/planner')
    if (inv.contract_id) revalidatePath(`/admin/contracts/${inv.contract_id}`)
    if (inv.client_id) revalidatePath(`/admin/clients/${inv.client_id}`)
  } catch { /* */ }
  return { losgemaakt, maand: (maand as { recurring_id: string; month: string } | null) ?? null }
}

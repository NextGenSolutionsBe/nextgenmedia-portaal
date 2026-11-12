import 'server-only'
import { revalidatePath } from 'next/cache'
import { inclFromExcl } from '@/lib/invoices'
import { logAudit } from '@/lib/audit'
import { logContractEvent } from '@/lib/contract-audit'
import { canonicalStatus } from '@/lib/contract-status'
import { contractPdf } from '@/lib/contracten/pdf-herstel'
import { leesFacturatieplan } from '@/lib/contracten/facturatieplan-ai'
import { maakPlan, planSamenvatting, postenVoorContract, type AiPosten, type Plan } from './contract-plan'

/**
 * Facturen automatisch plannen zodra een contract getekend is (tekenlink,
 * opgeladen getekende pdf of handmatig op getekend). Zo vergeet niemand een
 * factuur: elke factuur van het contract staat meteen bij "Te factureren".
 *
 *  1. Enkel een getekend contract, nooit voor de testklant.
 *  2. Heeft het contract al facturen of een maandreeks, dan plande het team al
 *     zelf: niets toevoegen (geen dubbels).
 *  3. Posten uit de pdf (AI) + wat het team in de app invulde (gaat voor).
 *  4. Elke factuur = een factuuritem "Te factureren" met titel, omschrijving
 *     (wat inbegrepen is), bedrag, btw en het bestelbonnummer als dat er is.
 *     `voorstel_sleutel` is uniek: twee keer plannen maakt nooit dubbels.
 *  5. Contractwaarde, frequentie en aantal invullen als ze nog leeg zijn.
 *  6. Lukt het niet volledig, dan zegt de tijdlijn wat ontbreekt en staat het
 *     contract in het Command Center (blok "Facturen plannen").
 * Verstuurd wordt er niets: elke factuur blijft een handmatige stap.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: any }

export type PlanResultaat =
  | { status: 'gepland'; aantal: number; totaal: number; samenvatting: string; opmerkingen: string[] }
  | { status: 'al_gepland'; aantal: number }
  | { status: 'onvolledig'; ontbreekt: string[]; opmerkingen: string[] }
  | { status: 'overgeslagen'; reden: string }

const TESTKLANT = /^test$/i

/** Facturen en maandreeksen die al aan het contract hangen (geannuleerde tellen niet). */
async function bestaandeFacturatie(admin: Admin, id: string): Promise<number> {
  const [f, r] = await Promise.all([
    admin.from('invoices').select('id, status').eq('contract_id', id),
    admin.from('recurring_invoices').select('id, deleted_at').eq('contract_id', id),
  ])
  const facturen = ((f.data ?? []) as { status: string }[]).filter((x) => !['geannuleerd', 'gecrediteerd'].includes(x.status)).length
  const reeksen = ((r.data ?? []) as { deleted_at: string | null }[]).filter((x) => !x.deleted_at).length
  return facturen + reeksen
}

async function invoegen(admin: Admin, rij: Record<string, unknown>): Promise<string> {
  const p = { ...rij }
  for (let i = 0; i < 10; i++) {
    const { data, error } = await admin.from('invoices').insert(p).select('id').single()
    if (!error) return String(data.id)
    if (error.code === '23505' || /duplicate key/i.test(error.message)) return 'dubbel'
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in p) { delete p[col]; continue }
    throw new Error(error.message)
  }
  throw new Error('Opslaan mislukt')
}

async function log(admin: Admin, id: string, status: string | null, sync: 'ok' | 'onvolledig' | 'fout', details: Record<string, unknown>, fout?: string | null) {
  try {
    await admin.from('contract_facturatie_log').insert({ contract_id: id, gebeurtenis: 'facturen_plannen', contractstatus: status, verwerking_sleutel: `plan:${id}`, sync_status: sync, fout: fout ?? null, details })
  } catch { /* log is een extra */ }
}

/** Het plan berekenen zonder iets te bewaren (voor het scherm en de diagnose). */
export async function berekenPlan(admin: Admin, contractId: string, opties: { metAi?: boolean } = {}): Promise<{ plan: Plan; aiFout: string | null; contract: Record<string, unknown>; klant: { company_name?: string; btw_nummer?: string | null } | null }> {
  const { data: c } = await admin.from('contracts').select('*').eq('id', contractId).maybeSingle()
  if (!c) throw new Error('Contract niet gevonden')
  const { data: klant } = c.client_id ? await admin.from('clients').select('company_name, btw_nummer').eq('id', c.client_id).maybeSingle() : { data: null }
  let ai: AiPosten | null = null, aiFout: string | null = null
  if (opties.metAi !== false && process.env.ANTHROPIC_API_KEY) {
    try {
      const pdf = await contractPdf(admin, contractId, c.signed_pdf_path || c.klant_getekend_pdf_path || c.pdf_path)
      if (pdf) ai = await leesFacturatieplan(Buffer.from(await pdf.arrayBuffer()).toString('base64'))
      else aiFout = 'Geen contract-pdf gevonden om te lezen.'
    } catch (e) { aiFout = e instanceof Error ? e.message : String(e) }
  }
  const { posten, btwPct, moment, opmerkingen } = postenVoorContract(c, ai, klant?.btw_nummer ?? null)
  const getekendOp = c.signed_at ? String(c.signed_at).slice(0, 10) : null
  const plan = maakPlan({ contractTitel: c.title ?? 'contract', getekendOp, posten, btwPct, moment })
  plan.opmerkingen.unshift(...opmerkingen)
  if (aiFout) plan.opmerkingen.push(`Het contract kon niet gelezen worden (${aiFout}); gepland uit de gegevens in de app.`)
  return { plan, aiFout, contract: c, klant }
}

export async function planFacturenUitContract(admin: Admin, contractId: string, opties: { door?: string | null; userId?: string | null } = {}): Promise<PlanResultaat> {
  const { data: c } = await admin.from('contracts').select('id, title, status, client_id').eq('id', contractId).maybeSingle()
  if (!c) return { status: 'overgeslagen', reden: 'Contract niet gevonden' }
  if (canonicalStatus(c.status) !== 'getekend') return { status: 'overgeslagen', reden: 'Het contract is nog niet getekend.' }
  if (!c.client_id) return { status: 'overgeslagen', reden: 'Er hangt geen klant aan het contract.' }
  const { data: k } = await admin.from('clients').select('company_name').eq('id', c.client_id).maybeSingle()
  if (TESTKLANT.test(String(k?.company_name ?? '').trim())) return { status: 'overgeslagen', reden: 'Testklant' }
  const al = await bestaandeFacturatie(admin, contractId)
  if (al > 0) return { status: 'al_gepland', aantal: al }

  const { plan, contract } = await berekenPlan(admin, contractId)
  const status = String(contract.status ?? '')
  if (plan.ontbreekt.length || !plan.facturen.length) {
    await log(admin, contractId, status, 'onvolledig', { ontbreekt: plan.ontbreekt, opmerkingen: plan.opmerkingen })
    await logContractEvent(admin, contractId, 'facturen_plannen_onvolledig', { actor: opties.door ?? 'systeem', meta: { ontbreekt: plan.ontbreekt, opmerkingen: plan.opmerkingen } })
    return { status: 'onvolledig', ontbreekt: plan.ontbreekt, opmerkingen: plan.opmerkingen }
  }

  const termijn = 30
  const bestelbon = typeof contract.bestelbon_nummer === 'string' && contract.bestelbon_nummer.trim() ? contract.bestelbon_nummer.trim() : null
  const ids: string[] = []
  for (const f of plan.facturen) {
    const verval = new Date(`${f.datum}T12:00:00Z`); verval.setUTCDate(verval.getUTCDate() + termijn)
    const id = await invoegen(admin, {
      client_id: c.client_id, contract_id: contractId, service_slug: contract.service_slug ?? null,
      invoice_date: f.datum, invoice_month: f.datum.slice(0, 7), periode: f.periode, prestatie_van: f.van, prestatie_tot: f.tot,
      description: f.titel, amount_excl: f.bedrag, vat_pct: f.btw, amount_incl: inclFromExcl(f.bedrag, f.btw), contract_bedrag_excl: f.bedrag,
      status: 'te_versturen', source: 'contract', kind: 'client', factuur_type: f.sleutel.includes('eenmalig') ? 'eenmalig' : 'terugkerend', currency: 'EUR',
      payment_term_days: termijn, due_date: verval.toISOString().slice(0, 10), betaalstatus: 'niet_betaald', betaald_bedrag: 0,
      klant_referentie: bestelbon, note: 'Automatisch gepland uit het getekende contract. Kijk titel, omschrijving en bedrag na voor je factureert.',
      voorstel_sleutel: `${contractId}:${f.sleutel}`, created_by: opties.userId ?? null,
    })
    if (id === 'dubbel') continue
    ids.push(id)
    try { await admin.from('invoice_lines').insert({ invoice_id: id, volgnr: 1, artikel: f.titel, omschrijving: f.omschrijving, aantal: 1, eenheid: f.eenheid, prijs_excl: f.bedrag, btw_pct: f.btw, korting_pct: 0, is_extra: false, classificatie: 'dienst' }) } catch { /* bedrag staat ook op de factuur */ }
    try { await admin.from('invoice_wijzigingen').insert({ invoice_id: id, actie: 'aangemaakt', veld: 'contract', oud: null, nieuw: `Automatisch gepland uit het getekende contract ${contract.title ?? contractId} (${f.periode})`, actor_email: opties.door ?? null }) } catch { /* */ }
  }

  // Contractwaarde en facturatieafspraken invullen waar ze nog leeg zijn.
  const hoofd = plan.facturen.filter((f) => f.post === 0)
  const patch: Record<string, unknown> = {}
  if (contract.contract_waarde_excl === null || contract.contract_waarde_excl === undefined) {
    patch.contract_waarde_excl = plan.totaal; patch.contract_waarde_gewijzigd_op = new Date().toISOString(); patch.contract_waarde_gewijzigd_door = 'automatisch uit het contract'
  }
  if (!contract.expected_invoice_count && hoofd.length) patch.expected_invoice_count = hoofd.length
  if ((contract.expected_invoice_amount_excl === null || contract.expected_invoice_amount_excl === undefined) && hoofd.length) patch.expected_invoice_amount_excl = hoofd[0].bedrag
  for (let i = 0; i < 6 && Object.keys(patch).length; i++) {
    const { error } = await admin.from('contracts').update(patch).eq('id', contractId)
    if (!error) break
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in patch) { delete patch[col]; continue }
    break
  }

  const samenvatting = planSamenvatting(plan)
  await log(admin, contractId, status, 'ok', { invoice_ids: ids, samenvatting, opmerkingen: plan.opmerkingen })
  await logContractEvent(admin, contractId, 'facturen_gepland', { actor: opties.door ?? 'systeem', meta: { aantal: ids.length, totaal: plan.totaal, samenvatting, opmerkingen: plan.opmerkingen } })
  await logAudit({
    action: 'contract.facturen_gepland', entityType: 'contract', entityId: contractId,
    summary: `Facturen gepland uit "${contract.title ?? contractId}": ${samenvatting}`,
    actorUserId: opties.userId ?? null, actorEmail: opties.door ?? null, actorRole: 'system',
    metadata: { invoice_ids: ids, opmerkingen: plan.opmerkingen },
  }).catch(() => {})
  try { revalidatePath(`/admin/contracts/${contractId}`); revalidatePath('/admin/invoices'); revalidatePath('/admin') } catch { /* buiten een request */ }
  return { status: 'gepland', aantal: ids.length, totaal: plan.totaal, samenvatting, opmerkingen: plan.opmerkingen }
}

/** Voor waitUntil: nooit gooien, enkel loggen. */
export function planNaOndertekening(admin: Admin, contractId: string, door?: string | null): Promise<void> {
  return planFacturenUitContract(admin, contractId, { door }).then((r) => {
    if (r.status === 'onvolledig') console.warn('[facturen plannen] onvolledig:', contractId, r.ontbreekt.join(', '))
  }).catch(async (e) => {
    const fout = e instanceof Error ? e.message : String(e)
    console.error('[facturen plannen]', contractId, fout)
    await log(admin, contractId, null, 'fout', {}, fout)
  })
}

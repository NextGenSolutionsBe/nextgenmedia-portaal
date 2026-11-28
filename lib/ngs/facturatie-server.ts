import 'server-only'
import { revalidatePath } from 'next/cache'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { inclFromExcl } from '@/lib/invoices'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { betaaltermijnVan } from '@/lib/bedrijven/betaaltermijn-server'
import { verrekening, vervaldag, auditRegels, workflowRegels, totaalVan, type FactuurRegel } from './facturatie'

/**
 * Facturen van NextGenSolutions (nieuwe werking fase 5). Ze komen bij Te
 * factureren, zoals de facturen uit een contract; versturen blijft altijd een
 * mens. De sleutel (`ngs-audit:<deal>`, `ngs-workflow:<id>`) maakt dat er nooit
 * twee komen, ook niet bij twee klikken tegelijk.
 */
type Admin = ReturnType<typeof createAdminSupabaseClient>
const SOLUTIONS = 'nextgensolutions'
const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const eur = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

async function invoeg(admin: Admin, rij: Record<string, unknown>): Promise<string | 'dubbel'> {
  const p = { ...rij }
  for (let i = 0; i < 10; i++) {
    const { data, error } = await admin.from('invoices').insert(p).select('id').single()
    if (!error) return String((data as { id: string }).id)
    if (error.code === '23505' || /duplicate key/i.test(error.message)) return 'dubbel'
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in p) { delete p[col]; continue }
    throw new Error(error.message)
  }
  throw new Error('Opslaan mislukt')
}

/** Eén factuur bij Te factureren met haar regels. Bestaat de sleutel al, dan die factuur. */
async function zetFactuur(admin: Admin, o: { clientId: string; sleutel: string; titel: string; regels: FactuurRegel[]; note: string; door: string | null }): Promise<string> {
  const inst = await leesInstellingen()
  const btw = inst.facturatie.standaard_btw_pct
  const termijn = await betaaltermijnVan(admin, SOLUTIONS)
  const dag = vandaag()
  const bedrag = totaalVan(o.regels)
  const id = await invoeg(admin, {
    client_id: o.clientId, invoice_date: dag, invoice_month: dag.slice(0, 7), description: o.titel,
    amount_excl: bedrag, vat_pct: btw, amount_incl: inclFromExcl(bedrag, btw), contract_bedrag_excl: bedrag,
    status: 'te_versturen', source: 'ngs', kind: 'client', factuur_type: 'eenmalig', currency: 'EUR',
    payment_term_days: termijn, due_date: vervaldag(dag, termijn), betaalstatus: 'niet_betaald', betaald_bedrag: 0,
    note: o.note, voorstel_sleutel: o.sleutel, bedrijf: SOLUTIONS,
  })
  if (id === 'dubbel') {
    const { data } = await admin.from('invoices').select('id').eq('voorstel_sleutel', o.sleutel).not('status', 'in', '(geannuleerd,gecrediteerd)').maybeSingle()
    return String((data as { id: string } | null)?.id ?? '')
  }
  try {
    await admin.from('invoice_lines').insert(o.regels.map((r, i) => ({
      invoice_id: id, volgnr: i + 1, artikel: r.artikel, omschrijving: r.omschrijving, aantal: 1, eenheid: 'forfait',
      prijs_excl: r.prijs, btw_pct: btw, korting_pct: 0, is_extra: false, classificatie: 'dienst', bedrijf: SOLUTIONS,
    })))
  } catch { /* het bedrag staat ook op de factuur */ }
  try { await admin.from('invoice_wijzigingen').insert({ invoice_id: id, actie: 'aangemaakt', veld: 'bron', oud: null, nieuw: o.note, actor_email: o.door }) } catch { /* */ }
  try { revalidatePath('/admin/invoices'); revalidatePath('/admin') } catch { /* buiten een request */ }
  return id
}

async function tijdlijn(admin: Admin, dealId: string | null, tekst: string, door: string | null) {
  if (dealId) await admin.from('ngs_deal_notities').insert({ deal_id: dealId, tekst, soort: 'systeem', door })
}

/**
 * De auditfactuur, vooraf: zodra de deal naar Audit gaat. Enkel met een klant en
 * een prijs; een tweede keer (terug en weer naar Audit) maakt geen tweede factuur.
 */
export async function maakAuditFactuur(admin: Admin, dealId: string, door: string | null): Promise<{ id: string; bedrag: number } | null> {
  const { data } = await admin.from('ngs_deals').select('id, bedrijf, client_id, processen, audit_prijs, audit_factuur_id').eq('id', dealId).maybeSingle()
  const d = data as { id: string; bedrijf: string; client_id: string | null; processen: number | null; audit_prijs: number | null; audit_factuur_id: string | null } | null
  if (!d || d.audit_factuur_id || !d.client_id || !(Number(d.audit_prijs) > 0)) return null
  const regels = auditRegels(d.processen, Number(d.audit_prijs))
  const id = await zetFactuur(admin, { clientId: d.client_id, sleutel: `ngs-audit:${d.id}`, titel: `Audit ${d.bedrijf}`, regels, note: `Audit van NextGenSolutions (${d.bedrijf})`, door })
  if (!id) return null
  await admin.from('ngs_deals').update({ audit_factuur_id: id, updated_at: new Date().toISOString() }).eq('id', d.id)
  await tijdlijn(admin, d.id, `Auditfactuur bij Te factureren (${eur(totaalVan(regels))})`, door)
  return { id, bedrag: totaalVan(regels) }
}

/**
 * De factuur van een workflow, zodra ze naar Oplevering gaat. De eerste workflow
 * van de deal met een factuur verrekent de audit (hoogstens haar eigen bedrag).
 */
export async function maakWorkflowFactuur(admin: Admin, workflowId: string, door: string | null): Promise<{ id: string; bedrag: number; verrekend: number } | null> {
  const { data } = await admin.from('ngs_workflows').select('id, deal_id, project_id, naam, oplossing, prijs, factuur_id').eq('id', workflowId).maybeSingle()
  const w = data as { id: string; deal_id: string | null; project_id: string | null; naam: string; oplossing: string | null; prijs: number | null; factuur_id: string | null } | null
  if (!w || w.factuur_id || !(Number(w.prijs) > 0)) return null
  const [{ data: p }, { data: dl }] = await Promise.all([
    w.project_id ? admin.from('ngs_projecten').select('client_id').eq('id', w.project_id).maybeSingle() : Promise.resolve({ data: null }),
    w.deal_id ? admin.from('ngs_deals').select('id, client_id, audit_factuur_id').eq('id', w.deal_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const deal = dl as { id: string; client_id: string | null; audit_factuur_id: string | null } | null
  const clientId = (p as { client_id: string | null } | null)?.client_id ?? deal?.client_id ?? null
  if (!clientId) return null

  // Verrekening: enkel als de audit gefactureerd is (niet geannuleerd) en nog geen andere workflow ze verrekende.
  let auditBedrag = 0
  if (deal?.audit_factuur_id) {
    const [{ data: af }, { data: al }] = await Promise.all([
      admin.from('invoices').select('amount_excl, status').eq('id', deal.audit_factuur_id).maybeSingle(),
      admin.from('ngs_workflows').select('id').eq('deal_id', deal.id).gt('verrekend_bedrag', 0).neq('id', w.id).limit(1),
    ])
    const a = af as { amount_excl: number | null; status: string } | null
    if (a && !['geannuleerd', 'gecrediteerd'].includes(a.status) && !(al ?? []).length) auditBedrag = Number(a.amount_excl ?? 0)
  }
  const v = verrekening(auditBedrag, Number(w.prijs))
  const regels = workflowRegels(w.naam, w.oplossing, Number(w.prijs), v.verrekend)
  const id = await zetFactuur(admin, { clientId, sleutel: `ngs-workflow:${w.id}`, titel: w.naam, regels, note: `Workflow van NextGenSolutions: ${w.naam}`, door })
  if (!id) return null
  await admin.from('ngs_workflows').update({ factuur_id: id, verrekend_bedrag: v.verrekend || null, updated_at: new Date().toISOString() }).eq('id', w.id)
  await tijdlijn(admin, w.deal_id, `${w.naam}: factuur bij Te factureren (${eur(v.teFactureren)}${v.verrekend ? `, audit verrekend: ${eur(v.verrekend)}` : ''})`, door)
  return { id, bedrag: v.teFactureren, verrekend: v.verrekend }
}

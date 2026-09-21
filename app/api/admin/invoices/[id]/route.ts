import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { DEFAULT_VAT } from '@/lib/invoices'
import { normaliseerRegels, berekenTotalen, regelUitBedrag, verschillen, type FactuurRegel } from '@/lib/facturen/regels'
import { normaliseerVerzendstatus, afgeleideBetaalstatus, magInhoudBewerken, magNaar, redenVerplicht, type Verzendstatus, type Betaalstatus } from '@/lib/facturen/status'
import { vandaagBrussel } from '@/lib/facturatie/planner-model'

export const dynamic = 'force-dynamic'

/**
 * Eén factuur: lezen, bewerken (kop + regels), statussen en betaalstatus.
 *
 * Dit is de ENIGE plek waar een factuur inhoudelijk verandert — de
 * Facturen-module, de planner en het contractdetail praten allemaal met deze
 * route, zodat er nooit drie kopieën van dezelfde factuur bestaan.
 *
 * Rechten (bestaande rechtenmatrix, module "invoices"):
 *  · aanpassen  → kop, regels, datum, betaalstatus
 *  · goedkeuren → markeren als verstuurd (en terug)
 *  · verwijderen → annuleren of crediteren
 */

const UUID = /^[0-9a-f-]{36}$/i
const datum = (v: unknown): string | null | undefined => { if (v === null || v === '') return null; if (v === undefined) return undefined; const s = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined }
const tekst = (v: unknown, max: number): string | null => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null }
const num = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

async function historiek(admin: Admin, invoiceId: string, rijen: { actie: string; veld?: string | null; oud?: string | null; nieuw?: string | null; reden?: string | null }[], actorEmail: string | null) {
  if (!rijen.length) return
  try { await admin.from('invoice_wijzigingen').insert(rijen.map((r) => ({ invoice_id: invoiceId, actie: r.actie, veld: r.veld ?? null, oud: r.oud ?? null, nieuw: r.nieuw ?? null, reden: r.reden ?? null, actor_email: actorEmail }))) } catch { /* historiek mag nooit breken */ }
}

async function laad(admin: Admin, id: string) {
  const [{ data: inv }, { data: lijnen }, { data: wijzigingen }] = await Promise.all([
    admin.from('invoices').select('*').eq('id', id).maybeSingle(),
    admin.from('invoice_lines').select('*').eq('invoice_id', id).order('volgnr'),
    admin.from('invoice_wijzigingen').select('*').eq('invoice_id', id).order('created_at', { ascending: false }).limit(100),
  ])
  if (!inv) return null
  const [{ data: klant }, { data: contract }, { data: voorstel }] = await Promise.all([
    inv.client_id ? admin.from('clients').select('id, company_name').eq('id', inv.client_id).maybeSingle() : Promise.resolve({ data: null }),
    inv.contract_id ? admin.from('contracts').select('id, title, status').eq('id', inv.contract_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('contract_facturatie_opdrachten').select('id, volgnr, aantal, periode').eq('invoice_id', id).maybeSingle(),
  ])
  const btw = Number(inv.vat_pct) || DEFAULT_VAT
  let regels: FactuurRegel[] = normaliseerRegels((lijnen ?? []).map((l: Record<string, unknown>) => ({ ...l, artikel: l.artikel ?? l.omschrijving })), btw)
  // Facturen van vóór de regels: één regel die het bestaande bedrag draagt (niet opgeslagen tot iemand bewerkt).
  if (regels.length === 0) regels = [regelUitBedrag(String(inv.description ?? 'Factuur'), Number(inv.amount_excl) || 0, btw)]
  const totalen = berekenTotalen(regels)
  const verzendstatus = normaliseerVerzendstatus(inv.status)
  const vandaag = vandaagBrussel()
  return {
    factuur: {
      ...inv, verzendstatus,
      betaalstatus_afgeleid: afgeleideBetaalstatus({ verzendstatus, betaaldBedrag: Number(inv.betaald_bedrag) || 0, totaalIncl: Number(inv.amount_incl) || 0, vervaldatum: inv.due_date ? String(inv.due_date).slice(0, 10) : null, vandaag }),
      klant_naam: (klant as { company_name?: string } | null)?.company_name ?? null,
      contract_titel: (contract as { title?: string } | null)?.title ?? null,
      voorstel: voorstel ?? null,
      magInhoud: magInhoudBewerken(verzendstatus),
    },
    regels, totalen, wijzigingen: wijzigingen ?? [], vandaag,
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const d = await laad(admin, id)
    if (!d) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    return NextResponse.json(d)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

const ververs = (inv: { client_id?: string | null; contract_id?: string | null }) => {
  try {
    revalidatePath('/admin/invoices'); revalidatePath('/admin/invoices/planner')
    if (inv.contract_id) revalidatePath(`/admin/contracts/${inv.contract_id}`)
    if (inv.client_id) revalidatePath(`/admin/clients/${inv.client_id}`)
  } catch { /* */ }
}

/**
 * PATCH — kop en/of regels bijwerken. Inhoud (klant, contract, regels,
 * bedragen, btw) kan enkel zolang de factuur nog niet verstuurd is; datum,
 * vervaldatum, referentie en interne notitie mogen altijd.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await magIk('invoices', 'aanpassen')
    if (!actor) return NextResponse.json({ error: 'Je hebt geen recht om facturen aan te passen.' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const { data: inv } = await admin.from('invoices').select('*').eq('id', id).maybeSingle()
    if (!inv) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    const status = normaliseerVerzendstatus(inv.status)
    const inhoudOk = magInhoudBewerken(status)

    const patch: Record<string, unknown> = {}
    // Altijd aanpasbaar.
    if ('invoice_date' in b) { const d = datum(b.invoice_date); if (d === undefined || d === null) return NextResponse.json({ error: 'Ongeldige factuurdatum.' }, { status: 400 }); patch.invoice_date = d; patch.invoice_month = d.slice(0, 7) }
    if ('due_date' in b) { const d = datum(b.due_date); if (d === undefined) return NextResponse.json({ error: 'Ongeldige vervaldatum.' }, { status: 400 }); patch.due_date = d }
    if ('periode' in b) patch.periode = tekst(b.periode, 40)
    if ('reference' in b) patch.reference = tekst(b.reference, 120)
    if ('note' in b) patch.note = tekst(b.note, 4000)
    if ('payment_term_days' in b) { const n = num(b.payment_term_days); patch.payment_term_days = n === null ? null : Math.max(0, Math.round(n)); if (n !== null && patch.due_date === undefined && !('due_date' in b)) { const basis = (patch.invoice_date as string | undefined) ?? String(inv.invoice_date).slice(0, 10); const d = new Date(basis + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + Math.round(n)); patch.due_date = d.toISOString().slice(0, 10) } }
    // Enkel vóór versturen.
    const inhoudVelden = ['client_id', 'contract_id', 'description', 'currency', 'vat_pct', 'service_slug', 'regels', 'amount_excl']
    if (inhoudVelden.some((v) => v in b) && !inhoudOk) return NextResponse.json({ error: 'Deze factuur is al verstuurd: klant, contract, regels en bedragen kun je niet meer wijzigen. Crediteer ze en maak een nieuwe.' }, { status: 409 })
    if ('client_id' in b) { const c = b.client_id ? String(b.client_id) : null; if (c) { const { data } = await admin.from('clients').select('id').eq('id', c).maybeSingle(); if (!data) return NextResponse.json({ error: 'Klant niet gevonden.' }, { status: 400 }) } patch.client_id = c }
    if ('contract_id' in b) { const c = b.contract_id ? String(b.contract_id) : null; if (c) { const { data } = await admin.from('contracts').select('id').eq('id', c).maybeSingle(); if (!data) return NextResponse.json({ error: 'Contract niet gevonden.' }, { status: 400 }) } patch.contract_id = c }
    if ('description' in b) patch.description = tekst(b.description, 500)
    if ('service_slug' in b) patch.service_slug = tekst(b.service_slug, 80)
    if ('currency' in b) patch.currency = (tekst(b.currency, 3) ?? 'EUR').toUpperCase()
    if ('vat_pct' in b) { const n = num(b.vat_pct); if (n === null || n < 0 || n > 100) return NextResponse.json({ error: 'Ongeldig btw-tarief.' }, { status: 400 }); patch.vat_pct = n }

    const btw = typeof patch.vat_pct === 'number' ? patch.vat_pct : Number(inv.vat_pct) || DEFAULT_VAT
    let regels: FactuurRegel[] | null = null
    if ('regels' in b) {
      regels = normaliseerRegels(b.regels, btw)
      if (regels.length === 0) return NextResponse.json({ error: 'Een factuur heeft minstens één regel.' }, { status: 400 })
    } else if ('amount_excl' in b) {
      const n = num(b.amount_excl)
      if (n === null || n < 0) return NextResponse.json({ error: 'Ongeldig bedrag.' }, { status: 400 })
      regels = [regelUitBedrag(String(patch.description ?? inv.description ?? 'Factuur'), n, btw)]
    }
    if (regels) {
      const t = berekenTotalen(regels)
      patch.amount_excl = t.excl; patch.amount_incl = t.incl
      // Contractueel deel = de niet-extra regels; extra kosten wijzigen het contractbedrag niet.
      patch.contract_bedrag_excl = t.contractueel.excl
      if (!('vat_pct' in b) && t.perBtw.length === 1) patch.vat_pct = t.perBtw[0].pct
    }
    if (Object.keys(patch).length === 0 && !regels) return NextResponse.json({ ok: true })
    patch.updated_at = new Date().toISOString()

    const { error } = await admin.from('invoices').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    if (regels) {
      // Regels volledig vervangen: eenvoudig en atomisch genoeg voor één factuur.
      await admin.from('invoice_lines').delete().eq('invoice_id', id)
      const { error: le } = await admin.from('invoice_lines').insert(regels.map((r) => ({
        invoice_id: id, volgnr: r.volgnr, omschrijving: r.omschrijving, artikel: r.artikel, aantal: r.aantal, eenheid: r.eenheid,
        prijs_excl: r.prijs_excl, btw_pct: r.btw_pct, korting_pct: r.korting_pct, is_extra: r.is_extra, classificatie: r.classificatie, opmerking: r.opmerking ?? null,
      })))
      if (le) throw new Error(le.message)
    }

    const velden = ['invoice_date', 'due_date', 'periode', 'reference', 'note', 'payment_term_days', 'client_id', 'contract_id', 'description', 'currency', 'vat_pct', 'amount_excl', 'amount_incl', 'contract_bedrag_excl']
    const diff = verschillen(inv as Record<string, unknown>, { ...inv, ...patch } as Record<string, unknown>, velden)
    const rijen: { actie: string; veld: string; oud: string | null; nieuw: string | null }[] = diff.map((d) => ({ actie: d.veld === 'invoice_date' ? 'verplaatst' : 'aangepast', veld: d.veld, oud: d.oud, nieuw: d.nieuw }))
    if (regels) rijen.push({ actie: 'aangepast', veld: 'regels', oud: null, nieuw: `${regels.length} regel(s), ${berekenTotalen(regels).excl.toFixed(2)} excl. btw` })
    await historiek(admin, id, rijen, actor.email ?? null)
    if (diff.some((d) => d.veld === 'invoice_date')) {
      const meta = requestMeta(req)
      await logAudit({ action: 'invoice.verplaatst', entityType: 'invoice', entityId: id, summary: `Factuurdatum ${String(inv.invoice_date).slice(0, 10)} → ${patch.invoice_date}`, actorUserId: actor.userId, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent })
    }
    ververs({ client_id: (patch.client_id as string | null) ?? inv.client_id, contract_id: (patch.contract_id as string | null) ?? inv.contract_id })
    const d = await laad(admin, id)
    return NextResponse.json({ ok: true, ...d })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST { action } — statuswissels en betaalstatus.
 *  · 'status' { status, reden? }: te_versturen ↔ verstuurd, geannuleerd, gecrediteerd (reden verplicht bij annuleren/crediteren)
 *  · 'betaling' { betaalstatus?, betaald_bedrag?, betaald_op? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const { data: inv } = await admin.from('invoices').select('*').eq('id', id).maybeSingle()
    if (!inv) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    const van = normaliseerVerzendstatus(inv.status)
    const meta = requestMeta(req)

    if (b.action === 'status') {
      const naar = String(b.status ?? '') as Verzendstatus
      if (!['te_versturen', 'verstuurd', 'geannuleerd', 'gecrediteerd'].includes(naar)) return NextResponse.json({ error: 'Onbekende status.' }, { status: 400 })
      const recht = naar === 'geannuleerd' || naar === 'gecrediteerd' ? 'verwijderen' : 'goedkeuren'
      const actor = await magIk('invoices', recht)
      if (!actor) return NextResponse.json({ error: recht === 'goedkeuren' ? 'Je hebt geen recht om facturen te versturen.' : 'Je hebt geen recht om facturen te annuleren of te crediteren.' }, { status: 403 })
      const check = magNaar(van, naar, Number(inv.betaald_bedrag) || 0)
      if (!check.ok) return NextResponse.json({ error: check.reden }, { status: 409 })
      const reden = tekst(b.reden, 500)
      if (redenVerplicht(naar) && !reden) return NextResponse.json({ error: 'Geef een reden op; die komt in de historiek.' }, { status: 400 })
      const nu = new Date().toISOString()
      const patch: Record<string, unknown> = { status: naar, updated_at: nu }
      if (naar === 'verstuurd') { patch.sent_at = inv.sent_at ?? nu; if (!inv.due_date) { const d = new Date(String(inv.invoice_date).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + (Number(inv.payment_term_days) || 30)); patch.due_date = d.toISOString().slice(0, 10) } }
      if (naar === 'te_versturen') { patch.sent_at = null; patch.cancelled_at = null; patch.cancelled_by_email = null; patch.status_reden = null }
      if (naar === 'geannuleerd') { patch.cancelled_at = nu; patch.cancelled_by_email = actor.email ?? null; patch.status_reden = reden }
      if (naar === 'gecrediteerd') { patch.credited_at = nu; patch.status_reden = reden }
      const { error } = await admin.from('invoices').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
      await historiek(admin, id, [{ actie: naar === 'verstuurd' ? 'verstuurd' : naar === 'geannuleerd' ? 'geannuleerd' : naar === 'gecrediteerd' ? 'gecrediteerd' : 'aangepast', veld: 'status', oud: van, nieuw: naar, reden }], actor.email ?? null)
      await logAudit({ action: `invoice.${naar}`, entityType: 'invoice', entityId: id, summary: `Factuur ${van} → ${naar}${reden ? ` — ${reden}` : ''}`, actorUserId: actor.userId, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent, metadata: { reden } })
      ververs(inv)
      return NextResponse.json({ ok: true, ...(await laad(admin, id)) })
    }

    if (b.action === 'betaling') {
      const actor = await magIk('invoices', 'aanpassen')
      if (!actor) return NextResponse.json({ error: 'Je hebt geen recht om de betaalstatus aan te passen.' }, { status: 403 })
      if (van !== 'verstuurd') return NextResponse.json({ error: 'Een betaling registreer je enkel op een verstuurde factuur.' }, { status: 409 })
      const incl = Number(inv.amount_incl) || 0
      const gekozen = b.betaalstatus ? (String(b.betaalstatus) as Betaalstatus) : null
      let bedrag = num(b.betaald_bedrag)
      if (gekozen === 'betaald') bedrag = incl
      if (gekozen === 'niet_betaald') bedrag = 0
      if (bedrag === null) bedrag = Number(inv.betaald_bedrag) || 0
      if (bedrag < 0 || bedrag > incl + 0.005) return NextResponse.json({ error: 'Het betaalde bedrag ligt buiten het factuurbedrag.' }, { status: 400 })
      const betaaldOp = datum(b.betaald_op)
      const patch: Record<string, unknown> = { betaald_bedrag: Math.round(bedrag * 100) / 100, updated_at: new Date().toISOString() }
      patch.betaald_op = bedrag > 0 ? (betaaldOp ?? inv.betaald_op ?? vandaagBrussel()) : null
      const afgeleid = afgeleideBetaalstatus({ verzendstatus: 'verstuurd', betaaldBedrag: bedrag, totaalIncl: incl, vervaldatum: inv.due_date ? String(inv.due_date).slice(0, 10) : null, vandaag: vandaagBrussel() })
      patch.betaalstatus = afgeleid ?? 'niet_betaald'
      const { error } = await admin.from('invoices').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
      await historiek(admin, id, [{ actie: 'betaalstatus', veld: 'betaald_bedrag', oud: String(Number(inv.betaald_bedrag) || 0), nieuw: String(patch.betaald_bedrag), reden: tekst(b.reden, 300) }], actor.email ?? null)
      await logAudit({ action: 'invoice.betaalstatus', entityType: 'invoice', entityId: id, summary: `Betaalstatus → ${patch.betaalstatus} (€ ${Number(patch.betaald_bedrag).toFixed(2)} van € ${incl.toFixed(2)})`, actorUserId: actor.userId, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent })
      ververs(inv)
      return NextResponse.json({ ok: true, ...(await laad(admin, id)) })
    }

    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

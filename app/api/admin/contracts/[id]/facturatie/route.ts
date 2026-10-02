import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { inclFromExcl } from '@/lib/invoices'
import { normaliseerVerzendstatus, afgeleideBetaalstatus, isAfgesloten } from '@/lib/facturen/status'
import { normaliseerRegels, berekenTotalen, nieuweRegel } from '@/lib/facturen/regels'
import { maakReeks, valideerReeks, isDoorlopend, factuurdagVan, type ReeksInvoer } from '@/lib/facturatie/reeks'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Facturen van één contract. De app leidt NIETS automatisch uit het contract
 * af: de medewerker voegt facturen toe (één, meerdere of maandelijks), koppelt
 * bestaande losse facturen, of maakt ze los. Eén bron: de tabellen `invoices`
 * en `recurring_invoices` — dezelfde als Facturen en de planner.
 *
 * Rechten: contracts.bekijken → GET; contracts.aanpassen → POST.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
const UUID = /^[0-9a-f-]{36}$/i
const dag = (v: unknown) => (v ? String(v).slice(0, 10) : null)
const vandaagISO = () => new Date().toISOString().slice(0, 10)

export type ContractFactuurRij = {
  id: string; bron: 'invoice' | 'recurring'; invoice_date: string | null; description: string | null
  amount_excl: number; amount_incl: number; vat_pct: number; status: string; betaalstatus: string | null
  sent_at: string | null; payment_term_days: number | null; verantwoordelijke: string | null; aantal_regels: number
  recurring: { start_month: string; end_month: string | null; invoice_day: string; actief: boolean } | null
}

async function laad(admin: Admin, contractId: string) {
  const { data: c } = await admin.from('contracts').select('id, title, client_id, status').eq('id', contractId).maybeSingle()
  if (!c) throw new Error('Contract niet gevonden')
  const [{ data: facturen }, { data: recurring }, { data: klant }, { data: lijnen }] = await Promise.all([
    admin.from('invoices').select('*').eq('contract_id', contractId).order('invoice_date'),
    admin.from('recurring_invoices').select('*').eq('contract_id', contractId).order('start_month'),
    c.client_id ? admin.from('clients').select('id, company_name').eq('id', c.client_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('invoice_lines').select('invoice_id').in('invoice_id', ((await admin.from('invoices').select('id').eq('contract_id', contractId)).data ?? []).map((x: { id: string }) => x.id)),
  ])
  const regelsPer = new Map<string, number>()
  for (const l of (lijnen ?? []) as { invoice_id: string }[]) regelsPer.set(l.invoice_id, (regelsPer.get(l.invoice_id) ?? 0) + 1)
  const vandaag = vandaagISO()
  const rijen: ContractFactuurRij[] = ((facturen ?? []) as Record<string, unknown>[]).map((i) => {
    const st = normaliseerVerzendstatus(i.status as string)
    return {
      id: String(i.id), bron: 'invoice', invoice_date: dag(i.invoice_date), description: (i.description as string | null) ?? null,
      amount_excl: Number(i.amount_excl) || 0, amount_incl: Number(i.amount_incl) || 0, vat_pct: Number(i.vat_pct) || 0, status: st,
      betaalstatus: afgeleideBetaalstatus({ verzendstatus: st, betaaldBedrag: Number(i.betaald_bedrag) || 0, totaalIncl: Number(i.amount_incl) || 0, vervaldatum: dag(i.due_date), vandaag }),
      sent_at: dag(i.sent_at), payment_term_days: i.payment_term_days === null || i.payment_term_days === undefined ? null : Number(i.payment_term_days),
      verantwoordelijke: (i.verantwoordelijke as string | null) ?? null, aantal_regels: regelsPer.get(String(i.id)) ?? 0, recurring: null,
    }
  })
  for (const r of (recurring ?? []) as Record<string, unknown>[]) {
    rijen.push({
      id: String(r.id), bron: 'recurring', invoice_date: `${String(r.start_month).slice(0, 7)}-01`, description: (r.description as string | null) ?? null,
      amount_excl: Number(r.amount_excl) || 0, amount_incl: Number(r.amount_incl) || inclFromExcl(Number(r.amount_excl) || 0, Number(r.vat_pct) || 0), vat_pct: Number(r.vat_pct) || 0,
      status: r.deleted_at ? 'geannuleerd' : 'te_versturen', betaalstatus: null, sent_at: null, payment_term_days: r.payment_term_days === null || r.payment_term_days === undefined ? null : Number(r.payment_term_days),
      verantwoordelijke: (r.verantwoordelijke as string | null) ?? null, aantal_regels: 0,
      recurring: { start_month: String(r.start_month).slice(0, 7), end_month: r.end_month ? String(r.end_month).slice(0, 7) : null, invoice_day: String(r.invoice_day ?? 'last'), actief: !r.deleted_at && r.active !== false },
    })
  }
  const actief = rijen.filter((r) => r.bron === 'invoice' && !isAfgesloten(r.status as 'te_versturen'))
  const totalen = {
    aantal: actief.length,
    gepland: Math.round(actief.reduce((t, r) => t + r.amount_excl, 0) * 100) / 100,
    verstuurd: Math.round(actief.filter((r) => r.status === 'verstuurd').reduce((t, r) => t + r.amount_excl, 0) * 100) / 100,
    teFactureren: Math.round(actief.filter((r) => r.status === 'te_versturen').reduce((t, r) => t + r.amount_excl, 0) * 100) / 100,
    terugkerend: rijen.filter((r) => r.bron === 'recurring' && r.recurring?.actief).length,
  }
  // Losse facturen van dezelfde klant die achteraf aan dit contract gekoppeld kunnen worden.
  let kandidaten: { id: string; invoice_date: string | null; description: string | null; amount_excl: number; status: string }[] = []
  if (c.client_id) {
    const { data: los } = await admin.from('invoices').select('id, invoice_date, description, amount_excl, status').eq('client_id', c.client_id).is('contract_id', null).neq('kind', 'wam').order('invoice_date', { ascending: false }).limit(40)
    kandidaten = ((los ?? []) as Record<string, unknown>[]).map((i) => ({ id: String(i.id), invoice_date: dag(i.invoice_date), description: (i.description as string | null) ?? null, amount_excl: Number(i.amount_excl) || 0, status: normaliseerVerzendstatus(i.status as string) }))
  }
  return { contract: { id: c.id, title: c.title, client_id: c.client_id, status: c.status, klant_naam: klant?.company_name ?? null }, facturen: rijen, totalen, kandidaten }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('contracts', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    return NextResponse.json(await laad(createAdminSupabaseClient(), id))
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const actor = await magIk('contracts', 'aanpassen')
    if (!actor) return NextResponse.json({ error: 'Je hebt geen recht om facturen aan een contract toe te voegen.' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const b = await req.json().catch(() => ({})) as Record<string, unknown> & { action?: string }
    const meta = requestMeta(req)
    const audit = (summary: string, extra: Record<string, unknown> = {}) => logAudit({
      action: `contract.facturatie.${b.action}`, entityType: 'contract', entityId: id, summary,
      actorUserId: actor.userId, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent, metadata: extra,
    })
    const klaar = async (extra: Record<string, unknown> = {}) => {
      try { revalidatePath(`/admin/contracts/${id}`); revalidatePath('/admin/invoices'); revalidatePath('/admin/invoices/planner') } catch { }
      return NextResponse.json({ ok: true, ...extra, ...(await laad(admin, id)) })
    }
    const { data: c } = await admin.from('contracts').select('id, title, client_id, service_slug').eq('id', id).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })

    switch (b.action) {
      case 'reeks': {
        // Handmatig ingevulde reeks: één, meerdere, of maandelijks (met of zonder einde).
        if (!c.client_id) return NextResponse.json({ error: 'Koppel eerst een klant aan het contract.' }, { status: 400 })
        const inv: ReeksInvoer = {
          type: (['eenmalig', 'meerdere', 'maandelijks'].includes(String(b.type)) ? b.type : 'eenmalig') as ReeksInvoer['type'],
          aantal: b.aantal === null || b.aantal === '' || b.aantal === undefined ? (b.type === 'eenmalig' ? 1 : null) : Number(b.aantal),
          bedrag_excl: Number(b.bedrag_excl) || 0, btw_pct: b.btw_pct === undefined ? 21 : Number(b.btw_pct),
          start_datum: String(b.start_datum ?? ''), interval_maanden: Number(b.interval_maanden) || 1,
          omschrijving: String(b.omschrijving ?? c.title ?? 'Factuur'), betalingstermijn_dagen: b.betalingstermijn_dagen === undefined || b.betalingstermijn_dagen === '' ? 30 : Number(b.betalingstermijn_dagen),
        }
        const fouten = valideerReeks(inv)
        if (fouten.length) return NextResponse.json({ error: `Controleer de invoer: ${fouten.join(', ')}.` }, { status: 400 })
        const verantwoordelijke = b.verantwoordelijke ? String(b.verantwoordelijke).slice(0, 120) : null
        const notitie = b.notitie ? String(b.notitie).slice(0, 2000) : null
        const regelsInvoer = normaliseerRegels(b.regels, inv.btw_pct)

        if (isDoorlopend(inv)) {
          const start = inv.start_datum.slice(0, 7)
          const { data: bestaand } = await admin.from('recurring_invoices').select('id').eq('contract_id', id).eq('start_month', start).eq('amount_excl', inv.bedrag_excl).is('deleted_at', null).maybeSingle()
          if (bestaand) return NextResponse.json({ error: 'Er bestaat al een maandelijkse facturatie met deze start en dit bedrag voor dit contract.' }, { status: 409 })
          const rij: Record<string, unknown> = {
            client_id: c.client_id, service_slug: c.service_slug ?? null, contract_id: id, start_month: start, end_month: null,
            description: inv.omschrijving.trim(), amount_excl: inv.bedrag_excl, vat_pct: inv.btw_pct, amount_incl: inclFromExcl(inv.bedrag_excl, inv.btw_pct),
            active: true, invoice_day: factuurdagVan(inv.start_datum), created_by: actor.userId, verantwoordelijke, payment_term_days: inv.betalingstermijn_dagen,
          }
          const ingevoegd = await insertVeerkrachtig(admin, 'recurring_invoices', rij)
          await audit(`Maandelijkse facturatie toegevoegd vanaf ${start}: € ${inv.bedrag_excl} excl.`, { recurring_id: ingevoegd })
          return klaar({ aangemaakt: 0, recurring_id: ingevoegd })
        }

        const momenten = maakReeks(inv)
        const { data: bestaande } = await admin.from('invoices').select('invoice_date, amount_excl, description').eq('contract_id', id)
        const sleutel = (d: string, a: number, o: string | null) => `${d}|${Number(a).toFixed(2)}|${(o ?? '').trim().toLowerCase()}`
        const alBezet = new Set(((bestaande ?? []) as { invoice_date: string; amount_excl: number; description: string | null }[]).map((x) => sleutel(String(x.invoice_date).slice(0, 10), x.amount_excl, x.description)))
        const ids: string[] = []; let overgeslagen = 0
        for (const m of momenten) {
          if (alBezet.has(sleutel(m.factuurdatum, m.bedrag_excl, m.omschrijving))) { overgeslagen++; continue }   // dubbel klikken → geen dubbele facturen
          const regels = regelsInvoer.length ? regelsInvoer.map((r) => ({ ...r })) : [nieuweRegel({ artikel: inv.omschrijving.trim().slice(0, 120), omschrijving: m.omschrijving, aantal: 1, eenheid: 'forfait', prijs_excl: m.bedrag_excl }, inv.btw_pct)]
          const t = berekenTotalen(regels)
          const vervaldatum = new Date(m.factuurdatum + 'T12:00:00Z'); vervaldatum.setUTCDate(vervaldatum.getUTCDate() + inv.betalingstermijn_dagen)
          const rij: Record<string, unknown> = {
            client_id: c.client_id, contract_id: id, service_slug: c.service_slug ?? null, invoice_date: m.factuurdatum, invoice_month: m.periode, periode: m.periode,
            description: m.omschrijving, amount_excl: t.excl, vat_pct: inv.btw_pct, amount_incl: t.incl, contract_bedrag_excl: t.contractueel.excl,
            status: 'te_versturen', source: 'contract', currency: 'EUR', payment_term_days: inv.betalingstermijn_dagen, due_date: vervaldatum.toISOString().slice(0, 10),
            verantwoordelijke, note: notitie, created_by: actor.userId,
          }
          const invoiceId = await insertVeerkrachtig(admin, 'invoices', rij)
          ids.push(invoiceId)
          try { await admin.from('invoice_lines').insert(regels.map((r, i) => ({ invoice_id: invoiceId, volgnr: i + 1, artikel: r.artikel, omschrijving: r.omschrijving, aantal: r.aantal, eenheid: r.eenheid, prijs_excl: r.prijs_excl, btw_pct: r.btw_pct, korting_pct: r.korting_pct, is_extra: r.is_extra, classificatie: r.classificatie }))) } catch { /* regels zijn een verrijking */ }
          try { await admin.from('invoice_wijzigingen').insert({ invoice_id: invoiceId, actie: 'aangemaakt', veld: 'contract', oud: null, nieuw: `Handmatig toegevoegd op contract ${c.title ?? id} (${m.volgnr}/${m.aantal})`, actor_email: actor.email ?? null }) } catch { /* */ }
        }
        await audit(`${ids.length} factuur/facturen toegevoegd aan het contract${overgeslagen ? ` (${overgeslagen} bestond al)` : ''}`, { invoice_ids: ids, type: inv.type })
        return klaar({ aangemaakt: ids.length, overgeslagen, invoice_ids: ids })
      }
      case 'koppel': {
        const invoiceId = String(b.invoice_id ?? '')
        if (!UUID.test(invoiceId)) return NextResponse.json({ error: 'invoice_id vereist' }, { status: 400 })
        const { data: inv } = await admin.from('invoices').select('id, client_id, contract_id').eq('id', invoiceId).maybeSingle()
        if (!inv) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
        if (inv.client_id && c.client_id && inv.client_id !== c.client_id) return NextResponse.json({ error: 'Deze factuur hoort bij een andere klant.' }, { status: 400 })
        const { error } = await admin.from('invoices').update({ contract_id: id, client_id: inv.client_id ?? c.client_id, updated_at: new Date().toISOString() }).eq('id', invoiceId)
        if (error) throw new Error(error.message)
        try { await admin.from('invoice_wijzigingen').insert({ invoice_id: invoiceId, actie: 'aangepast', veld: 'contract', oud: inv.contract_id ?? null, nieuw: id, actor_email: actor.email ?? null }) } catch { /* */ }
        await audit('Bestaande factuur aan het contract gekoppeld', { invoice_id: invoiceId })
        return klaar()
      }
      case 'ontkoppel': {
        const invoiceId = String(b.invoice_id ?? '')
        if (!UUID.test(invoiceId)) return NextResponse.json({ error: 'invoice_id vereist' }, { status: 400 })
        const { error } = await admin.from('invoices').update({ contract_id: null, updated_at: new Date().toISOString() }).eq('id', invoiceId).eq('contract_id', id)
        if (error) throw new Error(error.message)
        try { await admin.from('invoice_wijzigingen').insert({ invoice_id: invoiceId, actie: 'aangepast', veld: 'contract', oud: id, nieuw: null, actor_email: actor.email ?? null }) } catch { /* */ }
        await audit('Factuur losgemaakt van het contract', { invoice_id: invoiceId })
        return klaar()
      }
      default:
        return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** Insert die ontbrekende kolommen laat vallen (app werkt ook vóór de migratie). */
async function insertVeerkrachtig(admin: Admin, tabel: string, rij: Record<string, unknown>): Promise<string> {
  const p = { ...rij }
  for (let i = 0; i < 6; i++) {
    const { data, error } = await admin.from(tabel).insert(p).select('id').single()
    if (!error) return String(data.id)
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in p) { delete p[col]; continue }
    throw new Error(error.message)
  }
  throw new Error('Opslaan mislukt')
}

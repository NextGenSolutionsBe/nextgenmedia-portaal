import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { bouwFeiten, verwachteMrr, type RuweFactuur, type RuweMaand, type RuweReeks, type RuweRegel } from '@/lib/omzet/analyse'
import { isDienst } from '@/lib/omzet/diensten'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Omzetrapportage — leest live uit de facturenmodule (geen kopie, geen sync):
 *  GET  → alle omzetfeiten op regelniveau + klantnamen + verwachte MRR.
 *         Filteren en optellen gebeurt in de browser met dezelfde pure module,
 *         zodat elke filterwijziging meteen alles herberekent.
 *  POST {actie:'dienst', sleutel, dienst} → een factuurregel (of factuur zonder
 *         regels) aan een dienst koppelen; de rapportage rekent meteen opnieuw.
 * Rechten: finance.bekijken voor lezen; invoices.aanpassen voor categoriseren.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
const stukken = <T,>(a: T[], n = 200) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
async function alles<T>(q: () => { range: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> }): Promise<T[]> {
  const uit: T[] = []
  for (let van = 0; ; van += 1000) {
    const { data, error } = await q().range(van, van + 999)
    if (error) throw new Error(error.message)
    uit.push(...(data ?? []))
    if (!data || data.length < 1000) return uit
  }
}

export async function GET() {
  try {
    if (!(await magIk('finance', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang tot de omzetrapportage.' }, { status: 403 })
    const admin = createAdminSupabaseClient() as unknown as Admin
    const [facturen, reeksen, maanden, klanten] = await Promise.all([
      alles<RuweFactuur>(() => admin.from('invoices').select('id, client_id, invoice_date, description, status, amount_excl, amount_incl, service_slug, kind, source, factuur_type, terugkerende_omzet, betaalstatus, betaald_bedrag, betaald_op, credited_at, extern_factuurnummer, reference').order('invoice_date')),
      alles<RuweReeks>(() => admin.from('recurring_invoices').select('id, client_id, description, amount_excl, service_slug, start_month, end_month, active, deleted_at')),
      alles<RuweMaand>(() => admin.from('recurring_invoice_months').select('recurring_id, month, status, amount_excl, billing_date, invoice_id, betaald_op, verwijderd_op, extern_factuurnummer')),
      alles<{ id: string; company_name: string }>(() => admin.from('clients').select('id, company_name')),
    ])
    const regels: RuweRegel[] = []
    const velden = 'id, invoice_id, recurring_id, aantal, prijs_excl, btw_pct, korting_pct, korting_eur, is_extra, service_slug, artikel, omschrijving'
    for (const s of stukken(facturen.map((f) => f.id))) { const { data, error } = await admin.from('invoice_lines').select(velden).in('invoice_id', s); if (error) throw new Error(error.message); regels.push(...(data ?? [])) }
    for (const s of stukken(reeksen.map((r) => r.id))) { const { data, error } = await admin.from('invoice_lines').select(velden).in('recurring_id', s); if (error) throw new Error(error.message); regels.push(...(data ?? [])) }
    const feiten = bouwFeiten(facturen, regels, reeksen, maanden)
    const nuMaand = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
    // Nog niet uitgereikt (Te factureren): enkel ter info, telt nooit als omzet.
    const gepland = facturen.filter((f) => String(f.status) === 'te_versturen' && !String(f.kind ?? '').startsWith('setter') && f.kind !== 'wam').length
    return NextResponse.json({
      feiten, klanten: Object.fromEntries(klanten.map((k) => [k.id, k.company_name])),
      verwachteMrr: verwachteMrr(reeksen, nuMaand), nuMaand, gepland,
      vandaag: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await magIk('invoices', 'aanpassen')
    if (!actor) return NextResponse.json({ error: 'Je mag factuurregels niet aanpassen.' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as { actie?: string; sleutel?: string; dienst?: string | null }
    if (b.actie !== 'dienst') return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
    const dienst = b.dienst === null || b.dienst === '' ? null : isDienst(b.dienst) ? b.dienst : undefined
    if (dienst === undefined) return NextResponse.json({ error: 'Kies een geldige dienst.' }, { status: 400 })
    const admin = createAdminSupabaseClient() as unknown as Admin
    const s = String(b.sleutel ?? '')
    const zonderRegels = s.match(/^inv:([0-9a-f-]{36}):0$/i)
    const regel = s.match(/^(?:inv|rec:[0-9a-f-]{36}:\d{4}-\d{2}):([0-9a-f-]{36})$/i)
    const reeks = s.match(/^rec:([0-9a-f-]{36}):\d{4}-\d{2}:0$/i)
    let factuurId: string | null = null
    if (zonderRegels) {
      factuurId = zonderRegels[1]
      const { error } = await admin.from('invoices').update({ service_slug: dienst, updated_at: new Date().toISOString() }).eq('id', factuurId)
      if (error) throw new Error(error.message)
    } else if (reeks) {
      const { error } = await admin.from('recurring_invoices').update({ service_slug: dienst, updated_at: new Date().toISOString() }).eq('id', reeks[1])
      if (error) throw new Error(error.message)
    } else if (regel) {
      const { data: l } = await admin.from('invoice_lines').select('id, invoice_id, is_extra').eq('id', regel[1]).maybeSingle()
      if (!l) return NextResponse.json({ error: 'Factuurregel niet gevonden.' }, { status: 404 })
      if (l.is_extra) return NextResponse.json({ error: 'Dit is een doorgerekende kost (bv. kilometers); die telt bewust apart.' }, { status: 400 })
      const { error } = await admin.from('invoice_lines').update({ service_slug: dienst, updated_at: new Date().toISOString() }).eq('id', l.id)
      if (error) throw new Error(error.message)
      factuurId = l.invoice_id
    } else return NextResponse.json({ error: 'Onbekende regel.' }, { status: 400 })
    if (factuurId) { try { await admin.from('invoice_wijzigingen').insert({ invoice_id: factuurId, actie: 'aangepast', veld: 'dienst', oud: null, nieuw: dienst ?? '(geen)', reden: 'Omzetrapportage: dienst gekoppeld', actor_email: actor.email ?? null }) } catch { /* historiek mag nooit breken */ } }
    try { revalidatePath('/admin/revenue/rapportage') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { DEFAULT_VAT, billingDateFor, normalizeInvoiceStatus } from '@/lib/invoices'
import { SERVICE_LABELS } from '@/lib/utils'
import { normaliseerRegels, regelUitBedrag, type FactuurRegel } from '@/lib/facturen/regels'
import { bepaalStatus, ontleedSleutel, vandaagBrussel } from '@/lib/facturatie/planner-model'
import { aandachtspunten, ontbrekendeGegevens, type ItemDetail, type KlantInfo } from '@/lib/facturatie/item-model'

export const dynamic = 'force-dynamic'

/**
 * GET ?id=<inv:… | rec:…:YYYY-MM> — alles van één facturatie-item: klant met
 * facturatiegegevens, artikelen, mededeling, interne notitie, bijlagen en wat
 * er nog ontbreekt. Eén bron voor het detailvenster én de facturatieronde.
 */

const KLANT = 'id, company_name, contact_name, email, facturatie_email, telefoon, btw_nummer, adres_straat, adres_postcode, adres_gemeente, adres_land'
type KlantRij = { id: string; company_name: string; contact_name: string | null; email: string | null; facturatie_email: string | null; telefoon: string | null; btw_nummer: string | null; adres_straat: string | null; adres_postcode: string | null; adres_gemeente: string | null; adres_land: string | null }
const naarKlant = (r: KlantRij | null): KlantInfo | null => (r ? {
  id: r.id, naam: r.company_name, contact: r.contact_name, email: r.email, facturatie_email: r.facturatie_email, telefoon: r.telefoon,
  btw: r.btw_nummer, straat: r.adres_straat, postcode: r.adres_postcode, gemeente: r.adres_gemeente, land: r.adres_land,
} : null)
const dag = (v: unknown) => (v ? String(v).slice(0, 10) : null)
const svc = (s: string | null | undefined) => (s ? (SERVICE_LABELS[s] ?? s) : null)
const lijnNaarRegel = (l: Record<string, unknown>) => ({ ...l, artikel: l.artikel ?? l.omschrijving })

export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const sleutel = ontleedSleutel(req.nextUrl.searchParams.get('id') ?? '')
    if (!sleutel || (sleutel.bron !== 'invoice' && sleutel.bron !== 'recurring')) return NextResponse.json({ error: 'Onbekend item' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const vandaag = vandaagBrussel()

    if (sleutel.bron === 'invoice') {
      const [{ data: inv }, { data: lijnen }, { data: bijlagen }, { data: maand }] = await Promise.all([
        admin.from('invoices').select('*').eq('id', sleutel.bronId).maybeSingle(),
        admin.from('invoice_lines').select('*').eq('invoice_id', sleutel.bronId).order('volgnr'),
        admin.from('invoice_bijlagen').select('id, naam, grootte, mime, created_by, created_at').eq('invoice_id', sleutel.bronId).order('created_at'),
        admin.from('recurring_invoice_months').select('recurring_id, month').eq('invoice_id', sleutel.bronId).maybeSingle(),
      ])
      if (!inv) return NextResponse.json({ error: 'Item niet gevonden' }, { status: 404 })
      const [{ data: klant }, { data: contract }] = await Promise.all([
        inv.client_id ? admin.from('clients').select(KLANT).eq('id', inv.client_id).maybeSingle() : Promise.resolve({ data: null }),
        inv.contract_id ? admin.from('contracts').select('title').eq('id', inv.contract_id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      const btw = Number(inv.vat_pct) || DEFAULT_VAT
      let regels: FactuurRegel[] = normaliseerRegels((lijnen ?? []).map(lijnNaarRegel), btw)
      if (regels.length === 0 && Number(inv.amount_excl) > 0) regels = [regelUitBedrag(String(inv.description ?? 'Factuur'), Number(inv.amount_excl) || 0, btw)]
      const detail: ItemDetail = {
        klant: naarKlant(klant as KlantRij | null),
        project: (contract as { title?: string } | null)?.title ?? svc(inv.service_slug),
        titel: inv.description ?? null, type: inv.factuur_type ?? null, datum: String(inv.invoice_date).slice(0, 10),
        prestatie_van: dag(inv.prestatie_van), prestatie_tot: dag(inv.prestatie_tot), periode: inv.periode ?? null,
        betaaltermijn: Number.isFinite(Number(inv.payment_term_days)) && inv.payment_term_days !== null ? Number(inv.payment_term_days) : 30,
        klant_referentie: inv.klant_referentie ?? null, regels, mededeling: inv.mededeling ?? null, notitie: inv.note ?? null,
        extern_factuurnummer: inv.extern_factuurnummer ?? null,
      }
      let ruwe: string = normalizeInvoiceStatus(inv.status)
      const incl = Number(inv.amount_incl) || 0
      const betaald = ruwe === 'verstuurd' && (inv.betaalstatus === 'betaald' || (incl > 0 && (Number(inv.betaald_bedrag) || 0) >= incl - 0.005))
      if (betaald) ruwe = 'betaald'
      const ontbrekend = ontbrekendeGegevens(detail)
      return NextResponse.json({
        id: `inv:${inv.id}`, bron: 'invoice', invoice_id: inv.id, recurring_id: maand?.recurring_id ?? null, maand: maand?.month ?? null,
        status: bepaalStatus({ ruweStatus: ruwe, datum: detail.datum, ontbrekend: inv.client_id ? [] : ['klant'], vandaag }),
        detail, ontbrekend, aandacht: aandachtspunten(detail), bijlagen: bijlagen ?? [],
        contract_id: inv.contract_id ?? null, client_id: inv.client_id ?? null,
        verzonden_op: dag(inv.sent_at), verzonden_door: inv.sent_by_email ?? null, betaald_op: betaald ? dag(inv.betaald_op) : null,
        betaald_bedrag: Number(inv.betaald_bedrag) || 0, bedrag_incl: incl,
      })
    }

    // Een maand van een terugkerende facturatie (zonder eigen item).
    const maand = sleutel.maand!
    const [{ data: rec }, { data: rij }, { data: lijnen }] = await Promise.all([
      admin.from('recurring_invoices').select('*').eq('id', sleutel.bronId).maybeSingle(),
      admin.from('recurring_invoice_months').select('*').eq('recurring_id', sleutel.bronId).eq('month', maand).maybeSingle(),
      admin.from('invoice_lines').select('*').eq('recurring_id', sleutel.bronId).is('invoice_id', null).order('volgnr'),
    ])
    if (!rec) return NextResponse.json({ error: 'Terugkerende facturatie niet gevonden' }, { status: 404 })
    if (rij?.invoice_id) return NextResponse.json({ doorverwijzen: `inv:${rij.invoice_id}` })
    const [{ data: klant }, { data: contract }] = await Promise.all([
      rec.client_id ? admin.from('clients').select(KLANT).eq('id', rec.client_id).maybeSingle() : Promise.resolve({ data: null }),
      rec.contract_id ? admin.from('contracts').select('title').eq('id', rec.contract_id).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const btw = rij?.vat_pct != null ? Number(rij.vat_pct) : Number(rec.vat_pct) || DEFAULT_VAT
    // Een eigen bedrag voor deze maand gaat voor de reeksregels.
    let regels: FactuurRegel[] = rij?.amount_excl != null
      ? [regelUitBedrag(String(rec.description ?? 'Maandfactuur'), Number(rij.amount_excl) || 0, btw)]
      : normaliseerRegels((lijnen ?? []).map(lijnNaarRegel), btw)
    if (regels.length === 0 && Number(rec.amount_excl) > 0) regels = [regelUitBedrag(String(rec.description ?? 'Maandfactuur'), Number(rec.amount_excl) || 0, btw)]
    const datum = String(rij?.billing_date ?? billingDateFor(maand, rec.invoice_day)).slice(0, 10)
    const detail: ItemDetail = {
      klant: naarKlant(klant as KlantRij | null),
      project: (contract as { title?: string } | null)?.title ?? svc(rec.service_slug), titel: rec.description ?? null, type: 'terugkerend', datum,
      prestatie_van: null, prestatie_tot: null, periode: maand,
      betaaltermijn: Number.isFinite(Number(rec.payment_term_days)) && rec.payment_term_days !== null ? Number(rec.payment_term_days) : 30,
      klant_referentie: null, regels, mededeling: rec.mededeling ?? null, notitie: rij?.note ?? null, extern_factuurnummer: rij?.extern_factuurnummer ?? null,
    }
    let ruwe: string = rij?.status ? normalizeInvoiceStatus(rij.status) : 'te_versturen'
    if (ruwe === 'verstuurd' && (rij?.betaald_op || rij?.status === 'betaald')) ruwe = 'betaald'
    return NextResponse.json({
      id: `rec:${rec.id}:${maand}`, bron: 'recurring', invoice_id: null, recurring_id: rec.id, maand,
      status: bepaalStatus({ ruweStatus: ruwe, datum, ontbrekend: rec.client_id ? [] : ['klant'], vandaag }),
      detail, ontbrekend: ontbrekendeGegevens(detail), aandacht: aandachtspunten(detail), bijlagen: [],
      contract_id: rec.contract_id ?? null, client_id: rec.client_id ?? null,
      verzonden_op: dag(rij?.sent_at), verzonden_door: rij?.sent_by_email ?? null, betaald_op: ruwe === 'betaald' ? dag(rij?.betaald_op) : null,
      betaald_bedrag: 0, bedrag_incl: 0,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

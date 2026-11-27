import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { berekenRegel } from '@/lib/facturen/regels'
import { laadCatalogus } from '@/lib/bedrijven/server'
import { dienstLabel } from '@/lib/omzet/diensten'
import { naarCsv, type ExportRegel } from '@/lib/financieel/fase7'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UITGEREIKT = ['verstuurd', 'gefactureerd', 'betaald']
const isDatum = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
const stukken = <T,>(a: T[], n = 200) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

/**
 * Export naar het facturatieprogramma (verbeterplan fase 7, punt 85):
 * GET ?van=&tot= → CSV met één regel per factuurregel: factuurnummer, datum,
 * klant, btw-nummer, handelsnaam, bedrijf, dienst, omschrijving, aantal,
 * prijs, btw en totalen. Uitgereikte facturen op factuurdatum. Enkel lezen.
 */
export async function GET(req: NextRequest) {
  try {
    const p = await magIk('invoices', 'bekijken')
    if (!p) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const van = req.nextUrl.searchParams.get('van'), tot = req.nextUrl.searchParams.get('tot')
    if (!isDatum(van) || !isDatum(tot) || van! > tot!) return NextResponse.json({ error: 'Kies een periode (van en tot).' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: inv, error } = await admin.from('invoices')
      .select('id, client_id, invoice_date, description, status, kind, amount_excl, vat_pct, service_slug, extern_factuurnummer, reference, klant_referentie, bedrijf, dienst')
      .in('status', UITGEREIKT).gte('invoice_date', van).lte('invoice_date', tot).order('invoice_date').limit(5000)
    if (error) throw new Error(error.message)
    type F = { id: string; client_id: string | null; invoice_date: string; description: string | null; kind: string | null; amount_excl: number | null; vat_pct: number | null; service_slug: string | null; extern_factuurnummer: string | null; reference: string | null; klant_referentie: string | null; bedrijf: string | null; dienst: string | null }
    const facturen = ((inv ?? []) as F[]).filter((f) => { const k = String(f.kind ?? 'client'); return k !== 'wam' && !k.startsWith('setter') })
    type L = { invoice_id: string; aantal: number | null; prijs_excl: number | null; btw_pct: number | null; korting_pct: number | null; korting_eur: number | null; artikel: string | null; omschrijving: string | null; service_slug: string | null; dienst: string | null; bedrijf: string | null; volgorde?: number | null }
    const regels: L[] = []
    for (const s of stukken(facturen.map((f) => f.id))) {
      const { data } = await admin.from('invoice_lines').select('invoice_id, aantal, prijs_excl, btw_pct, korting_pct, korting_eur, artikel, omschrijving, service_slug, dienst, bedrijf').in('invoice_id', s)
      regels.push(...((data ?? []) as L[]))
    }
    const klantIds = [...new Set(facturen.map((f) => f.client_id).filter((x): x is string => !!x))]
    const klanten = new Map<string, { naam: string; btw: string }>()
    for (const s of stukken(klantIds)) {
      const { data } = await admin.from('clients').select('id, company_name, btw_nummer').in('id', s)
      for (const k of (data ?? []) as { id: string; company_name: string; btw_nummer: string | null }[]) klanten.set(k.id, { naam: k.company_name, btw: k.btw_nummer ?? '' })
    }
    const cat = await laadCatalogus(admin)
    const bedrijf = (slug: string | null) => cat.bedrijven.find((b) => b.slug === slug)
    const dienstNaam = (slug: string | null) => (slug ? cat.diensten.find((d) => d.slug === slug)?.naam ?? dienstLabel(slug) : '')
    const perFactuur = new Map<string, L[]>()
    for (const r of regels) { const l = perFactuur.get(r.invoice_id) ?? []; l.push(r); perFactuur.set(r.invoice_id, l) }

    const uit: ExportRegel[] = []
    for (const f of facturen) {
      const k = f.client_id ? klanten.get(f.client_id) : undefined
      const basis = { factuurnummer: f.extern_factuurnummer || f.reference || '', datum: f.invoice_date, klant: k?.naam ?? '', btw_nummer: k?.btw ?? '', referentie: f.klant_referentie ?? '' }
      const eigen = perFactuur.get(f.id) ?? []
      if (!eigen.length) {
        const excl = Number(f.amount_excl) || 0, pct = Number(f.vat_pct ?? 21)
        const b = bedrijf(f.bedrijf)
        uit.push({ ...basis, handelsnaam: b?.handelsnaam ?? b?.naam ?? '', bedrijf: b?.naam ?? '', dienst: dienstNaam(f.dienst ?? f.service_slug), omschrijving: f.description ?? '', aantal: 1, eenheidsprijs: excl, btw_pct: pct, excl, btw: Math.round(excl * pct) / 100, incl: Math.round(excl * (100 + pct)) / 100 })
        continue
      }
      for (const r of eigen) {
        const be = berekenRegel({ aantal: Number(r.aantal) || 0, prijs_excl: Number(r.prijs_excl) || 0, btw_pct: Number(r.btw_pct) || 0, korting_pct: Number(r.korting_pct) || 0, korting_eur: Number(r.korting_eur) || 0 })
        const b = bedrijf(r.bedrijf ?? f.bedrijf)
        uit.push({
          ...basis, handelsnaam: b?.handelsnaam ?? b?.naam ?? '', bedrijf: b?.naam ?? '', dienst: dienstNaam(r.dienst ?? r.service_slug ?? f.dienst ?? f.service_slug),
          omschrijving: [r.artikel, r.omschrijving].filter(Boolean).join(' · ') || f.description || '', aantal: Number(r.aantal) || 0, eenheidsprijs: Number(r.prijs_excl) || 0,
          btw_pct: Number(r.btw_pct) || 0, excl: be.excl, btw: be.btw, incl: be.incl,
        })
      }
    }
    await logAudit({ action: 'facturen.export', entityType: 'invoice', summary: `Export facturatieprogramma ${van} tot ${tot} (${uit.length} regels)`, actorUserId: p.userId, actorEmail: p.email, ...requestMeta(req) })
    return new NextResponse('﻿' + naarCsv(uit), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="facturen-${van}-tot-${tot}.csv"`, 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}

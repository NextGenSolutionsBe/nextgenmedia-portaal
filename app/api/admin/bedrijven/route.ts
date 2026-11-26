import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesPersoon, magIk } from '@/lib/instellingen/laden'
import { eisBeheer } from '@/lib/instellingen/api'
import { requestMeta } from '@/lib/audit'
import { laadCatalogus, bewaarDienst, klassificatieLijst, klassificeer, bevestigVoorstellen, zetBedrijfOfDienst, type Actor } from '@/lib/bedrijven/server'
import { isKlassificatieTabel, isBedrijfFilter, BEDRIJF_COOKIE, type KlassificatieVeld, type DienstInvoer } from '@/lib/bedrijven/model'

export const dynamic = 'force-dynamic'

/** Welke module beslist of iemand het bedrijf of de dienst van dit soort record mag aanpassen. */
const MODULE_VAN: Record<string, string> = {
  opdrachten: 'opdrachten', contracts: 'contracts', invoices: 'invoices', recurring_invoices: 'invoices',
  klant_meetings: 'meetings', purchases: 'purchases', cost_entries: 'finance', klant_aanvragen: 'aanvragen', opleveringen: 'opleveringen',
}

const isVeld = (v: unknown): v is KlassificatieVeld => v === 'bedrijf' || v === 'dienst'

/**
 * Bedrijven en dienstencatalogus (verbeterplan fase 1).
 * GET: de catalogus (iedereen van het team); ?wachtrij=1: de open vragen "Te classificeren" (zaakvoerders).
 */
export async function GET(req: NextRequest) {
  try {
    const persoon = await leesPersoon()
    if (!persoon) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const catalogus = await laadCatalogus(admin)
    if (req.nextUrl.searchParams.get('wachtrij') === '1') {
      if (!persoon.isAdmin) return NextResponse.json({ error: 'Enkel voor de zaakvoerders' }, { status: 403 })
      return NextResponse.json({ catalogus, wachtrij: await klassificatieLijst(admin) })
    }
    return NextResponse.json({ catalogus })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!b) return NextResponse.json({ error: 'Ongeldige vraag' }, { status: 400 })
    const meta = requestMeta(req)
    const admin = createAdminSupabaseClient()

    // Eigen weergave: Alles, Media of Solutions (enkel voor jezelf).
    if (b.actie === 'weergave') {
      const persoon = await leesPersoon()
      if (!persoon) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
      if (!isBedrijfFilter(b.bedrijf)) return NextResponse.json({ error: 'Kies Alles, Media of Solutions.' }, { status: 400 })
      // Ook in de databank, zodat de keuze je volgt naar een ander toestel. Lukt dat niet, dan blijft de cookie.
      await admin.from('gebruikers_voorkeuren').upsert({ auth_user_id: persoon.userId, bedrijf_filter: b.bedrijf, updated_at: new Date().toISOString() }, { onConflict: 'auth_user_id' })
      const res = NextResponse.json({ ok: true, bedrijf: b.bedrijf })
      res.cookies.set(BEDRIJF_COOKIE, b.bedrijf, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: false })
      return res
    }

    if (b.actie === 'dienst') {
      const g = await eisBeheer()
      if (!g.ok) return g.response
      const actor: Actor = { userId: g.persoon.userId, email: g.persoon.email, naam: g.persoon.naam, ...meta }
      const r = await bewaarDienst(admin, (b.invoer ?? {}) as DienstInvoer, typeof b.bestaand === 'string' ? b.bestaand : null, actor)
      if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 400 })
      return NextResponse.json({ ok: true, dienst: r.dienst, catalogus: await laadCatalogus(admin) })
    }

    if (b.actie === 'klassificeer' || b.actie === 'bevestig_alle') {
      const persoon = await leesPersoon()
      if (!persoon?.isAdmin) return NextResponse.json({ error: 'Enkel voor de zaakvoerders' }, { status: 403 })
      const actor: Actor = { userId: persoon.userId, email: persoon.email, naam: persoon.naam, ...meta }
      if (b.actie === 'klassificeer') {
        if (typeof b.id !== 'string' || typeof b.keuze !== 'string') return NextResponse.json({ error: 'Kies een bedrijf of dienst.' }, { status: 400 })
        const r = await klassificeer(admin, b.id, b.keuze, actor)
        if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 400 })
        return NextResponse.json({ ok: true })
      }
      if (!isKlassificatieTabel(b.tabel) || !isVeld(b.veld)) return NextResponse.json({ error: 'Onbekende lijst.' }, { status: 400 })
      const r = await bevestigVoorstellen(admin, b.tabel, b.veld, actor)
      return NextResponse.json(r)
    }

    // Bedrijf of dienst van één record zetten (bv. bovenaan een contract).
    if (b.actie === 'zet') {
      if (!isKlassificatieTabel(b.tabel) || !isVeld(b.veld) || typeof b.id !== 'string' || typeof b.keuze !== 'string') {
        return NextResponse.json({ error: 'Ongeldige vraag' }, { status: 400 })
      }
      const persoon = await magIk(MODULE_VAN[b.tabel] ?? 'clients', 'aanpassen')
      if (!persoon) return NextResponse.json({ error: 'Je mag dit niet aanpassen.' }, { status: 403 })
      const actor: Actor = { userId: persoon.userId, email: persoon.email, naam: persoon.naam, ...meta }
      const r = await zetBedrijfOfDienst(admin, b.tabel, b.id, b.veld, b.keuze, actor, 'scherm')
      if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 400 })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

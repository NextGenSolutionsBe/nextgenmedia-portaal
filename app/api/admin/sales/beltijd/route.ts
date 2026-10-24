import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin, requireStaff } from '@/lib/supabase/server'
import { listSalesMedewerkers } from '@/lib/sales/medewerkers'
import {
  BELTIJD_KOLOMMEN, BELTIJD_MIGRATIE_NODIG, isBeltijdTabelFout, laadBeltijd, laadLopendeSessie,
} from '@/lib/sales/beltijd-data'
import { MAX_HANDMATIG_MINUTEN, brusselNaarUtc, dezeWeek } from '@/lib/sales/beltijd'

export const dynamic = 'force-dynamic'

/**
 * Beltijd loggen — hoe lang iemand aan het bellen was (sessies), los van de
 * duur per gesprek.
 *
 * GET  ?medewerker=<auth-id>[&van=JJJJ-MM-DD&tot=JJJJ-MM-DD]
 *      → { beschikbaar, sessies (standaard deze week), lopend, medewerkerId, isAdmin, meId, medewerkers }
 * POST { actie: 'start' | 'stop' | 'handmatig', medewerkerId?, datum?, tijd?, duurMinuten?, notitie? }
 *
 * WIE: iedereen logt voor zichzelf; een admin mag ook voor een ander account
 * loggen en kijken. Dat wordt hier afgedwongen, niet in het scherm.
 */

async function doelMedewerker(actor: { id: string }, isAdmin: boolean, gevraagd: unknown): Promise<string | NextResponse> {
  const id = typeof gevraagd === 'string' ? gevraagd.trim() : ''
  if (!id || id === actor.id) return actor.id
  if (!isAdmin) return NextResponse.json({ error: 'Je kan enkel je eigen beltijd bekijken of loggen.' }, { status: 403 })
  const bekend = (await listSalesMedewerkers()).some((m) => m.id === id)
  if (!bekend) return NextResponse.json({ error: 'Onbekend account.' }, { status: 400 })
  return id
}

async function emailVan(id: string, actor: { id: string; email?: string | null }): Promise<string | null> {
  if (id === actor.id) return actor.email ?? null
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin.auth.admin.getUserById(id)
    return data?.user?.email ?? null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const isAdmin = !!(await requireAdmin())
    const sp = req.nextUrl.searchParams
    const doel = await doelMedewerker(actor, isAdmin, sp.get('medewerker'))
    if (doel instanceof NextResponse) return doel

    const week = dezeWeek()
    const van = (sp.get('van') && brusselNaarUtc(sp.get('van') as string, '00:00')) || week.van
    const totDag = sp.get('tot') && brusselNaarUtc(sp.get('tot') as string, '00:00')
    const tot = totDag ? new Date(totDag.getTime() + 86_400_000) : week.tot

    const admin = createAdminSupabaseClient()
    const [sessies, lopend] = await Promise.all([
      laadBeltijd(admin, { van, tot, medewerkerId: doel }),
      laadLopendeSessie(admin, doel),
    ])
    const medewerkers = isAdmin ? await listSalesMedewerkers() : []
    if (isAdmin && !medewerkers.some((m) => m.id === actor.id)) medewerkers.push({ id: actor.id, naam: actor.email?.split('@')[0] ?? 'Ik' })

    return NextResponse.json({
      beschikbaar: sessies !== null && lopend !== undefined,
      sessies: sessies ?? [],
      lopend: lopend ?? null,
      van: van.toISOString(), tot: tot.toISOString(),
      medewerkerId: doel, isAdmin, meId: actor.id, medewerkers,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const isAdmin = !!(await requireAdmin())
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const doel = await doelMedewerker(actor, isAdmin, b.medewerkerId)
    if (doel instanceof NextResponse) return doel
    const admin = createAdminSupabaseClient()
    const notitie = String(b.notitie ?? '').trim().slice(0, 500) || null
    const fout = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

    if (b.actie === 'start') {
      const lopend = await laadLopendeSessie(admin, doel)
      if (lopend === undefined) return fout(BELTIJD_MIGRATIE_NODIG, 503)
      if (lopend) return NextResponse.json({ error: 'Er loopt al een belsessie.', lopend }, { status: 409 })
      const { data, error } = await admin.from('sales_beltijd').insert({
        medewerker_id: doel, medewerker_email: await emailVan(doel, actor),
        start_op: new Date().toISOString(), notitie, aangemaakt_door: actor.id,
      }).select(BELTIJD_KOLOMMEN).single()
      if (error) {
        if (/duplicate key|unique/i.test(error.message)) return fout('Er loopt al een belsessie.', 409)
        if (isBeltijdTabelFout(error.message)) return fout(BELTIJD_MIGRATIE_NODIG, 503)
        throw new Error(error.message)
      }
      return NextResponse.json({ ok: true, sessie: data })
    }

    if (b.actie === 'stop') {
      const lopend = await laadLopendeSessie(admin, doel)
      if (lopend === undefined) return fout(BELTIJD_MIGRATIE_NODIG, 503)
      if (!lopend) return fout('Er loopt geen belsessie.', 409)
      const einde = new Date()
      const duur = Math.max(0, Math.round((einde.getTime() - new Date(lopend.start_op).getTime()) / 1000))
      const patch: Record<string, unknown> = { einde_op: einde.toISOString(), duur_seconden: duur }
      if (notitie) patch.notitie = notitie
      const { data, error } = await admin.from('sales_beltijd').update(patch)
        .eq('id', lopend.id).is('einde_op', null).select(BELTIJD_KOLOMMEN).maybeSingle()
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, sessie: data })
    }

    if (b.actie === 'handmatig') {
      const datum = String(b.datum ?? '')
      const tijd = String(b.tijd ?? '').trim() || '09:00'
      const start = brusselNaarUtc(datum, tijd)
      if (!start) return fout('Kies een geldige datum (en tijd).')
      const minuten = Number(String(b.duurMinuten ?? '').replace(',', '.'))
      if (!Number.isFinite(minuten) || minuten <= 0) return fout('Geef de duur in minuten.')
      if (minuten > MAX_HANDMATIG_MINUTEN) return fout(`Maximaal ${MAX_HANDMATIG_MINUTEN / 60} uur per invoer.`)
      if (start.getTime() > Date.now() + 60_000) return fout('Beltijd in de toekomst loggen kan niet.')
      const duur = Math.round(minuten * 60)
      const { data, error } = await admin.from('sales_beltijd').insert({
        medewerker_id: doel, medewerker_email: await emailVan(doel, actor),
        start_op: start.toISOString(), einde_op: new Date(start.getTime() + duur * 1000).toISOString(),
        duur_seconden: duur, notitie, aangemaakt_door: actor.id,
      }).select(BELTIJD_KOLOMMEN).single()
      if (error) {
        if (isBeltijdTabelFout(error.message)) return fout(BELTIJD_MIGRATIE_NODIG, 503)
        throw new Error(error.message)
      }
      return NextResponse.json({ ok: true, sessie: data })
    }

    return fout('Onbekende actie.')
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

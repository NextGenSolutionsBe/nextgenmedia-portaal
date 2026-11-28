import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, getStaffRow } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { netteBedrijven } from '@/lib/team/rollen'
import { laadSjablonen } from '@/lib/team/rollen-server'
import { controleerInstructie, nieuweVersieNodig, geldtVoor, type Werkinstructie } from '@/lib/team/werkinstructies'

export const dynamic = 'force-dynamic'
// soort (fase 7): 'afspraken' = de vaste pagina met gedragsafspraken en rolverdeling.
const VELDEN = 'id, titel, inhoud, bedrijf, dienst_slug, rol_sjabloon, versie, gearchiveerd_op, gewijzigd_door, updated_at, soort'
const UUID = /^[0-9a-f-]{36}$/i

/** Wie mag werkinstructies schrijven? Een hoofdbeheerder of een beheerder met Informatief. */
const magBeheren = (p: { isAdmin: boolean; rol: string }) => p.isAdmin || p.rol === 'beheerder'

/**
 * GET — de werkinstructies die voor jou gelden (beheerders zien alles), met wat je al las.
 * ?archief=1 toont ook de gearchiveerde. ?versies=<id> geeft de eerdere versies van één instructie.
 */
export async function GET(req: NextRequest) {
  try {
    const p = await magIk('info', 'bekijken')
    if (!p) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const sp = req.nextUrl.searchParams
    const beheer = magBeheren(p)
    const versiesVan = sp.get('versies')
    if (versiesVan) {
      if (!UUID.test(versiesVan)) return NextResponse.json({ error: 'Onbekende instructie' }, { status: 400 })
      const { data } = await admin.from('werkinstructie_versies').select('versie, titel, inhoud, opgeslagen_door, created_at').eq('instructie_id', versiesVan).order('versie', { ascending: false })
      return NextResponse.json({ versies: data ?? [] })
    }
    const staff = p.isAdmin ? null : await getStaffRow(p.userId)
    const { data: sj } = p.isAdmin ? { data: null } : await admin.from('staff_members').select('rol_sjabloon').eq('auth_user_id', p.userId).maybeSingle()
    const ik = { isAdmin: p.isAdmin, bedrijven: netteBedrijven(staff?.bedrijven ?? []), sjabloon: (sj as { rol_sjabloon: string | null } | null)?.rol_sjabloon ?? null }

    let q = admin.from('werkinstructies').select(VELDEN).order('titel', { ascending: true })
    if (!(beheer && sp.get('archief') === '1')) q = q.is('gearchiveerd_op', null)
    const [{ data: rijen, error }, { data: mijn }, { data: diensten }, sjablonen] = await Promise.all([
      q,
      admin.from('werkinstructie_gelezen').select('instructie_id, versie').eq('auth_user_id', p.userId),
      admin.from('diensten_catalogus').select('slug, naam, bedrijf').eq('actief', true).order('volgorde', { ascending: true }),
      laadSjablonen(admin, true),
    ])
    if (error) return NextResponse.json({ instructies: [], gelezen: {}, magBeheren: beheer, diensten: [], sjablonen: [], fout: 'Werkinstructies zijn nog niet beschikbaar.' })
    const lijst = ((rijen ?? []) as Werkinstructie[]).filter((i) => beheer || geldtVoor(i, ik))
    const gelezen: Record<string, number[]> = {}
    for (const g of (mijn ?? []) as { instructie_id: string; versie: number }[]) (gelezen[g.instructie_id] ??= []).push(g.versie)

    // Voor beheerders: wie de huidige versie las.
    let lezers: Record<string, { naam: string; op: string }[]> = {}
    if (beheer && lijst.length) {
      const { data: alle } = await admin.from('werkinstructie_gelezen').select('instructie_id, versie, naam, gelezen_op').in('instructie_id', lijst.map((i) => i.id))
      const versie = new Map(lijst.map((i) => [i.id, i.versie]))
      lezers = {}
      for (const r of (alle ?? []) as { instructie_id: string; versie: number; naam: string | null; gelezen_op: string }[]) {
        if (versie.get(r.instructie_id) !== r.versie) continue
        ;(lezers[r.instructie_id] ??= []).push({ naam: r.naam ?? 'Iemand', op: r.gelezen_op })
      }
    }
    return NextResponse.json({
      instructies: lijst, gelezen, lezers, magBeheren: beheer,
      diensten: (diensten ?? []) as { slug: string; naam: string; bedrijf: string | null }[],
      sjablonen: sjablonen.map((s) => ({ key: s.key, naam: s.naam })),
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** POST — { actie: 'gelezen' | 'nieuw' | 'wijzig' | 'archiveer' | 'terugzetten', ... }. Verwijderen bestaat niet. */
export async function POST(req: NextRequest) {
  try {
    const p = await magIk('info', 'bekijken')
    if (!p) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!b) return NextResponse.json({ error: 'Ongeldige gegevens.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const naam = p.naam ?? p.email
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null

    if (b.actie === 'gelezen') {
      if (!id) return NextResponse.json({ error: 'Onbekende instructie' }, { status: 400 })
      const { data: i } = await admin.from('werkinstructies').select('versie').eq('id', id).is('gearchiveerd_op', null).maybeSingle()
      if (!i) return NextResponse.json({ error: 'Deze instructie bestaat niet (meer).' }, { status: 404 })
      const versie = (i as { versie: number }).versie
      const { error } = await admin.from('werkinstructie_gelezen').upsert({ instructie_id: id, versie, auth_user_id: p.userId, naam, gelezen_op: new Date().toISOString() }, { onConflict: 'instructie_id,versie,auth_user_id', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, versie })
    }

    if (!magBeheren(p)) return NextResponse.json({ error: 'Enkel een beheerder kan werkinstructies schrijven.' }, { status: 403 })
    const meta = requestMeta(req)
    const log = (action: string, entityId: string, summary: string) => logAudit({ action, entityType: 'werkinstructie', entityId, summary, actorUserId: p.userId, actorEmail: p.email, actorRole: p.isAdmin ? 'admin' : 'staff', ip: meta.ip, userAgent: meta.userAgent })

    if (b.actie === 'nieuw') {
      const c = controleerInstructie(b)
      if (!c.ok) return NextResponse.json({ error: c.fout }, { status: 400 })
      const { data, error } = await admin.from('werkinstructies').insert({ ...c.invoer, versie: 1, gemaakt_door: naam, gewijzigd_door: naam }).select('id').single()
      if (error || !data) throw new Error(error?.message ?? 'Bewaren mislukt')
      const nieuwId = (data as { id: string }).id
      await admin.from('werkinstructie_versies').insert({ instructie_id: nieuwId, versie: 1, titel: c.invoer.titel, inhoud: c.invoer.inhoud, opgeslagen_door: naam })
      await log('werkinstructie.nieuw', nieuwId, `Werkinstructie toegevoegd: ${c.invoer.titel}`)
      return NextResponse.json({ ok: true, id: nieuwId })
    }
    if (!id) return NextResponse.json({ error: 'Onbekende instructie' }, { status: 400 })
    const { data: oud } = await admin.from('werkinstructies').select(VELDEN).eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Deze instructie bestaat niet (meer).' }, { status: 404 })
    const o = oud as Werkinstructie

    if (b.actie === 'wijzig') {
      const c = controleerInstructie(b)
      if (!c.ok) return NextResponse.json({ error: c.fout }, { status: 400 })
      // Twee mensen tegelijk: wie op een oudere versie bewaart, krijgt een melding.
      if (typeof b.versie === 'number' && b.versie !== o.versie) return NextResponse.json({ error: 'Iemand anders paste deze instructie intussen aan. Herlaad en probeer opnieuw.' }, { status: 409 })
      const nieuw = nieuweVersieNodig(o, c.invoer)
      const versie = nieuw ? o.versie + 1 : o.versie
      const { error } = await admin.from('werkinstructies').update({ ...c.invoer, versie, gewijzigd_door: naam, updated_at: new Date().toISOString() }).eq('id', id).eq('versie', o.versie)
      if (error) throw new Error(error.message)
      if (nieuw) await admin.from('werkinstructie_versies').insert({ instructie_id: id, versie, titel: c.invoer.titel, inhoud: c.invoer.inhoud, opgeslagen_door: naam })
      await log('werkinstructie.gewijzigd', id, `Werkinstructie ${nieuw ? `naar versie ${versie}` : 'labels aangepast'}: ${c.invoer.titel}`)
      return NextResponse.json({ ok: true, versie, nieuweVersie: nieuw })
    }
    if (b.actie === 'archiveer' || b.actie === 'terugzetten') {
      const { error } = await admin.from('werkinstructies').update({ gearchiveerd_op: b.actie === 'archiveer' ? new Date().toISOString() : null, gewijzigd_door: naam }).eq('id', id)
      if (error) throw new Error(error.message)
      await log(`werkinstructie.${b.actie}`, id, `Werkinstructie ${b.actie === 'archiveer' ? 'gearchiveerd' : 'teruggezet'}: ${o.titel}`)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

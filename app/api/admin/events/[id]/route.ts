import { NextRequest, NextResponse } from 'next/server'
import { verwijderMarketingBestand } from '@/lib/marketing-server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import { valideerEvent, type Inschrijving, type EventInvoer } from '@/lib/events'
import { leesEvent, publiceer, werkEventBij, annuleerEvent, zorgVoorGoogle, syncGasten, agendaOpties, standaardAgenda } from '@/lib/events-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID = /^[0-9a-f-]{36}$/i

/** Eén event met zijn inschrijvingen (klantnaam erbij). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await magIk('events', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Onbekend event' }, { status: 400 })
  try {
    const admin = createAdminSupabaseClient()
    const e = await leesEvent(admin, params.id)
    if (!e) return NextResponse.json({ error: 'Event niet gevonden' }, { status: 404 })
    const [{ data: rijen }, agendas, standaard] = await Promise.all([
      admin.from('klant_event_inschrijvingen').select('*, clients ( company_name )').eq('event_id', e.id).order('created_at', { ascending: false }).limit(5000),
      agendaOpties(admin),
      standaardAgenda(admin),
    ])
    const inschrijvingen = ((rijen ?? []) as (Inschrijving & { clients?: { company_name?: string | null } | null })[])
      .map(({ clients, ...r }) => ({ ...r, klant: clients?.company_name ?? null }))
    return NextResponse.json({ event: e, inschrijvingen, agendas, standaardAgenda: standaard }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) { return NextResponse.json({ error: safeMessage(err, 'events.id.GET') }, { status: 500 }) }
}

/**
 * actie: bewaar (velden) · publiceer · annuleer · google_opnieuw · gasten
 * Publiceren maakt het Google-event (online met Meet). Een andere tijd, plaats
 * of titel van een gepubliceerd event: Google verwittigt de ingeschrevenen.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const persoon = await magIk('events', 'aanpassen')
    if (!persoon) return NextResponse.json({ error: 'Je mag events niet aanpassen.' }, { status: 403 })
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Onbekend event' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const e = await leesEvent(admin, params.id)
    if (!e) return NextResponse.json({ error: 'Event niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown> & { actie?: string }
    const audit = (actie: string) => logAudit({ action: `event.${actie}`, entityType: 'klant_event', entityId: e.id, actorUserId: persoon.userId, actorEmail: persoon.email, summary: e.titel }).catch(() => null)

    if (b.actie === 'bewaar' || b.actie === 'bewaar_en_publiceer') {
      if (e.status === 'geannuleerd') return NextResponse.json({ error: 'Een geannuleerd event pas je niet meer aan. Dupliceer het.' }, { status: 409 })
      const v = valideerEvent(b as EventInvoer, new Date(), { bestaand: true })
      if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
      // Een nieuwe datum moet in de toekomst liggen; een afgelopen event mag zijn tekst nog bijwerken.
      if (Date.parse(v.waarde.start_op) !== Date.parse(e.start_op) && Date.parse(v.waarde.start_op) < Date.now()) {
        return NextResponse.json({ error: 'De nieuwe datum en het nieuwe uur zijn al voorbij.' }, { status: 400 })
      }
      if (e.capaciteit !== v.waarde.capaciteit && v.waarde.capaciteit != null) {
        const { count } = await admin.from('klant_event_inschrijvingen').select('id', { count: 'exact', head: true }).eq('event_id', e.id).eq('status', 'ingeschreven')
        if ((count ?? 0) > v.waarde.capaciteit) return NextResponse.json({ error: `Er zijn al ${count} mensen ingeschreven. Zet het aantal plaatsen op minstens ${count}.` }, { status: 400 })
      }
      const r = await werkEventBij(admin, e, v.waarde)
      await audit('bewaard')
      if (b.actie === 'bewaar_en_publiceer' && r.event.status === 'concept') {
        const p = await publiceer(admin, r.event)
        if (!p.ok) return NextResponse.json({ error: p.fout, event: r.event }, { status: 409 })
        await audit('gepubliceerd')
        return NextResponse.json({ event: p.event, waarschuwing: p.waarschuwing ?? null })
      }
      return NextResponse.json({ event: r.event, waarschuwing: r.waarschuwing ?? null, verwittigd: r.verwittigd })
    }
    if (b.actie === 'publiceer') {
      if (e.status !== 'concept') return NextResponse.json({ error: 'Dit event is al gepubliceerd of geannuleerd.' }, { status: 409 })
      const p = await publiceer(admin, e)
      if (!p.ok) return NextResponse.json({ error: p.fout }, { status: 409 })
      await audit('gepubliceerd')
      return NextResponse.json({ event: p.event, waarschuwing: p.waarschuwing ?? null })
    }
    if (b.actie === 'annuleer') {
      if (e.status === 'geannuleerd') return NextResponse.json({ event: e })
      const r = await annuleerEvent(admin, e)
      await audit('geannuleerd')
      return NextResponse.json({ event: r.event, waarschuwing: r.waarschuwing ?? null })
    }
    if (b.actie === 'google_opnieuw') {
      if (e.status === 'geannuleerd') return NextResponse.json({ error: 'Dit event is geannuleerd.' }, { status: 409 })
      const g = await zorgVoorGoogle(admin, e)
      if (g.ok && g.event.status === 'gepubliceerd') await syncGasten(admin, e.id)
      return g.ok ? NextResponse.json({ event: await leesEvent(admin, e.id) }) : NextResponse.json({ error: g.fout, event: g.event }, { status: 409 })
    }
    if (b.actie === 'gasten') {
      const r = await syncGasten(admin, e.id)
      return r.ok ? NextResponse.json({ event: await leesEvent(admin, e.id), aantal: r.aantal ?? null }) : NextResponse.json({ error: r.fout }, { status: 409 })
    }
    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) { return NextResponse.json({ error: safeMessage(err, 'events.id.PATCH') }, { status: 500 }) }
}

/**
 * Volledig verwijderen, met inschrijvingen. Staat het event nog in Google, dan
 * eerst annuleren: wie ingeschreven is voor een komend event, krijgt dan het
 * bericht van Google. Daarna zijn event, inschrijvingen en coverfoto weg.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const persoon = await magIk('events', 'verwijderen')
    if (!persoon) return NextResponse.json({ error: 'Je mag events niet verwijderen.' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const e = await leesEvent(admin, params.id)
    if (!e) return NextResponse.json({ ok: true })
    if (e.google_event_id && e.google_status !== 'geannuleerd') {
      const r = await annuleerEvent(admin, e)
      if (r.event.google_status === 'fout') return NextResponse.json({ error: `Het Google-event kon niet geannuleerd worden: ${r.event.google_fout}. Probeer opnieuw; er is niets verwijderd.` }, { status: 502 })
    }
    await admin.from('klant_event_inschrijvingen').delete().eq('event_id', e.id)
    const { error } = await admin.from('klant_events').delete().eq('id', e.id)
    if (error) throw new Error(error.message)
    if (e.cover_pad) await verwijderMarketingBestand(admin, e.cover_pad).catch(() => null)
    await logAudit({ action: 'event.verwijderd', entityType: 'klant_event', entityId: e.id, actorUserId: persoon.userId, actorEmail: persoon.email, summary: e.titel }).catch(() => null)
    return NextResponse.json({ ok: true })
  } catch (err) { return NextResponse.json({ error: safeMessage(err, 'events.id.DELETE') }, { status: 500 }) }
}

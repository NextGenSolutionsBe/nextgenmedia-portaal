import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { valideerMeeting } from '@/lib/meetings/model'
import { stapGoogle, stapClickup, planHerinnering, type MeetingRij, type HerinneringRij } from '@/lib/meetings/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Klantmeetings.
 *  GET            → meetings met hun laatste herinnering
 *  GET ?opties=1  → klanten, contactpersonen en agenda's voor het planscherm
 *  POST           → meeting inplannen (Google + Meet, ClickUp, herinnering)
 * Toegang: module 'meetings' (middleware per HTTP-methode én hier nog eens).
 * Tokens en sleutels verlaten de server nooit.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const persoon = await magIk('meetings', 'bekijken')
    if (!persoon) return NextResponse.json({ error: 'Geen toegang tot klantmeetings' }, { status: 403 })
    const admin = createAdminSupabaseClient()

    if (req.nextUrl.searchParams.get('opties')) {
      const [{ data: klanten }, { data: contacten }, { data: agendas }, { data: pipes }] = await Promise.all([
        admin.from('clients').select('id, company_name, contact_name, email').is('archived_at', null).order('company_name').limit(2000),
        admin.from('client_users').select('client_id, name, email').eq('active', true).limit(5000),
        admin.from('sales_calendar_connections').select('id, name, status, active, provider').eq('active', true).order('name'),
        admin.from('sales_pipelines').select('key, default_calendar_id'),
      ])
      const ngm = ((pipes ?? []) as { key: string; default_calendar_id: string | null }[]).find((p) => p.key === 'nextgenmedia')
      return NextResponse.json({
        klanten: klanten ?? [],
        contacten: contacten ?? [],
        agendas: ((agendas ?? []) as { id: string; name: string; status: string; provider: string }[])
          .filter((a) => a.provider === 'google')
          .map((a) => ({ id: a.id, naam: a.name, gekoppeld: a.status === 'connected' })),
        standaardAgenda: ngm?.default_calendar_id ?? null,
        ik: { naam: persoon.naam, email: persoon.email },
        rechten: {
          toevoegen: !!(await magIk('meetings', 'toevoegen')),
          aanpassen: !!(await magIk('meetings', 'aanpassen')),
        },
      })
    }

    const { data, error } = await admin.from('klant_meetings').select('*').order('starts_at', { ascending: true }).limit(500)
    if (error) throw new Error(error.message)
    const meetings = (data ?? []) as MeetingRij[]
    const herinneringen: Record<string, HerinneringRij> = {}
    if (meetings.length) {
      const { data: h } = await admin.from('klant_meeting_herinneringen').select('*')
        .in('meeting_id', meetings.map((m) => m.id)).order('created_at', { ascending: true })
      for (const r of (h ?? []) as HerinneringRij[]) herinneringen[r.meeting_id] = r // laatste wint
    }
    return NextResponse.json({ meetings: meetings.map((m) => ({ ...m, herinnering: herinneringen[m.id] ?? null })) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'meetings.GET') }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const persoon = await magIk('meetings', 'toevoegen')
    if (!persoon) return NextResponse.json({ error: 'Je mag geen klantmeetings inplannen' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()

    const sleutel = String(b.aanvraag_sleutel ?? '')
    if (!UUID.test(sleutel)) return NextResponse.json({ error: 'Ongeldige aanvraag. Ververs het scherm en probeer opnieuw.' }, { status: 400 })

    // Zelfde aanvraag opnieuw (dubbele klik, time-out): de bestaande meeting teruggeven.
    const { data: bestaand } = await admin.from('klant_meetings').select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
    if (bestaand) return NextResponse.json({ meeting: bestaand, herhaald: true })

    const clientId = String(b.client_id ?? '')
    if (!UUID.test(clientId)) return NextResponse.json({ error: 'Kies een klant.' }, { status: 400 })
    const { data: klant } = await admin.from('clients').select('id, company_name, contact_name').eq('id', clientId).maybeSingle()
    if (!klant) return NextResponse.json({ error: 'Klant niet gevonden.' }, { status: 404 })

    const agendaId = String(b.agenda_id ?? '')
    if (!UUID.test(agendaId)) return NextResponse.json({ error: 'Kies de agenda waarin de meeting komt.' }, { status: 400 })
    const { data: agenda } = await admin.from('sales_calendar_connections').select('id, name, status, active, signature_email').eq('id', agendaId).maybeSingle()
    if (!agenda || agenda.active === false) return NextResponse.json({ error: 'Deze agenda bestaat niet (meer).' }, { status: 400 })
    if (agenda.status !== 'connected') return NextResponse.json({ error: `De Google-koppeling van "${agenda.name}" is verlopen. Koppel ze opnieuw via Verkoop → Agenda.` }, { status: 400 })

    const v = valideerMeeting(b)
    if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
    const w = v.waarde
    const organisator = String(b.organisator_naam ?? '').trim().slice(0, 120) || String(agenda.name ?? '').split(/\s+[—-]\s+/)[0] || null

    const { data: rij, error } = await admin.from('klant_meetings').insert({
      aanvraag_sleutel: sleutel, client_id: klant.id, klant_naam: klant.company_name || klant.contact_name || 'Klant',
      titel: w.titel, beschrijving: w.beschrijving, starts_at: w.startsAt, ends_at: w.endsAt, tijdzone: 'Europe/Brussels',
      agenda_id: agenda.id, organisator_naam: organisator, organisator_email: agenda.signature_email || null,
      klant_ontvangers: w.klant_ontvangers, deelnemers: w.deelnemers, herinnering_aan: w.herinnering_aan,
      created_by: user.id, created_by_email: persoon.email,
    }).select('*').single()
    if (error) {
      if (/duplicate|unique|23505/i.test(error.message)) {
        const { data: dubbel } = await admin.from('klant_meetings').select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
        if (dubbel) return NextResponse.json({ meeting: dubbel, herhaald: true })
      }
      throw new Error(error.message)
    }

    let m = rij as MeetingRij
    m = await stapGoogle(admin, m)
    m = await stapClickup(admin, m)
    let herinnering: HerinneringRij | null = null
    let herinneringFout: string | null = null
    try { herinnering = await planHerinnering(admin, m) } catch (e) { herinneringFout = safeMessage(e, 'meetings.herinnering') }

    const { ip, userAgent } = requestMeta(req)
    await logAudit({
      action: 'meeting.ingepland', entityType: 'klant_meeting', entityId: m.id, actorUserId: user.id, actorEmail: persoon.email,
      summary: `${m.klant_naam}: ${m.titel}`, ip, userAgent,
      metadata: { starts_at: m.starts_at, google: m.google_status, clickup: m.clickup_status, herinnering: herinnering?.gepland_voor ?? null },
    })
    return NextResponse.json({ meeting: { ...m, herinnering }, herinneringFout })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'meetings.POST') }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { valideerMeeting, wijzigingen, dag, uur, duurMinuten } from '@/lib/meetings/model'
import {
  leesMeeting, bewaarMeeting, stapGoogle, stapClickup, planHerinnering, herinneringOpnieuw, annuleer, annuleerGoogle,
  annuleerClickup, bouwHerinnering, laatsteHerinnering, type HerinneringRij,
} from '@/lib/meetings/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Eén klantmeeting.
 *  GET   → meeting, alle herinneringen en de mail zoals hij nu zou vertrekken
 *  PATCH → { actie: 'wijzig' | 'annuleer' | 'opnieuw' | 'herinnering_opnieuw', ... }
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function herinneringen(admin: ReturnType<typeof createAdminSupabaseClient>, id: string): Promise<HerinneringRij[]> {
  const { data } = await admin.from('klant_meeting_herinneringen').select('*').eq('meeting_id', id).order('created_at', { ascending: true })
  return (data ?? []) as HerinneringRij[]
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!(await magIk('meetings', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang tot klantmeetings' }, { status: 403 })
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const m = await leesMeeting(admin, params.id)
    if (!m) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    const lijst = await herinneringen(admin, m.id)
    const laatste = lijst[lijst.length - 1] ?? null
    const mail = bouwHerinnering(m, laatste?.ontvangers?.length ? laatste.ontvangers : m.klant_ontvangers)
    return NextResponse.json({ meeting: { ...m, herinnering: laatste }, herinneringen: lijst, mail: { onderwerp: mail.onderwerp, tekst: mail.tekst } })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'meetings.id.GET') }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const persoon = await magIk('meetings', 'aanpassen')
    if (!persoon) return NextResponse.json({ error: 'Je mag klantmeetings niet aanpassen' }, { status: 403 })
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    let m = await leesMeeting(admin, params.id)
    if (!m) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const actie = String(b.actie ?? '')
    const { ip, userAgent } = requestMeta(req)
    const audit = (action: string, metadata: Record<string, unknown> = {}) => logAudit({
      action, entityType: 'klant_meeting', entityId: m!.id, actorUserId: user.id, actorEmail: persoon.email,
      summary: `${m!.klant_naam}: ${m!.titel}`, ip, userAgent, metadata,
    })
    const antwoord = async (extra: Record<string, unknown> = {}) => {
      const lijst = await herinneringen(admin, m!.id)
      return NextResponse.json({ meeting: { ...m, herinnering: lijst[lijst.length - 1] ?? null }, herinneringen: lijst, ...extra })
    }

    if (actie === 'wijzig') {
      if (m.status !== 'ingepland') return NextResponse.json({ error: 'Een geannuleerde meeting kan je niet meer aanpassen.' }, { status: 400 })
      if (new Date(m.starts_at).getTime() <= Date.now()) return NextResponse.json({ error: 'Deze meeting is al begonnen of voorbij.' }, { status: 400 })
      const invoer = {
        titel: b.titel ?? m.titel, beschrijving: b.beschrijving !== undefined ? b.beschrijving : m.beschrijving,
        dag: b.dag ?? dag(m.starts_at), uur: b.uur ?? uur(m.starts_at), duur_minuten: b.duur_minuten ?? duurMinuten(m.starts_at, m.ends_at),
        klant_ontvangers: b.klant_ontvangers ?? m.klant_ontvangers, deelnemers: b.deelnemers ?? m.deelnemers,
        herinnering_aan: b.herinnering_aan !== undefined ? b.herinnering_aan : m.herinnering_aan,
      }
      const v = valideerMeeting(invoer)
      if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
      const w = wijzigingen(m, v.waarde)
      if (!w.iets) return antwoord({ ongewijzigd: true })
      m = await bewaarMeeting(admin, m.id, {
        titel: v.waarde.titel, beschrijving: v.waarde.beschrijving, starts_at: v.waarde.startsAt, ends_at: v.waarde.endsAt,
        klant_ontvangers: v.waarde.klant_ontvangers, deelnemers: v.waarde.deelnemers, herinnering_aan: v.waarde.herinnering_aan,
      })
      // Zelfde Google-afspraak bijwerken (Meet-link blijft); ClickUp volgt; herinnering vervangen als tijd of ontvangers wijzigen.
      if (w.tijd || w.inhoud || w.genodigden) m = await stapGoogle(admin, m, { bijwerken: true })
      if (w.tijd || w.inhoud || w.genodigden) m = await stapClickup(admin, m)
      let herinneringFout: string | null = null
      // Al verstuurd en enkel ontvangers gewijzigd of terug aangezet: geen tweede herinnering.
      const vorige = await laatsteHerinnering(admin, m.id)
      const alVerstuurd = vorige?.status === 'verzonden' || vorige?.status === 'bezig'
      if (w.tijd || ((w.ontvangers || w.herinnering) && (!alVerstuurd || !m.herinnering_aan))) {
        try { await planHerinnering(admin, m) } catch (e) { herinneringFout = safeMessage(e, 'meetings.herinnering') }
      }
      await audit('meeting.gewijzigd', { tijd: w.tijd, inhoud: w.inhoud, genodigden: w.genodigden, herinnering: w.herinnering, google: m.google_status, clickup: m.clickup_status })
      return antwoord({ herinneringFout })
    }

    if (actie === 'annuleer') {
      const verwittigen = b.genodigden_verwittigen !== false
      m = await annuleer(admin, m, persoon.email, verwittigen)
      await audit('meeting.geannuleerd', { google: m.google_status, clickup: m.clickup_status, genodigden_verwittigd: verwittigen })
      return antwoord()
    }

    if (actie === 'opnieuw') {
      const stap = String(b.stap ?? '')
      if (m.status === 'geannuleerd') {
        if (stap === 'google') m = await annuleerGoogle(admin, m, b.genodigden_verwittigen !== false)
        else if (stap === 'clickup') m = await annuleerClickup(admin, m)
        else return NextResponse.json({ error: 'Onbekende stap' }, { status: 400 })
      } else if (stap === 'google') {
        const hadLink = !!m.meet_url
        m = await stapGoogle(admin, m)
        // Nieuwe Meet-link: ook in de ClickUp-taak zetten.
        if (!hadLink && m.meet_url && m.clickup_task_id) m = await stapClickup(admin, m)
      } else if (stap === 'clickup') {
        m = await stapClickup(admin, m)
      } else if (stap === 'herinnering') {
        // Enkel als er nog geen loopt of vertrok (bv. na een mislukte planning); nooit met terugwerkende kracht.
        const vorige = await laatsteHerinnering(admin, m.id)
        if (vorige && vorige.status !== 'geannuleerd') return NextResponse.json({ error: 'Er is al een herinnering gepland of verstuurd voor deze meeting.' }, { status: 400 })
        await planHerinnering(admin, m)
      } else return NextResponse.json({ error: 'Onbekende stap' }, { status: 400 })
      await audit('meeting.stap_opnieuw', { stap, google: m.google_status, clickup: m.clickup_status })
      return antwoord()
    }

    if (actie === 'herinnering_opnieuw') {
      if (m.status !== 'ingepland') return NextResponse.json({ error: 'De meeting is geannuleerd.' }, { status: 400 })
      const r = await herinneringOpnieuw(admin, m)
      await audit('meeting.herinnering_opnieuw', { uitkomst: r.uitkomst ?? null, fout: r.fout ?? null })
      if (!r.ok && r.fout) return NextResponse.json({ error: r.fout }, { status: 400 })
      return antwoord({ uitkomst: r.uitkomst })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'meetings.id.PATCH') }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { plannerRechten, magMeeting } from '@/lib/meetings/rechten'
import { bevestigingOpnieuw } from '@/lib/meetings/klantboeking-server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { clickupTaakIdUit } from '@/lib/clickup'
import { haalMeetingEvent } from '@/lib/sales/google-calendar'
import { valideerMeeting, wijzigingen, dag, uur, duurMinuten, naamZonderKlant } from '@/lib/meetings/model'
import {
  leesMeeting, bewaarMeeting, stapGoogle, stapClickup, planHerinnering, herinneringOpnieuw, annuleer, annuleerGoogle,
  annuleerClickup, bouwHerinnering, laatsteHerinnering, veiligeFout, type HerinneringRij, type MeetingRij,
} from '@/lib/meetings/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Eén meeting.
 *  GET   → meeting, herinneringen, de mail zoals hij nu zou vertrekken en de
 *          antwoorden van de genodigden (live uit Google)
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
    const r = await plannerRechten()
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const m = await leesMeeting(admin, params.id)
    if (!m || !magMeeting(r, m, 'bekijken')) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    const lijst = await herinneringen(admin, m.id)
    const laatste = lijst[lijst.length - 1] ?? null
    const mail = bouwHerinnering(m, laatste?.ontvangers?.length ? laatste.ontvangers : m.klant_ontvangers)

    // Wie heeft de uitnodiging al beantwoord? Best-effort: Google mag traag zijn.
    let antwoorden: { email: string; antwoord: string }[] | null = null
    let antwoordenFout: string | null = null
    if (m.status === 'ingepland' && m.agenda_id && m.google_event_id && m.google_calendar_id) {
      try { antwoorden = (await haalMeetingEvent(m.agenda_id, m.google_calendar_id, m.google_event_id))?.genodigden ?? null } catch (e) { antwoordenFout = veiligeFout(e) }
    }
    const [{ data: klant }, { data: project }] = await Promise.all([
      m.client_id ? admin.from('clients').select('id, company_name').eq('id', m.client_id).maybeSingle() : Promise.resolve({ data: null }),
      m.project_id ? admin.from('opdrachten').select('id, titel').eq('id', m.project_id).maybeSingle() : Promise.resolve({ data: null }),
    ]) as [{ data: { id: string; company_name: string | null } | null }, { data: { id: string; titel: string } | null }]

    return NextResponse.json({
      meeting: { ...m, herinnering: laatste }, herinneringen: lijst, mail: { onderwerp: mail.onderwerp, tekst: mail.tekst },
      antwoorden, antwoordenFout, klant, project,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'meetings.id.GET') }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const rechten = await plannerRechten()
    const persoon = rechten.persoon
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    let m = await leesMeeting(admin, params.id)
    if (!m || !persoon) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    if (!magMeeting(rechten, m, 'aanpassen')) return NextResponse.json({ error: 'Je mag deze meeting niet aanpassen' }, { status: 403 })
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
    /** Na een gelukte agenda-stap: wat toen bleef wachten (ClickUp, herinnering) alsnog doen. */
    const vervolg = async (x: MeetingRij): Promise<MeetingRij> => {
      if (x.google_status !== 'ok') return x
      if (x.clickup_status === 'wacht') x = await stapClickup(admin, x)
      if (x.herinnering_aan && !(await laatsteHerinnering(admin, x.id))) await planHerinnering(admin, x)
      return x
    }

    if (actie === 'wijzig') {
      if (m.status !== 'ingepland') return NextResponse.json({ error: 'Een geannuleerde meeting kan je niet meer aanpassen.' }, { status: 400 })
      if (new Date(m.starts_at).getTime() <= Date.now()) return NextResponse.json({ error: 'Deze meeting is al begonnen of voorbij.' }, { status: 400 })
      const tz = String(b.tijdzone ?? m.tijdzone ?? 'Europe/Brussels')
      const invoer = {
        titel: b.titel ?? m.titel, beschrijving: b.beschrijving !== undefined ? b.beschrijving : m.beschrijving, tijdzone: tz,
        dag: b.dag ?? dag(m.starts_at, m.tijdzone), uur: b.uur ?? uur(m.starts_at, m.tijdzone),
        duur_minuten: b.duur_minuten ?? duurMinuten(m.starts_at, m.ends_at), eind_uur: b.eind_uur,
        klant_ontvangers: b.klant_ontvangers ?? m.klant_ontvangers, deelnemers: b.deelnemers ?? m.deelnemers,
        herinnering_aan: b.herinnering_aan !== undefined ? b.herinnering_aan : m.herinnering_aan,
      }
      const v = valideerMeeting(invoer)
      if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })

      // Koppelingen (klant, project, ClickUp-item) zijn optioneel en aanpasbaar.
      let clientId = m.client_id ?? null
      let klantNaam: string | null = null
      if (b.client_id !== undefined) {
        clientId = b.client_id ? String(b.client_id) : null
        if (clientId && !UUID.test(clientId)) return NextResponse.json({ error: 'Ongeldige klant.' }, { status: 400 })
      }
      if (clientId) {
        const { data: klant } = await admin.from('clients').select('company_name, contact_name').eq('id', clientId).maybeSingle()
        if (!klant) return NextResponse.json({ error: 'Klant niet gevonden.' }, { status: 404 })
        klantNaam = klant.company_name || klant.contact_name || null
      }
      klantNaam = klantNaam ?? naamZonderKlant(v.waarde.klant_ontvangers)
      let projectId = m.project_id ?? null
      if (b.project_id !== undefined) {
        projectId = b.project_id ? String(b.project_id) : null
        if (projectId && !UUID.test(projectId)) return NextResponse.json({ error: 'Ongeldig project.' }, { status: 400 })
      }
      let clickupItemId = m.clickup_item_id ?? null
      if (b.clickup_item !== undefined) {
        clickupItemId = String(b.clickup_item ?? '').trim() ? clickupTaakIdUit(b.clickup_item) : null
        if (String(b.clickup_item ?? '').trim() && !clickupItemId) return NextResponse.json({ error: 'Geen geldig ClickUp-item. Plak de link of het taak-ID.' }, { status: 400 })
      }
      const koppeling = clientId !== (m.client_id ?? null) || projectId !== (m.project_id ?? null) || clickupItemId !== (m.clickup_item_id ?? null) || klantNaam !== m.klant_naam

      const w = wijzigingen(m, v.waarde)
      if (!w.iets && !koppeling) return antwoord({ ongewijzigd: true })
      m = await bewaarMeeting(admin, m.id, {
        titel: v.waarde.titel, beschrijving: v.waarde.beschrijving, starts_at: v.waarde.startsAt, ends_at: v.waarde.endsAt, tijdzone: v.waarde.tijdzone,
        klant_ontvangers: v.waarde.klant_ontvangers, deelnemers: v.waarde.deelnemers, herinnering_aan: v.waarde.herinnering_aan,
        client_id: clientId, klant_naam: klantNaam, project_id: projectId, clickup_item_id: clickupItemId,
      })
      // Zelfde Google-afspraak bijwerken (Meet-link blijft, genodigden krijgen de update); ClickUp volgt.
      if (w.tijd || w.inhoud || w.genodigden) m = await stapGoogle(admin, m, { bijwerken: true })
      if (w.tijd || w.inhoud || w.genodigden || koppeling) m = m.google_status === 'ok' ? await stapClickup(admin, m) : m
      let herinneringFout: string | null = null
      // Al verstuurd en enkel ontvangers gewijzigd of terug aangezet: geen tweede herinnering.
      const vorige = await laatsteHerinnering(admin, m.id)
      const alVerstuurd = vorige?.status === 'verzonden' || vorige?.status === 'bezig'
      if (w.tijd || ((w.ontvangers || w.herinnering) && (!alVerstuurd || !m.herinnering_aan))) {
        try { await planHerinnering(admin, m) } catch (e) { herinneringFout = safeMessage(e, 'meetings.herinnering') }
      }
      await audit('meeting.gewijzigd', { tijd: w.tijd, inhoud: w.inhoud, genodigden: w.genodigden, herinnering: w.herinnering, koppeling, google: m.google_status, clickup: m.clickup_status })
      const googleFout = (w.tijd || w.inhoud || w.genodigden) && m.google_status !== 'ok'
        ? `Bewaard in de app, maar Google Agenda is NIET bijgewerkt: ${m.google_fout ?? 'onbekende fout'}. Probeer de agenda-stap opnieuw.` : null
      return antwoord({ herinneringFout, googleFout })
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
        m = await vervolg(m)
      } else if (stap === 'clickup') {
        if (m.google_status !== 'ok') return NextResponse.json({ error: 'Eerst moet de afspraak in Google Agenda staan.' }, { status: 400 })
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

    if (actie === 'bevestiging_opnieuw') {
      if (m.bron !== 'klantboeking' || m.status !== 'ingepland') return NextResponse.json({ error: 'Enkel voor geplande klantboekingen.' }, { status: 400 })
      m = await bevestigingOpnieuw(admin, m)
      await audit('klantboeking.bevestiging_opnieuw', { status: m.bevestiging_status })
      if (m.bevestiging_status !== 'verzonden') return NextResponse.json({ error: `Versturen mislukt: ${m.bevestiging_fout ?? 'onbekende fout'}` }, { status: 400 })
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

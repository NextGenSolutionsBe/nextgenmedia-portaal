import { NextRequest, NextResponse } from 'next/server'
import { controleerConflicten } from '@/lib/meetings/kalender-server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { plannerRechten } from '@/lib/meetings/rechten'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { clickupTaakIdUit } from '@/lib/clickup'
import { valideerMeeting, naamZonderKlant, lijktOp } from '@/lib/meetings/model'
import {
  stapGoogle, stapClickup, planHerinnering, bestaatGoogleAfspraak, controleerKoppelingen, type MeetingRij, type HerinneringRij,
} from '@/lib/meetings/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Meetingplanner.
 *  GET                       → meetings met hun laatste herinnering
 *  GET ?opties=1             → klanten, contactpersonen, projecten en agenda's voor het planscherm
 *  GET ?koppelingen=<agenda> → werken Google, ClickUp en Resend? (leest enkel)
 *  POST                      → meeting inplannen (Google + Meet + uitnodiging, ClickUp, herinnering)
 * Toegang: module 'meetings' (middleware per HTTP-methode én hier nog eens).
 * Tokens en sleutels verlaten de server nooit.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const r = await plannerRechten()
    const persoon = r.persoon
    if (!persoon || !(r.meetings.bekijken || r.verkoop.bekijken)) return NextResponse.json({ error: 'Geen toegang tot de Meeting Inplanner' }, { status: 403 })
    const admin = createAdminSupabaseClient()

    const koppelAgenda = req.nextUrl.searchParams.get('koppelingen')
    if (koppelAgenda !== null) {
      return NextResponse.json({ checks: await controleerKoppelingen(admin, UUID.test(koppelAgenda) ? koppelAgenda : null) })
    }

    if (req.nextUrl.searchParams.get('opties')) {
      const [{ data: klanten }, { data: contacten }, { data: projecten }, { data: agendas }, { data: pipes }] = await Promise.all([
        admin.from('clients').select('id, company_name, contact_name, email').is('archived_at', null).order('company_name').limit(2000),
        admin.from('client_users').select('client_id, name, email').eq('active', true).limit(5000),
        admin.from('opdrachten').select('id, titel, client_id, klant_vrij, status').order('created_at', { ascending: false }).limit(500),
        admin.from('sales_calendar_connections').select('id, name, status, active, provider').eq('active', true).order('name'),
        admin.from('sales_pipelines').select('key, default_calendar_id'),
      ])
      const ngm = ((pipes ?? []) as { key: string; default_calendar_id: string | null }[]).find((p) => p.key === 'nextgenmedia')
      return NextResponse.json({
        klanten: klanten ?? [],
        contacten: contacten ?? [],
        projecten: ((projecten ?? []) as { id: string; titel: string; client_id: string | null; klant_vrij: string | null; status: string | null }[])
          .filter((p) => p.status !== 'geannuleerd'),
        agendas: ((agendas ?? []) as { id: string; name: string; status: string; provider: string }[])
          .filter((a) => a.provider === 'google')
          .map((a) => ({ id: a.id, naam: a.name, gekoppeld: a.status === 'connected' })),
        standaardAgenda: ngm?.default_calendar_id ?? null,
        ik: { naam: persoon.naam, email: persoon.email },
        rechten: {
          toevoegen: r.meetings.toevoegen,
          aanpassen: r.meetings.aanpassen || r.verkoop.aanpassen,
          meetings: r.meetings.bekijken,
          verkoop: r.verkoop.bekijken,
        },
      })
    }

    // Wie enkel Verkoop heeft, ziet de klantboekingen en de verkoopafspraken.
    let q = admin.from('klant_meetings').select('*').order('starts_at', { ascending: true }).limit(1000)
    if (!r.meetings.bekijken) q = q.eq('bron', 'klantboeking')
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const meetings = (data ?? []) as MeetingRij[]
    const herinneringen: Record<string, HerinneringRij> = {}
    if (meetings.length) {
      const { data: h } = await admin.from('klant_meeting_herinneringen').select('*')
        .in('meeting_id', meetings.map((m) => m.id)).order('created_at', { ascending: true })
      for (const x of (h ?? []) as HerinneringRij[]) if (x.meeting_id) herinneringen[x.meeting_id] = x // laatste wint
    }
    const afspraken = r.verkoop.bekijken ? await verkoopAfspraken(admin) : []
    return NextResponse.json({ meetings: meetings.map((m) => ({ ...m, herinnering: herinneringen[m.id] ?? null })), afspraken })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'meetings.GET') }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const rechten = await plannerRechten()
    const persoon = rechten.persoon
    if (!persoon || !rechten.meetings.toevoegen) return NextResponse.json({ error: 'Je mag geen meetings inplannen. Leads boek je via Calendar.' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()

    const sleutel = String(b.aanvraag_sleutel ?? '')
    if (!UUID.test(sleutel)) return NextResponse.json({ error: 'Ongeldige aanvraag. Ververs het scherm en probeer opnieuw.' }, { status: 400 })

    // Zelfde aanvraag opnieuw (dubbele klik, time-out): de bestaande meeting teruggeven.
    const { data: bestaand } = await admin.from('klant_meetings').select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
    if (bestaand) return NextResponse.json({ meeting: bestaand, herhaald: true })

    const v = valideerMeeting(b)
    if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
    const w = v.waarde

    // Klant is optioneel; een los e-mailadres volstaat.
    let klantNaam = naamZonderKlant(w.klant_ontvangers)
    let clientId: string | null = null
    if (b.client_id) {
      if (!UUID.test(String(b.client_id))) return NextResponse.json({ error: 'Ongeldige klant.' }, { status: 400 })
      const { data: klant } = await admin.from('clients').select('id, company_name, contact_name').eq('id', String(b.client_id)).maybeSingle()
      if (!klant) return NextResponse.json({ error: 'Klant niet gevonden.' }, { status: 404 })
      clientId = klant.id
      klantNaam = klant.company_name || klant.contact_name || klantNaam
    }
    let projectId: string | null = null
    if (b.project_id) {
      if (!UUID.test(String(b.project_id))) return NextResponse.json({ error: 'Ongeldig project.' }, { status: 400 })
      const { data: project } = await admin.from('opdrachten').select('id').eq('id', String(b.project_id)).maybeSingle()
      if (!project) return NextResponse.json({ error: 'Project niet gevonden.' }, { status: 404 })
      projectId = project.id
    }
    let clickupItemId: string | null = null
    if (String(b.clickup_item ?? '').trim()) {
      clickupItemId = clickupTaakIdUit(b.clickup_item)
      if (!clickupItemId) return NextResponse.json({ error: 'Geen geldig ClickUp-item. Plak de link of het taak-ID.' }, { status: 400 })
    }

    const agendaId = String(b.agenda_id ?? '')
    if (!UUID.test(agendaId)) return NextResponse.json({ error: 'Kies de Google-agenda waarin de meeting komt.' }, { status: 400 })
    const { data: agenda } = await admin.from('sales_calendar_connections').select('id, name, status, active, signature_email').eq('id', agendaId).maybeSingle()
    if (!agenda || agenda.active === false) return NextResponse.json({ error: 'Deze agenda bestaat niet (meer).' }, { status: 400 })
    if (agenda.status !== 'connected') return NextResponse.json({ error: `De Google-koppeling van "${agenda.name}" is verlopen. Koppel ze opnieuw via Verkoop → Agenda. Er is niets ingepland.` }, { status: 400 })

    // Herhaalde aanvraag na herladen (nieuwe sleutel)? Eerst kijken of ze al bestaat.
    if (b.toch_inplannen !== true) {
      const { data: zelfdeStart } = await admin.from('klant_meetings').select('*').eq('status', 'ingepland').eq('starts_at', w.startsAt)
      const dubbel = ((zelfdeStart ?? []) as MeetingRij[]).find((m) => lijktOp(m, w))
      if (dubbel) return NextResponse.json({ error: 'Deze meeting staat al ingepland (zelfde titel, tijd en genodigde).', bestaand: dubbel }, { status: 409 })
    }

    // Gepland vanuit Calendar: vlak vóór het opslaan nagaan of er intussen iets
    // overlapt. Intern mag elk tijdstip, dus dit is een waarschuwing: wie ze
    // gezien heeft, bevestigt met toch_conflict.
    if (b.controleer_vrij === true && b.toch_conflict !== true) {
      const c = await controleerConflicten(admin, { agendaId: agenda.id, start: Date.parse(w.startsAt), eind: Date.parse(w.endsAt) })
      if (c.lijst.length || !c.betrouwbaar) {
        return NextResponse.json({
          error: c.lijst.length ? 'Er staat al iets in de agenda op dit moment.' : `Conflicten konden niet gecontroleerd worden: ${c.fout}`,
          conflict: true, conflicten: c.lijst, betrouwbaar: c.betrouwbaar,
        }, { status: 409 })
      }
    }

    const organisator = String(b.organisator_naam ?? '').trim().slice(0, 120) || String(agenda.name ?? '').split(/\s+[—-]\s+/)[0] || null
    const rij: Record<string, unknown> = {
      aanvraag_sleutel: sleutel, client_id: clientId, klant_naam: klantNaam, project_id: projectId, clickup_item_id: clickupItemId,
      titel: w.titel, beschrijving: w.beschrijving, starts_at: w.startsAt, ends_at: w.endsAt, tijdzone: w.tijdzone,
      agenda_id: agenda.id, organisator_naam: organisator, organisator_email: agenda.signature_email || null,
      klant_ontvangers: w.klant_ontvangers, deelnemers: w.deelnemers, herinnering_aan: w.herinnering_aan,
      created_by: user.id, created_by_email: persoon.email,
    }
    let ins: { data: unknown; error: { message: string } | null } = { data: null, error: null }
    for (let i = 0; i < 6; i++) {
      ins = await admin.from('klant_meetings').insert(rij).select('*').single()
      const kol = ins.error?.message.match(/Could not find the '([^']+)' column/)?.[1]
      if (kol && kol in rij) { delete rij[kol]; continue }
      break
    }
    if (ins.error) {
      if (/duplicate|unique|23505/i.test(ins.error.message)) {
        const { data: dubbel } = await admin.from('klant_meetings').select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
        if (dubbel) return NextResponse.json({ meeting: dubbel, herhaald: true })
      }
      throw new Error(ins.error.message)
    }

    let m = ins.data as MeetingRij
    m = await stapGoogle(admin, m)
    if (m.google_status !== 'ok') {
      // Zoals de afsprakentool: zonder Google-afspraak is de meeting niet ingepland.
      const staat = await bestaatGoogleAfspraak(admin, m)
      if (staat === 'ja') m = await stapGoogle(admin, m)
      if (m.google_status !== 'ok') {
        const reden = m.google_fout ?? 'onbekende fout'
        if (staat === 'nee') {
          await admin.from('klant_meetings').delete().eq('id', m.id)
          return NextResponse.json({ error: `De meeting is niet ingepland: ${reden} Er is geen uitnodiging verstuurd.` }, { status: 502 })
        }
        return NextResponse.json({
          error: `Onduidelijk of Google de afspraak aanmaakte (${reden}). De meeting staat bij Komend met "Agenda mislukt"; probeer daar opnieuw. Er komt nooit een tweede afspraak.`,
          meeting: m,
        }, { status: 502 })
      }
    }
    m = await stapClickup(admin, m)
    let herinnering: HerinneringRij | null = null
    let herinneringFout: string | null = null
    try { herinnering = await planHerinnering(admin, m) } catch (e) { herinneringFout = safeMessage(e, 'meetings.herinnering') }

    const { ip, userAgent } = requestMeta(req)
    await logAudit({
      action: 'meeting.ingepland', entityType: 'klant_meeting', entityId: m.id, actorUserId: user.id, actorEmail: persoon.email,
      summary: `${m.klant_naam}: ${m.titel}`, ip, userAgent,
      metadata: { starts_at: m.starts_at, tijdzone: m.tijdzone, klant: !!clientId, google: m.google_status, clickup: m.clickup_status, herinnering: herinnering?.gepland_voor ?? null },
    })
    return NextResponse.json({ meeting: { ...m, herinnering }, herinneringFout })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'meetings.POST') }, { status: 500 })
  }
}

/**
 * De verkoopafspraken (Appointment setting) voor het overzicht: alles wat nog
 * komt en de laatste 60 dagen. Enkel lezen; bewerken gebeurt in de
 * Calendar met de bestaande regels. Ook hun herinnering staat erbij.
 */
async function verkoopAfspraken(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const sinds = new Date(Date.now() - 60 * 86400000).toISOString()
  const { data } = await admin.from('sales_appointments')
    .select('id, starts_at, ends_at, status, titel, attendee_email, meet_url, external_event_id, clickup_task_id, calendar_id, pipeline_id, lead_id, outcome, adres, sales_leads ( sales_companies ( name ), sales_contacts ( name ) )')
    .gte('ends_at', sinds).order('starts_at', { ascending: true }).limit(500)
  const rijen = (data ?? []) as unknown as {
    id: string; starts_at: string; ends_at: string; status: string; titel: string | null; attendee_email: string | null; meet_url: string | null
    external_event_id: string | null; clickup_task_id: string | null; calendar_id: string | null; pipeline_id: string | null; lead_id: string | null
    outcome: string | null; adres: string | null
    sales_leads?: { sales_companies?: { name?: string } | null; sales_contacts?: { name?: string } | null } | null
  }[]
  const herinneringen: Record<string, HerinneringRij> = {}
  if (rijen.length) {
    const { data: h } = await admin.from('klant_meeting_herinneringen').select('*').in('afspraak_id', rijen.map((a) => a.id)).order('created_at', { ascending: true })
    for (const x of (h ?? []) as (HerinneringRij & { afspraak_id: string })[]) herinneringen[x.afspraak_id] = x
  }
  return rijen.map((a) => ({
    id: a.id, starts_at: a.starts_at, ends_at: a.ends_at, status: a.status, titel: a.titel, attendee_email: a.attendee_email,
    meet_url: a.meet_url, in_google: !!a.external_event_id, clickup_task_id: a.clickup_task_id, calendar_id: a.calendar_id,
    pipeline_id: a.pipeline_id, lead_id: a.lead_id, outcome: a.outcome, adres: a.adres,
    bedrijf: a.sales_leads?.sales_companies?.name ?? null, contact: a.sales_leads?.sales_contacts?.name ?? null,
    herinnering: herinneringen[a.id] ?? null,
  }))
}

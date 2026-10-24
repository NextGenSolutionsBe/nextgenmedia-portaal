import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { DATABANK_TIJDELIJK } from '@/lib/supabase/herkansing'
import { controleerKoppelingen, testAfspraak, leesMeeting, veiligeFout } from '@/lib/meetings/server'
import { cronToegang } from '@/lib/meetings/cron-toegang'
import { haalMeetingEvent } from '@/lib/sales/google-calendar'
import {
  berekenVrijeSlots, boekKlantmeeting, meetingVoorToken, verplaatsViaLink, annuleerViaLink, BoekingFout,
} from '@/lib/meetings/klantboeking-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Controle van de koppelingen achter de Meeting Inplanner, met hetzelfde
 * geheim als de scheduler.
 *  · standaard: leest enkel (Google-agenda, ClickUp-lijst, Resend)
 *  · ?schrijftest=1: afspraak ZONDER genodigden met Meet-link, meteen stil weg
 *  · ?zelftest=klantboeking: één volledige testboeking zoals een klant ze doet
 *    (op het verste vrije moment, naar info@nextgenmedia.be), daarna verplaatst
 *    en geannuleerd via de beheerlink. Echte Google-, ClickUp- en mailstappen.
 * Er komt nooit een token of sleutel in het antwoord.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TEST_ADRES = 'info@nextgenmedia.be'

export async function POST(req: NextRequest) {
  const toegang = await cronToegang(req)
  if (toegang === 'onbereikbaar') return NextResponse.json({ error: DATABANK_TIJDELIJK }, { status: 503 })
  if (toegang === 'nee') return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const admin = createAdminSupabaseClient()
  try {
    if (req.nextUrl.searchParams.get('zelftest') === 'klantboeking') return NextResponse.json(await zelftestKlantboeking(admin))
    let agenda = req.nextUrl.searchParams.get('agenda')
    if (!agenda || !UUID.test(agenda)) {
      const { data } = await admin.from('sales_pipelines').select('default_calendar_id').eq('key', 'nextgenmedia').maybeSingle()
      agenda = (data?.default_calendar_id as string | null) ?? null
    }
    const checks = await controleerKoppelingen(admin, agenda)
    const schrijftest = req.nextUrl.searchParams.get('schrijftest') === '1' && agenda ? await testAfspraak(agenda) : null
    return NextResponse.json({ agenda, checks, schrijftest })
  } catch (e) {
    console.error('[cron:klantmeetings:diagnose]', e)
    return NextResponse.json({ error: 'Controle mislukt', detail: veiligeFout(e) }, { status: 500 })
  }
}

export const GET = POST

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function zelftestKlantboeking(admin: { from: (t: string) => any }) {
  const stappen: { stap: string; ok: boolean; detail?: string }[] = []
  const log = (stap: string, ok: boolean, detail?: string) => { stappen.push({ stap, ok, ...(detail ? { detail } : {}) }) }
  let id: string | null = null
  try {
    const b = await berekenVrijeSlots(admin, { vers: true })
    log('Beschikbaarheid (werkuren + Google + ClickUp + app)', b.slots.length > 1, `${b.slots.length} vrije momenten`)
    if (b.slots.length < 2) return { stappen }
    const [tweede, laatste] = [b.slots[b.slots.length - 2], b.slots[b.slots.length - 1]]

    const r = await boekKlantmeeting(admin, {
      aanvraag_sleutel: randomUUID(), naam: 'Test Meeting Inplanner', email: TEST_ADRES, bedrijf: 'NextGenMedia (test)',
      reden: 'Automatische controle van de Meeting Inplanner. Wordt meteen geannuleerd.', start: laatste,
    })
    id = r.id
    log('Boeken', true, `Gepland op ${r.startsAt}`)
    let m = (await leesMeeting(admin, r.id))!
    log('Google-afspraak', m.google_status === 'ok', m.google_fout ?? undefined)
    log('Echte Meet-link', !!m.meet_url && /^https:\/\/meet\.google\.com\//.test(m.meet_url), m.meet_url ? 'meet.google.com/…' : 'ontbreekt')
    if (m.agenda_id && m.google_calendar_id && m.google_event_id) {
      const ev = await haalMeetingEvent(m.agenda_id, m.google_calendar_id, m.google_event_id)
      log('Uitnodiging (genodigde staat op de afspraak in Google)', !!ev?.genodigden.some((g) => g.email === TEST_ADRES))
    }
    log('ClickUp-taak (bestaande werkwijze)', m.clickup_status === 'ok', m.clickup_fout ?? undefined)
    const { data: h } = await admin.from('klant_meeting_herinneringen').select('status, moment').eq('meeting_id', m.id).eq('status', 'gepland')
    log('Herinnering 24 uur vooraf gepland', ((h ?? []) as { moment: string }[]).some((x) => x.moment === '24u'))
    log('Bevestigingsmail', m.bevestiging_status === 'verzonden', m.bevestiging_fout ?? undefined)

    const token = r.beheerUrl?.split('#t=')[1] ?? ''
    const viaLink = await meetingVoorToken(admin, token)
    log('Beheerlink vindt enkel deze boeking', viaLink?.id === m.id)
    m = await verplaatsViaLink(admin, viaLink!, token, tweede)
    const ev2 = m.agenda_id && m.google_calendar_id && m.google_event_id ? await haalMeetingEvent(m.agenda_id, m.google_calendar_id, m.google_event_id) : null
    log('Verplaatsen: zelfde Google-afspraak bijgewerkt, Meet-link blijft', new Date(m.starts_at).toISOString() === new Date(tweede).toISOString() && !!ev2 && ev2.meetUrl === m.meet_url)
    m = await annuleerViaLink(admin, m)
    const { data: h2 } = await admin.from('klant_meeting_herinneringen').select('status').eq('meeting_id', m.id).eq('status', 'gepland')
    log('Annuleren: Google, ClickUp en herinnering', m.status === 'geannuleerd' && m.google_status === 'geannuleerd' && m.clickup_status === 'ok' && (h2 ?? []).length === 0,
      `google=${m.google_status}, clickup=${m.clickup_status}`)
    return { stappen, meetingId: m.id }
  } catch (e) {
    log('Onverwachte fout', false, e instanceof BoekingFout ? `${e.publiek}${e.intern ? ` (${e.intern})` : ''}` : veiligeFout(e))
    // Niets laten slingeren: een half geboekte test wordt alsnog geannuleerd.
    if (id) {
      try {
        const m = await leesMeeting(admin, id)
        if (m && m.status === 'ingepland') { await annuleerViaLink(admin, m); log('Opruimen na fout', true) }
      } catch (x) { log('Opruimen na fout', false, veiligeFout(x)) }
    }
    return { stappen, meetingId: id }
  }
}

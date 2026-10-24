import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { DATABANK_TIJDELIJK } from '@/lib/supabase/herkansing'
import { controleerKoppelingen, testAfspraak, leesMeeting, veiligeFout } from '@/lib/meetings/server'
import { cronToegang } from '@/lib/meetings/cron-toegang'
import { haalMeetingEvent, bezetPerAgenda } from '@/lib/sales/google-calendar'
import { getOrCreateSalesOrg, listOwners, loadCalendar } from '@/lib/sales/service'
import { haalSyncTaken, clickupTijdvelden, type SyncOphaalInfo } from '@/lib/clickup'
import { mergeIntervals, type Interval } from '@/lib/sales/availability'
import { dag, uur, zoneNaarIso } from '@/lib/meetings/model'
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
 *  · ?kalender=1: leest enkel. Per agenda de werkuren, bezette blokken (per
 *    Google-agenda, zonder titels) en vrije segmenten voor twee weken, plus
 *    hoe de ClickUp-taken binnenkomen (pagina's, tijdvelden).
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
    if (req.nextUrl.searchParams.get('kalender') === '1') return NextResponse.json(await kalenderDiagnose(req.nextUrl.searchParams.get('taken')))
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


/** Per dag (Brussel) de stukken als "HH:MM–HH:MM", enkel tussen 7 en 21 uur. */
function perDagTekst(lijst: Interval[], van: number, tot: number): Record<string, string[]> {
  const uit: Record<string, string[]> = {}
  for (const i of mergeIntervals(lijst)) {
    const s = Math.max(i.start, van), e = Math.min(i.end, tot)
    if (e <= s) continue
    // Opknippen per dag.
    let c = s
    while (c < e) {
      const d = dag(new Date(c).toISOString())
      const volgende = new Date(zoneNaarIso(new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10), '00:00')).getTime()
      const eind = Math.min(e, volgende)
      ;(uit[d] ??= []).push(`${uur(new Date(c).toISOString())}–${eind === volgende ? '24:00' : uur(new Date(eind).toISOString())}`)
      c = eind
    }
  }
  return uit
}

async function kalenderDiagnose(takenParam: string | null) {
  const nu = Date.now()
  const vandaag = dag(new Date(nu).toISOString())
  const wd = (new Date(`${vandaag}T12:00:00Z`).getUTCDay() + 6) % 7
  const maandag = new Date(Date.parse(`${vandaag}T12:00:00Z`) - wd * 86400000).toISOString().slice(0, 10)
  const van = new Date(zoneNaarIso(maandag, '00:00')).getTime()
  const tot = van + 14 * 86400000

  const org = await getOrCreateSalesOrg()
  const owners = await listOwners(org.id)
  const agendas = []
  for (const o of owners) {
    const cal = await loadCalendar(org.id, van, tot, o.id).catch((e) => ({ fout: veiligeFout(e) }) as const)
    const bezet = await bezetPerAgenda(o.id, van, tot).catch((e) => ({ schrijfAgenda: null, agendas: {}, fout: veiligeFout(e) }))
    agendas.push({
      id: o.id, naam: o.name, status: o.status,
      clickup: (o as { clickup_assignee_id?: number | null }).clickup_assignee_id ?? null,
      schrijfAgenda: bezet.schrijfAgenda ? bezet.schrijfAgenda.slice(0, 12) : null,
      bezetFout: bezet.fout ?? null,
      bezetPerAgenda: Object.fromEntries(Object.entries(bezet.agendas).map(([id, a]) => [id.slice(0, 12), { fout: a.fout ?? null, perDag: perDagTekst(a.busy, van, tot) }])),
      vrij: !cal ? { fout: 'geen agenda' } : 'fout' in cal ? { fout: cal.fout } : { connected: cal.connected, perDag: perDagTekst(cal.segments, van, tot), afspraken: cal.appointments.length },
    })
  }

  const info: SyncOphaalInfo = { paginas: 0, perPagina: [], laatstePaginaGemeld: false }
  let sync: Record<string, unknown>
  try {
    const taken = await haalSyncTaken([200511713, 106693123], nu - 86400000, nu + 60 * 86400000, info)
    const metStartEnUur = taken.filter((t) => t.startMs !== null)
    sync = {
      info, totaal: taken.length,
      bram: taken.filter((t) => t.assigneeIds.includes(200511713)).length,
      marco: taken.filter((t) => t.assigneeIds.includes(106693123)).length,
      metStart: metStartEnUur.length,
      vlaggenAanwezig: taken.some((t) => t.startHeeftUur !== null || t.dueHeeftUur !== null),
    }
  } catch (e) {
    sync = { info, fout: veiligeFout(e) }
  }
  const ids = (takenParam ?? '').split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{5,40}$/.test(x))
  const tijdvelden = ids.length ? await clickupTijdvelden(ids) : null
  return { van: new Date(van).toISOString(), tot: new Date(tot).toISOString(), regelsOrg: org.timezone, agendas, sync, tijdvelden }
}

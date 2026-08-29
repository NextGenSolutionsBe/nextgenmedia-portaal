import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import {
  sendEmail,
  sendEmailMetAfzenderTerugval, cancelScheduledEmail, baseUrl, SCHEDULE_HORIZON_MS, RESTRICTED_KEY_HINT,
  resendKeyFor,
} from '@/lib/email'
import { listPipelines, defaultFromFor, type SalesPipeline } from '@/lib/sales/pipelines'
import { matchSignature } from '@/lib/sales/signatures'

// Herinneringsmail naar de prospect vóór een geboekte afspraak (§8).
//
// Wanneer gaat hij uit?
//   • normaal: 24 uur voor de afspraak — dus de dag ervoor, op hetzelfde uur;
//   • is er bij het boeken minder dan 24 uur te gaan, dan een kwartier na het
//     inboeken. Dat kwartier is er om nog te kunnen ingrijpen als er iets fout
//     geboekt is.
//
// HOE het op tijd vertrekt: we PLANNEN de mail bij Resend in op precies dat
// moment (die houdt hem tot 72 uur vast). Er hoeft dus geen cron elk kwartier
// te draaien — dat kan ook niet op een Vercel Hobby-plan, waar één cron per dag
// het maximum is. De dagelijkse cron is enkel een vangnet voor afspraken die
// verder dan 72 uur vooruit geboekt zijn.
//
// Wordt de afspraak geannuleerd of verplaatst, dan halen we de ingeplande mail
// weer weg. Een herinnering voor een afgezegde afspraak is erger dan geen.
//
// Per afspraak gaat dit maximaal één keer uit; dat wordt afgedwongen met een
// unieke index, niet met een tijdvenstertruc. De rij in
// sales_appointment_reminders is meteen de rem: bestaat hij, dan wordt er niets
// opnieuw ingepland — ook niet nadat iemand de mail handmatig geannuleerd heeft.

export type ReminderResult = { checked: number; sent: number; skipped: number; errors: string[] }

const LAST_MINUTE_DELAY_MS = 15 * 60 * 1000

type ApptRow = {
  id: string; starts_at: string; created_at: string; status: string
  attendee_email: string | null
  pipeline_id: string | null; calendar_id: string | null
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Alleen het uur, in de tijdzone van de afspraak. */
function hourText(startsAt: string, tz: string): string {
  return new Date(startsAt).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: tz })
}

/** Zelfde kalenderdag in die tijdzone? Bepaalt "vandaag" of "morgen". */
function sameDay(a: Date, b: Date, tz: string): boolean {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  return f.format(a) === f.format(b)
}

/**
 * Wanneer moet deze herinnering de deur uit?
 * Geëxporteerd omdat dit de enige echte regel in dit bestand is en apart
 * getest hoort te kunnen worden.
 */
export function dueAt(startsAtMs: number, createdAtMs: number): number {
  const dayBefore = startsAtMs - 24 * 3600 * 1000
  // Al binnen het etmaal geboekt → een kwartier na het inboeken.
  return dayBefore <= createdAtMs ? createdAtMs + LAST_MINUTE_DELAY_MS : dayBefore
}

/**
 * De mailtekst. Bewust exact zoals afgesproken, enkel uur en dag ingevuld.
 * Onder "Met vriendelijke groeten" komt niets dan de handtekening-afbeelding —
 * geen naam, geen telefoon, geen e-mailadres.
 */
export function reminderBody(opts: { hour: string; today: boolean }): string[] {
  return [
    'Hey!',
    '',
    `${opts.today ? 'Vandaag' : 'Morgen'} om ${opts.hour} zien we elkaar. We kijken er naar uit!`,
    '',
    'Ik kom vooral luisteren naar wat jullie doen, hoe het loopt en waar jullie naartoe willen. ' +
      'Van daaruit zien we of we iets voor jullie kunnen betekenen.',
    '',
    'In bijlage stuur ik alvast een korte uitleg mee over ons. Wie we zijn, wat we doen en wat jij ' +
      'eruit kan halen. Zo weet je op voorhand met wie je aan tafel zit.',
    '',
    `Tot ${opts.today ? 'straks' : 'morgen'}!`,
    '',
    'Met vriendelijke groeten',
  ]
}

export type SignatureInfo = { imageUrl: string | null; name: string | null; phone: string | null; email: string | null }

/**
 * De mail als HTML, met onder de groet enkel de handtekening-afbeelding van de
 * persoon in wiens agenda de afspraak staat.
 *
 * De `alt` van die afbeelding draagt de naam, zodat een mailprogramma dat
 * beelden blokkeert nog altijd toont van wie de mail komt.
 */
export function reminderHtml(lines: string[], sig: SignatureInfo): string {
  const body = lines.map((l) => (l === '' ? '<br>' : `<div>${escapeHtml(l)}</div>`)).join('')

  const imgHtml = sig.imageUrl
    ? `<div style="margin-top:14px"><img src="${escapeHtml(sig.imageUrl)}" width="400" alt="${
        escapeHtml(sig.name ?? 'NextGenMedia')
      }" style="display:block;width:400px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none"></div>`
    : ''

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#111">${
    body}${imgHtml}</div>`
}

/** Brochure als bijlage. Relatief pad wordt hier pas een volledige URL. */
function attachmentFor(p: SalesPipeline): { filename: string; path: string }[] {
  if (!p.brochure_url) return []
  const url = p.brochure_url.startsWith('http') ? p.brochure_url : `${baseUrl()}${p.brochure_url}`
  return [{ filename: p.brochure_filename || 'Kennismaking.pdf', path: url }]
}

type Built = {
  appt: ApptRow
  startsMs: number
  due: number
  /** Sleutel van het merk; intrekken moet met dezelfde sleutel gebeuren. */
  apiKey: string | undefined
  to: string
  subject: string
  text: string
  html: string
  from: string | null
  replyTo: string | null
  attachments: { filename: string; path: string }[]
}

/**
 * Alles wat nodig is om de mail te versturen, klaargemaakt voor één afspraak.
 * `sendAtMs` bepaalt de aanhef ("vandaag" of "morgen") — bij het verplaatsen
 * van het verzendmoment moet die mee veranderen.
 */
async function buildReminder(
  appointmentId: string, sendAtMs?: number,
): Promise<{ ok: true; built: Built } | { ok: false; reason: string }> {
  const admin = createAdminSupabaseClient()

  const { data } = await admin.from('sales_appointments')
    .select('id, starts_at, created_at, status, attendee_email, pipeline_id, calendar_id')
    .eq('id', appointmentId).maybeSingle()
  const a = data as ApptRow | null
  if (!a) return { ok: false, reason: 'Afspraak niet gevonden' }
  if (a.status !== 'scheduled') return { ok: false, reason: 'Afspraak is niet meer ingepland' }
  if (!a.attendee_email) return { ok: false, reason: 'Geen e-mailadres bij deze afspraak' }

  const pipelines = await listPipelines()
  const pipeline = pipelines.find((p) => p.id === a.pipeline_id)
  // Zonder merk weten we niet welke brochure erbij hoort. Dan liever niets
  // sturen dan de verkeerde one-pager.
  if (!pipeline) return { ok: false, reason: 'Geen merk gekoppeld aan deze afspraak' }
  if (!pipeline.reminder_enabled) return { ok: false, reason: `Herinneringen staan uit voor ${pipeline.name}` }

  const startsMs = new Date(a.starts_at).getTime()
  const due = sendAtMs ?? dueAt(startsMs, new Date(a.created_at).getTime())
  if (due >= startsMs) return { ok: false, reason: 'Het verzendmoment ligt ná de afspraak' }

  const { data: org } = await admin.from('sales_clients')
    .select('timezone').order('created_at', { ascending: true }).limit(1).maybeSingle()
  const tz = (org as { timezone?: string } | null)?.timezone ?? 'Europe/Brussels'

  const { data: ownerRow } = a.calendar_id
    ? await admin.from('sales_calendar_connections').select('*').eq('id', a.calendar_id).maybeSingle()
    : { data: null }
  const owner = ownerRow as {
    name?: string | null; account_email?: string | null
    signature_image_url?: string | null; signature_phone?: string | null; signature_email?: string | null
  } | null

  // Niets ingesteld? Dan zoeken we de handtekening bij de naam van de agenda.
  const fallback = matchSignature(owner?.name)
  const rawImage = owner?.signature_image_url || fallback?.url || null
  const sig: SignatureInfo = {
    name: owner?.name ?? fallback?.label ?? null,
    imageUrl: rawImage ? (rawImage.startsWith('http') ? rawImage : `${baseUrl()}${rawImage}`) : null,
    phone: owner?.signature_phone || fallback?.phone || null,
    email: owner?.signature_email || fallback?.email || owner?.account_email || null,
  }

  const hour = hourText(a.starts_at, tz)
  const today = sameDay(new Date(a.starts_at), new Date(Math.max(due, Date.now())), tz)
  const lines = reminderBody({ hour, today })

  return {
    ok: true,
    built: {
      appt: a, startsMs, due,
      apiKey: resendKeyFor(pipeline.key),
      to: a.attendee_email,
      subject: today ? `Tot straks om ${hour}` : `Tot morgen om ${hour}`,
      text: lines.join('\n'),
      html: reminderHtml(lines, sig),
      // Niets ingesteld? Dan het vaste adres van dit merk — zo vertrekt alles
      // van NextGenSolutions hoe dan ook vanaf info@nextgensolutions.be, ook
      // als het veld in de database leeg gebleven is.
      from: pipeline.reminder_from || defaultFromFor(pipeline.key),
      replyTo: pipeline.reminder_reply_to,
      attachments: attachmentFor(pipeline),
    },
  }
}

/**
 * De sleutel van het merk waar deze afspraak bij hoort. Nodig om een al
 * ingeplande mail te kunnen intrekken: dat moet met dezelfde sleutel als
 * waarmee hij verstuurd is.
 */
async function apiKeyForAppointment(appointmentId: string): Promise<string | undefined> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin.from('sales_appointments')
    .select('pipeline_id').eq('id', appointmentId).maybeSingle()
  const pipelineId = (data as { pipeline_id?: string | null } | null)?.pipeline_id ?? null
  const pipelines = await listPipelines()
  return resendKeyFor(pipelines.find((p) => p.id === pipelineId)?.key)
}

/**
 * De rij in sales_appointment_reminders wegschrijven.
 *
 * DIT IS DE SLEUTEL TEGEN DUBBELE MAILS: het bestaan van de rij is wat
 * verhindert dat het dagelijkse vangnet dezelfde herinnering nog eens
 * inplant. Mislukt het wegschrijven — bijvoorbeeld omdat een kolom uit een
 * latere migratie nog niet bestaat — dan laten we de extra kolommen vallen en
 * proberen we opnieuw, tot desnoods enkel appointment_id overblijft. Liever een
 * kale rij dan géén rij.
 *
 * Geeft false terug als er echt niets weggeschreven raakte; de aanroeper moet
 * dan ingrijpen, want anders vertrekt deze mail nog eens.
 */
async function saveReminderRow(
  payload: Record<string, unknown>, existingId?: string,
): Promise<boolean> {
  const admin = createAdminSupabaseClient()
  const working = { ...payload }
  const optional = ['cancelled_by', 'cancelled_at', 'scheduled_for', 'resend_id', 'kind', 'days_before']

  for (let attempt = 0; attempt < optional.length + 1; attempt++) {
    const { error } = existingId
      ? await admin.from('sales_appointment_reminders').update(working).eq('id', existingId)
      : await admin.from('sales_appointment_reminders').insert(working)
    if (!error) return true

    const msg = error.message ?? ''
    // Kolom bestaat niet → laten vallen en opnieuw. Elke andere fout is echt.
    const missing = optional.find((c) => c in working && msg.includes(c))
    const schemaIssue = /PGRST204|schema cache|does not exist|could not find/i.test(msg)
    if (!missing || !schemaIssue) {
      console.error('[reminders] wegschrijven mislukt', error)
      return false
    }
    delete working[missing]
  }
  return false
}

type ScheduleOutcome = 'scheduled' | 'skipped' | 'too_far' | 'error'
export type ScheduleReport = { outcome: ScheduleOutcome; error?: string }

/**
 * Plant de herinnering voor één afspraak in bij Resend.
 * Idempotent: staat er al een rij voor deze afspraak, dan gebeurt er niets —
 * ook niet als die rij een handmatige annulering is. Ligt het verzendmoment
 * verder dan 72 uur weg, dan doen we nog niets; de dagelijkse cron pikt hem op.
 */
export async function scheduleReminderFor(
  appointmentId: string, now = new Date(),
): Promise<ScheduleReport> {
  const admin = createAdminSupabaseClient()

  const { data: existing } = await admin.from('sales_appointment_reminders')
    .select('id').eq('appointment_id', appointmentId).maybeSingle()
  if (existing) return { outcome: 'skipped' }

  const b = await buildReminder(appointmentId)
  // De reden meegeven: stil overslaan is precies waardoor je later niet meer
  // weet waarom er geen mail klaarstaat.
  if (!b.ok) return { outcome: 'skipped', error: b.reason }
  const { built } = b
  if (built.due - now.getTime() > SCHEDULE_HORIZON_MS) return { outcome: 'too_far' }

  const res = await sendEmailMetAfzenderTerugval({
    to: built.to, subject: built.subject, text: built.text, html: built.html,
    from: built.from, replyTo: built.replyTo, attachments: built.attachments,
    apiKey: built.apiKey,
    // In het verleden inplannen mag niet; dan meteen versturen.
    scheduledAt: built.due > now.getTime() ? new Date(built.due).toISOString() : null,
  })
  if (!res.ok) return { outcome: 'error', error: res.error }

  // Pas ná een geslaagde inplanning vastleggen, zodat een mislukte poging
  // morgen opnieuw geprobeerd wordt.
  const saved = await saveReminderRow({
    appointment_id: appointmentId, days_before: 1, kind: 'day_before',
    resend_id: res.id ?? null, scheduled_for: new Date(built.due).toISOString(),
  })
  if (!saved) {
    // Kunnen we niet vastleggen dát hij klaarstaat, dan kunnen we ook niet
    // garanderen dat hij maar één keer vertrekt. Dan liever intrekken.
    if (res.id) await cancelScheduledEmail(res.id, built.apiKey)
    return { outcome: 'error', error: 'De herinnering kon niet vastgelegd worden en is daarom ingetrokken.' }
  }
  return { outcome: 'scheduled' }
}

/**
 * Herinnering weer intrekken — bij annuleren of verplaatsen van de AFSPRAAK.
 * De rij verdwijnt ook, zodat een verplaatste afspraak opnieuw ingepland kan
 * worden. Voor een handmatige annulering is er cancelReminderManually().
 */
export async function cancelReminderFor(appointmentId: string): Promise<{ wasSent: boolean }> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin.from('sales_appointment_reminders')
    .select('id, resend_id, cancelled_at').eq('appointment_id', appointmentId).maybeSingle()
  const row = data as { id: string; resend_id: string | null; cancelled_at: string | null } | null
  if (!row) return { wasSent: false }

  // Handmatig tegengehouden blijft tegengehouden: die rij laten we staan.
  if (row.cancelled_at) return { wasSent: false }

  if (row.resend_id) {
    const res = await cancelScheduledEmail(row.resend_id, await apiKeyForAppointment(appointmentId))
    if (!res.ok) {
      /**
       * Intrekken lukte niet — vrijwel altijd omdat de mail al vertrokken is.
       * De rij blijft dan staan, zodat er GEEN tweede herinnering ingepland
       * wordt. Eén mail te vroeg is vervelend; twee mails met verschillende
       * uren erin is erger, want dan weet de prospect niet meer wanneer de
       * afspraak is.
       */
      return { wasSent: true }
    }
  }
  await admin.from('sales_appointment_reminders').delete().eq('id', row.id)
  return { wasSent: false }
}

// ── Handmatig ingrijpen vanuit het overzicht ────────────────────────────────

export type ActionResult = { ok: true; message: string } | { ok: false; error: string }

/**
 * Deze mail gaat niet uit. De rij blijft staan met cancelled_at ingevuld: dat
 * is precies wat verhindert dat het vangnet hem morgen opnieuw inplant.
 */
export async function cancelReminderManually(appointmentId: string, actorId?: string): Promise<ActionResult> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin.from('sales_appointment_reminders')
    .select('id, resend_id, cancelled_at').eq('appointment_id', appointmentId).maybeSingle()
  const row = data as { id: string; resend_id: string | null; cancelled_at: string | null } | null

  if (row?.cancelled_at) return { ok: true, message: 'Deze mail stond al geannuleerd.' }

  if (row?.resend_id) {
    const res = await cancelScheduledEmail(row.resend_id, await apiKeyForAppointment(appointmentId))
    // Al vertrokken? Dan valt er niets meer tegen te houden; dat moet je weten.
    // We doen bewust NIET alsof het gelukt is: de mail staat bij Resend klaar en
    // vertrekt hoe dan ook, wat onze eigen administratie ook beweert.
    if (!res.ok) {
      const why = res.error ?? 'onbekende fout'
      return { ok: false, error: why === RESTRICTED_KEY_HINT ? why : `Tegenhouden lukte niet: ${why}` }
    }
  }

  if (row) {
    await admin.from('sales_appointment_reminders')
      .update({ cancelled_at: new Date().toISOString(), cancelled_by: actorId ?? null }).eq('id', row.id)
  } else {
    // Nog niet ingepland: een lege rij plaatsen houdt het vangnet tegen.
    const saved = await saveReminderRow({
      appointment_id: appointmentId, days_before: 1, kind: 'day_before',
      cancelled_at: new Date().toISOString(), cancelled_by: actorId ?? null,
    })
    if (!saved) return { ok: false, error: 'Kon niet vastleggen dat deze mail tegengehouden is.' }
  }
  return { ok: true, message: 'De mail gaat niet uit.' }
}

/**
 * Verzendmoment wijzigen of meteen versturen (`at` in het verleden of nu).
 * De oude ingeplande mail wordt eerst ingetrokken; anders zouden er twee
 * vertrekken.
 */
export async function rescheduleReminder(
  appointmentId: string, atMs: number, actorId?: string,
): Promise<ActionResult> {
  const admin = createAdminSupabaseClient()
  const now = Date.now()

  if (!Number.isFinite(atMs)) return { ok: false, error: 'Ongeldig tijdstip' }
  if (atMs - now > SCHEDULE_HORIZON_MS) {
    return { ok: false, error: 'Resend kan een mail maximaal 3 dagen vooruit vasthouden. Kies een moment dichterbij.' }
  }

  const b = await buildReminder(appointmentId, atMs)
  if (!b.ok) return { ok: false, error: b.reason }
  const { built } = b

  const { data } = await admin.from('sales_appointment_reminders')
    .select('id, resend_id, cancelled_at, scheduled_for').eq('appointment_id', appointmentId).maybeSingle()
  const row = data as { id: string; resend_id: string | null; cancelled_at: string | null; scheduled_for: string | null } | null

  // Stond er al iets klaar, dan eerst weg — anders vertrekken er twee.
  if (row?.resend_id && !row.cancelled_at) {
    const cancelled = await cancelScheduledEmail(row.resend_id, built.apiKey)
    if (!cancelled.ok) {
      const why = cancelled.error ?? 'onbekend'
      return {
        ok: false,
        error: why === RESTRICTED_KEY_HINT
          ? `${why} Er is niets gewijzigd — anders zouden er twee mails vertrekken.`
          : `De vorige mail kon niet ingetrokken worden (${why}). Er is niets gewijzigd.`,
      }
    }
  }

  const res = await sendEmailMetAfzenderTerugval({
    to: built.to, subject: built.subject, text: built.text, html: built.html,
    from: built.from, replyTo: built.replyTo, attachments: built.attachments,
    apiKey: built.apiKey,
    scheduledAt: atMs > now ? new Date(atMs).toISOString() : null,
  })
  if (!res.ok) return { ok: false, error: res.error ?? 'Versturen mislukt' }

  const payload = {
    appointment_id: appointmentId, days_before: 1, kind: 'day_before',
    resend_id: res.id ?? null, scheduled_for: new Date(atMs).toISOString(),
    cancelled_at: null, cancelled_by: actorId ?? null,
  }
  const saved = await saveReminderRow(payload, row?.id)
  if (!saved) {
    if (res.id) await cancelScheduledEmail(res.id, built.apiKey)
    return { ok: false, error: 'De wijziging kon niet vastgelegd worden. De mail is ingetrokken; probeer het opnieuw.' }
  }

  return {
    ok: true,
    message: atMs > now
      ? `Staat klaar voor ${new Date(atMs).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`
      : 'De mail is verstuurd.',
  }
}

/**
 * Dagelijks vangnet: afspraken die verder dan 72 uur vooruit geboekt zijn,
 * konden bij het boeken nog niet ingepland worden. Zodra hun verzendmoment
 * binnen die horizon valt, gebeurt dat hier alsnog.
 */
export async function runSalesReminders(now = new Date()): Promise<ReminderResult> {
  const admin = createAdminSupabaseClient()
  const out: ReminderResult = { checked: 0, sent: 0, skipped: 0, errors: [] }

  // Ruim venster: alles wat binnen ~4 dagen begint kan een verzendmoment binnen
  // de 72 uur hebben.
  const horizon = new Date(now.getTime() + 4 * 24 * 3600 * 1000).toISOString()
  const { data } = await admin.from('sales_appointments')
    .select('id')
    .eq('status', 'scheduled')
    .gte('starts_at', now.toISOString())
    .lte('starts_at', horizon)

  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
  out.checked = ids.length

  for (const id of ids) {
    const r = await scheduleReminderFor(id, now)
    if (r.outcome === 'scheduled') out.sent++
    else if (r.outcome === 'error') out.errors.push(r.error ?? 'inplannen mislukt')
    else out.skipped++
  }
  return out
}

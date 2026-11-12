import 'server-only'
import { sendEmail, EMAIL_FROM } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { isEmail, MAX_PERSONEN } from '@/lib/meetings/model'
import { veiligeFout, type MeetingRij } from '@/lib/meetings/server'
import { splitsAdressen, INFO_ADRES } from '@/lib/meetings/meeting-mail'
import { controleerAfzender } from '@/lib/meetings/afzender'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type MeetingMailInvoer = {
  aan: unknown; onderwerp: unknown; tekst: unknown; cta_tekst?: unknown; cta_link?: unknown; verzend_sleutel: unknown; kopie_info?: unknown
}
export type MeetingMailUitkomst =
  | { ok: true; id: string; verstuurd_op: string; van: string; provider_id: string | null; al_verstuurd?: boolean; aan: string[]; kopie: boolean }
  | { ok: false; status: number; fout: string; log_id?: string | null }

/**
 * Eén mail aan de deelnemers van een meeting, vanuit info@nextgenmedia.be.
 * Controleert de inhoud en de afzender vóór er iets vertrekt; logt elke poging
 * in het E-mail Center (kind 'meeting_mail'). Dezelfde verzend_sleutel
 * verstuurt nooit twee keer.
 */
export async function verstuurMeetingMail(admin: Admin, m: MeetingRij, b: MeetingMailInvoer, door: { userId: string | null; email: string | null }): Promise<MeetingMailUitkomst> {
  const fout = (status: number, f: string): MeetingMailUitkomst => ({ ok: false, status, fout: f })
  const aan = splitsAdressen(b.aan)
  const onderwerp = String(b.onderwerp ?? '').trim().slice(0, 300)
  const tekst = String(b.tekst ?? '').slice(0, 20000)
  const ctaTekst = String(b.cta_tekst ?? '').trim().slice(0, 80) || null
  const ctaLink = String(b.cta_link ?? '').trim() || null
  if (!aan.length) return fout(400, 'Vul minstens één ontvanger in.')
  const slecht = aan.find((a) => !isEmail(a))
  if (slecht) return fout(400, `"${slecht}" is geen geldig e-mailadres.`)
  if (aan.length > MAX_PERSONEN) return fout(400, `Hoogstens ${MAX_PERSONEN} ontvangers.`)
  if (!onderwerp) return fout(400, 'Onderwerp is verplicht.')
  if (!tekst.trim()) return fout(400, 'De mail is leeg.')
  if (/\{\{[^}]*\}\}/.test(`${onderwerp}\n${tekst}`)) return fout(400, 'De mail bevat nog een stuk tussen {{ }}, zoals de briefing. Vul dat in voor je verstuurt.')
  if (ctaLink && !/^https:\/\/\S+$/.test(ctaLink)) return fout(400, 'De knop-link moet met https:// beginnen.')
  const sleutel = typeof b.verzend_sleutel === 'string' && /^[0-9a-zA-Z-]{8,64}$/.test(b.verzend_sleutel) ? b.verzend_sleutel : null
  if (!sleutel) return fout(400, 'Ongeldige aanvraag. Open het mailvenster opnieuw.')
  const kopie = b.kopie_info === true && !aan.includes(INFO_ADRES)

  // Dezelfde klik nog eens (dubbelklik, netwerk dat opnieuw probeert): nooit twee keer.
  const { data: al } = await admin.from('email_messages').select('id, status, created_at').eq('verzend_sleutel', sleutel).maybeSingle()
  if (al?.status === 'sent') return { ok: true, id: String(al.id), al_verstuurd: true, verstuurd_op: al.created_at, van: EMAIL_FROM, provider_id: null, aan, kopie }
  if (al?.status === 'bezig') return fout(409, 'Deze mail wordt al verstuurd. Wacht even en vernieuw.')

  // Enkel vanuit info@nextgenmedia.be, met een geverifieerd domein. Anders niets.
  const afzender = await controleerAfzender()
  if (!afzender.ok) return fout(503, afzender.fout)

  const html = buildEmailHtml({ bodyText: tekst, ctaText: ctaTekst, ctaLink })
  const text = buildEmailText({ bodyText: tekst, ctaText: ctaTekst, ctaLink })
  const nu = () => new Date().toISOString()
  const rij = {
    to_email: aan.join(', '), to_client_id: m.client_id, subject: onderwerp, body: tekst, html, from_email: afzender.van,
    kind: 'meeting_mail', audience: 'client', trigger_type: 'manual', related_id: m.id,
    sent_by: door.userId, sent_by_email: door.email, updated_at: nu(),
  }
  let logId: string | null = al?.id ? String(al.id) : null
  if (logId) await admin.from('email_messages').update({ ...rij, status: 'bezig', error: null }).eq('id', logId)
  else {
    const { data: ins, error } = await admin.from('email_messages').insert({ ...rij, status: 'bezig', verzend_sleutel: sleutel }).select('id').single()
    if (error && /duplicate|unique/i.test(error.message)) return fout(409, 'Deze mail wordt al verstuurd. Wacht even en vernieuw.')
    if (error) throw new Error(error.message)
    logId = String(ins.id)
  }

  const res = await sendEmail({ to: aan, subject: onderwerp, text, html, bcc: kopie ? [INFO_ADRES] : null, idempotencyKey: `meetingmail-${sleutel}` })
  await admin.from('email_messages').update({
    status: res.ok ? 'sent' : 'error', error: res.ok ? null : veiligeFout(res.error), provider_id: res.id ?? null, updated_at: nu(),
  }).eq('id', logId)
  if (!res.ok) return { ok: false, status: 502, fout: `Niet verstuurd: ${veiligeFout(res.error)}`, log_id: logId }
  return { ok: true, id: logId as string, verstuurd_op: nu(), van: afzender.van, provider_id: res.id ?? null, aan, kopie }
}

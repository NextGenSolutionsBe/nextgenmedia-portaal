import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { sendEmail, getAdminEmails, baseUrl } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { maintenanceStatus, needsReminder, formatNL, REMINDER_DAYS, type MaintenanceClient } from '@/lib/maintenance'

export type ReminderResult = { checked: number; due: number; sent: number; errors: string[] }

/**
 * INTERNE herinnering: welke onderhoudspakketten lopen bijna af?
 * Gaat alleen naar NextGenMedia (nooit naar de klant) — wij beslissen zelf of en
 * hoe we de klant benaderen. Per klant + einddatum wordt maar één keer gemaild
 * (maintenance_reminder_sent_for), zodat een dagelijkse cron niet spamt.
 */
export async function runMaintenanceReminders(now = new Date()): Promise<ReminderResult> {
  const admin = createAdminSupabaseClient()
  const out: ReminderResult = { checked: 0, due: 0, sent: 0, errors: [] }

  const { data, error } = await admin
    .from('clients')
    .select('*')
    .eq('maintenance_included', true)
  if (error) { out.errors.push(error.message); return out }

  const clients = (data ?? []) as (MaintenanceClient & { website_url?: string | null })[]
  out.checked = clients.length

  const due = clients.filter((c) => needsReminder(c, now))
  out.due = due.length
  if (due.length === 0) return out

  const recipients = await getAdminEmails()
  const base = baseUrl()

  for (const c of due) {
    const s = maintenanceStatus(c, now)
    if (!s.endDate) continue
    const end = new Date(`${s.endDate}T00:00:00.000Z`)
    const when = s.expired
      ? `is verlopen op ${formatNL(end)}`
      : s.daysLeft === 0
        ? `loopt vandaag af (${formatNL(end)})`
        : `loopt af over ${s.daysLeft} ${s.daysLeft === 1 ? 'dag' : 'dagen'}, op ${formatNL(end)}`

    const subject = s.expired
      ? `Onderhoud verlopen — ${c.company_name}`
      : `Onderhoud loopt af — ${c.company_name} (${s.daysLeft} dagen)`

    const bodyText = [
      `Het onderhoudspakket van ${c.company_name} ${when}.`,
      c.website_url ? `Website: ${c.website_url}` : '',
      `Startdatum: ${s.startDate ? formatNL(new Date(`${s.startDate}T00:00:00.000Z`)) : 'onbekend'}`,
      '',
      'Vraag de klant of hij het onderhoud wil laten doorlopen. Verlengt hij? Zet dan de nieuwe startdatum in de app, dan telt het volgende jaar automatisch mee.',
    ].filter(Boolean).join('\n')

    const ctaLink = `${base}/admin/clients/${c.id}`
    const html = buildEmailHtml({ bodyText, ctaText: 'Klant openen', ctaLink })
    const text = buildEmailText({ bodyText, ctaText: 'Klant openen', ctaLink })

    const res = await sendEmail({ to: recipients, subject, text, html })
    if (res.ok) {
      out.sent++
      // Vastleggen dat deze periode gemaild is → geen dubbele mails morgen.
      await admin.from('clients').update({ maintenance_reminder_sent_for: s.endDate }).eq('id', c.id)
    } else {
      out.errors.push(`${c.company_name}: ${res.error ?? 'versturen mislukt'}`)
    }
  }

  return out
}

export { REMINDER_DAYS }

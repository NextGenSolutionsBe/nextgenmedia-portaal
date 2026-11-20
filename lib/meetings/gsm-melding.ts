import 'server-only'
import { zetGsmMelding } from '@/lib/sales/google-calendar'
import { GSM_MELDING_MIN } from '@/lib/meetings/kalender'
import { veiligeFout } from '@/lib/meetings/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

/** Hoe ver vooruit de scheduler bestaande afspraken nakijkt. */
const VOORUIT_DAGEN = 60

/**
 * Gsm-melding 15 minuten vooraf op elke komende afspraak die de app in Google
 * zette (meetings, klantboekingen, verkoopafspraken). Nieuwe afspraken krijgen
 * de melding al bij het aanmaken; dit haalt de afspraken in die er vóór die
 * regel al stonden, en probeert mislukte opnieuw. Idempotent: een event dat
 * de melding al heeft, wordt gewoon op 'ingesteld' gezet. Nooit een bericht
 * aan genodigden (sendUpdates=none).
 *
 * ClickUp-meetings krijgen hun melding via de agendasync (hun Google-event).
 */
export async function zorgVoorGsmMeldingen(admin: Admin, limiet = 15): Promise<{ ingesteld: number; mislukt: number }> {
  const telling = { ingesteld: 0, mislukt: 0 }
  const nu = new Date().toISOString()
  const tot = new Date(Date.now() + VOORUIT_DAGEN * 86400000).toISOString()

  const { data: meetings } = await admin.from('klant_meetings')
    .select('id, agenda_id, google_event_id, google_calendar_id, gsm_melding_status')
    .eq('status', 'ingepland').not('google_event_id', 'is', null).not('agenda_id', 'is', null)
    .gt('starts_at', nu).lt('starts_at', tot)
    .or('gsm_melding_status.is.null,gsm_melding_status.eq.mislukt')
    .order('starts_at').limit(limiet)
  for (const m of (meetings ?? []) as { id: string; agenda_id: string; google_event_id: string; google_calendar_id: string | null }[]) {
    try {
      const min = await zetGsmMelding(m.agenda_id, m.google_calendar_id, m.google_event_id)
      const ok = min === GSM_MELDING_MIN
      await admin.from('klant_meetings').update({ gsm_melding_status: ok ? 'ingesteld' : 'mislukt', gsm_melding_fout: ok ? null : 'Google bewaarde de melding niet' }).eq('id', m.id)
      telling[ok ? 'ingesteld' : 'mislukt']++
    } catch (e) {
      await admin.from('klant_meetings').update({ gsm_melding_status: 'mislukt', gsm_melding_fout: veiligeFout(e) }).eq('id', m.id)
      telling.mislukt++
    }
  }

  const { data: afspraken, error } = await admin.from('sales_appointments')
    .select('id, calendar_id, external_event_id, gsm_melding_status')
    .neq('status', 'cancelled').not('external_event_id', 'is', null).not('calendar_id', 'is', null)
    .gt('starts_at', nu).lt('starts_at', tot)
    .or('gsm_melding_status.is.null,gsm_melding_status.eq.mislukt')
    .order('starts_at').limit(limiet)
  // Kolom nog niet gemigreerd → niets te doen.
  if (error) return telling
  for (const a of (afspraken ?? []) as { id: string; calendar_id: string; external_event_id: string }[]) {
    try {
      const min = await zetGsmMelding(a.calendar_id, null, a.external_event_id)
      const ok = min === GSM_MELDING_MIN
      await admin.from('sales_appointments').update({ gsm_melding_status: ok ? 'ingesteld' : 'mislukt', gsm_melding_fout: ok ? null : 'Google bewaarde de melding niet' }).eq('id', a.id)
      telling[ok ? 'ingesteld' : 'mislukt']++
    } catch (e) {
      await admin.from('sales_appointments').update({ gsm_melding_status: 'mislukt', gsm_melding_fout: veiligeFout(e) }).eq('id', a.id)
      telling.mislukt++
    }
  }
  return telling
}

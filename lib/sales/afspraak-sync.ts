import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { sendEmail, baseUrl } from '@/lib/email'
import {
  clickupConfigured, maakAfspraakTaak, werkAfspraakTaakBij, annuleerAfspraakTaak, isTaskGone,
} from '@/lib/clickup'
import type { SalesPipeline } from '@/lib/sales/pipelines'

/**
 * Wat er ná een geslaagde boeking nog moet gebeuren, buiten Google Calendar:
 *
 *  1. Een taak in de ClickUp-"agenda" van het merk (NextGenMedia-lijst of
 *     NextGenSolutions-lijst), toegewezen aan de closer van de gekozen agenda
 *     (Bram of Marco). Het team beheert alles in ClickUp; zonder deze taak
 *     bestaat de afspraak daar niet.
 *  2. Een interne melding naar het merk-adres (info@nextgenmedia.be of
 *     info@nextgensolutions.be): "er is een afspraak ingeboekt", met datum,
 *     tijd en alle gegevens. Dit is een mail naar het eigen bedrijf — de
 *     platformregel "klantmails nooit automatisch" gaat over prospects en
 *     klanten, en die krijgen hun uitnodiging via Google Calendar.
 *
 * Alles hier is BEST-EFFORT: de afspraak staat al in de database en in Google.
 * Hapert ClickUp of de mail, dan komt dat als waarschuwing terug naar het
 * scherm, maar de boeking blijft gewoon staan.
 */

export type AfspraakGegevens = {
  apptId: string
  startMs: number
  endMs: number
  bedrijf: string
  contact: string | null
  telefoon: string | null
  email: string | null
  adres: string | null
  meetUrl: string | null
  notities: string | null
  agendaNaam: string | null
  setterEmail: string | null
}

const fmtDatum = (ms: number) => new Date(ms).toLocaleDateString('nl-BE', {
  timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
})
const fmtUur = (ms: number) => new Date(ms).toLocaleTimeString('nl-BE', {
  timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit',
})

/** Taaknaam in ClickUp: kort, herkenbaar, op alfabet vindbaar op bedrijf. */
export function taakNaam(g: Pick<AfspraakGegevens, 'bedrijf' | 'contact'>): string {
  return `Afspraak: ${g.bedrijf}${g.contact ? ` — ${g.contact}` : ''}`
}

/** Taakomschrijving: alles wat de closer nodig heeft, ook zonder de app. */
export function taakOmschrijving(g: AfspraakGegevens, merkNaam: string): string {
  const r: string[] = []
  r.push(`${fmtDatum(g.startMs)}, ${fmtUur(g.startMs)}–${fmtUur(g.endMs)} (${merkNaam})`)
  if (g.contact) r.push(`Contact: ${g.contact}`)
  if (g.telefoon) r.push(`Telefoon: ${g.telefoon}`)
  if (g.email) r.push(`E-mail: ${g.email}`)
  if (g.adres) r.push(`Adres: ${g.adres}`)
  if (g.meetUrl) r.push(`Google Meet: ${g.meetUrl}`)
  if (g.notities) r.push(`\nBriefing:\n${g.notities}`)
  r.push(`\nGeboekt via de app${g.setterEmail ? ` door ${g.setterEmail}` : ''}.`)
  r.push(`${baseUrl()}/admin/sales/appointments`)
  return r.join('\n')
}

/**
 * ClickUp-taak aanmaken en het taak-id op de afspraak bewaren.
 * Geeft een waarschuwing (string) terug als er iets niet lukte, anders null.
 */
export async function maakClickupTaak(
  pipeline: SalesPipeline | null,
  assigneeId: number | null,
  g: AfspraakGegevens,
): Promise<string | null> {
  if (!pipeline?.clickup_list_id) {
    // Geen lijst ingesteld voor dit merk → bewust stil: dat is een keuze, geen fout.
    return null
  }
  if (!clickupConfigured()) return 'ClickUp is niet ingesteld (CLICKUP_API_KEY ontbreekt) — geen taak aangemaakt.'
  try {
    const taskId = await maakAfspraakTaak(pipeline.clickup_list_id, {
      naam: taakNaam(g),
      omschrijving: taakOmschrijving(g, pipeline.name),
      startMs: g.startMs,
      assigneeId,
    })
    const admin = createAdminSupabaseClient()
    // Kolom kan op een oudere installatie ontbreken; dan is de taak er wel,
    // alleen de koppeling niet. Geen reden om de gebruiker lastig te vallen.
    await admin.from('sales_appointments').update({ clickup_task_id: taskId }).eq('id', g.apptId)
    return null
  } catch (e) {
    return `De afspraak staat geboekt, maar de ClickUp-taak is niet gelukt: ${e instanceof Error ? e.message : 'onbekende fout'}`
  }
}

/** Bij verzetten of leadwissel: de bestaande taak laten meebewegen. */
export async function werkClickupTaakBij(
  taskId: string | null,
  pipeline: SalesPipeline | null,
  g: AfspraakGegevens,
): Promise<string | null> {
  if (!taskId || !clickupConfigured()) return null
  try {
    await werkAfspraakTaakBij(taskId, {
      naam: taakNaam(g),
      omschrijving: taakOmschrijving(g, pipeline?.name ?? ''),
      startMs: g.startMs,
    })
    return null
  } catch (e) {
    if (isTaskGone(e)) return null // handmatig verwijderd in ClickUp — prima
    return `Verzet in de app en in Google, maar de ClickUp-taak is niet bijgewerkt: ${e instanceof Error ? e.message : 'onbekende fout'}`
  }
}

/** Bij annuleren: de taak dichtzetten met [GEANNULEERD] ervoor. */
export async function sluitClickupTaak(taskId: string | null): Promise<string | null> {
  if (!taskId || !clickupConfigured()) return null
  try {
    await annuleerAfspraakTaak(taskId)
    return null
  } catch (e) {
    if (isTaskGone(e)) return null
    return `Geannuleerd, maar de ClickUp-taak kon niet dichtgezet worden: ${e instanceof Error ? e.message : 'onbekende fout'}`
  }
}

/**
 * De interne "er is een afspraak ingeboekt"-mail naar het merk-adres.
 * Afzender blijft bewust de standaard (info@nextgenmedia.be) — dit is een
 * melding aan onszelf, geen merkcommunicatie naar buiten.
 */
export async function stuurInterneMelding(
  pipeline: SalesPipeline | null,
  g: AfspraakGegevens,
): Promise<string | null> {
  const naar = pipeline?.notify_email?.trim()
  if (!naar) return null // geen adres ingesteld = geen melding gewenst
  const merk = pipeline?.name ?? 'Verkoop'

  const regels = [
    `Er is een nieuwe afspraak ingeboekt voor ${merk}.`,
    '',
    `Wanneer:  ${fmtDatum(g.startMs)}, ${fmtUur(g.startMs)}–${fmtUur(g.endMs)}`,
    `Bedrijf:  ${g.bedrijf}`,
    ...(g.contact ? [`Contact:  ${g.contact}`] : []),
    ...(g.telefoon ? [`Telefoon: ${g.telefoon}`] : []),
    ...(g.email ? [`E-mail:   ${g.email}`] : []),
    ...(g.adres ? [`Adres:    ${g.adres}`] : []),
    ...(g.agendaNaam ? [`Agenda:   ${g.agendaNaam}`] : []),
    ...(g.meetUrl ? [`Meet:     ${g.meetUrl}`] : []),
    ...(g.notities ? ['', `Briefing: ${g.notities}`] : []),
    '',
    `Geboekt${g.setterEmail ? ` door ${g.setterEmail}` : ''} via de app:`,
    `${baseUrl()}/admin/sales/appointments`,
  ]

  const res = await sendEmail({
    to: naar,
    subject: `Nieuwe afspraak ${merk} — ${g.bedrijf}, ${fmtDatum(g.startMs)} om ${fmtUur(g.startMs)}`,
    text: regels.join('\n'),
  })
  return res.ok ? null : `De afspraak staat geboekt, maar de melding naar ${naar} is niet verstuurd: ${res.error}`
}

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
      eindMs: g.endMs,
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
      eindMs: g.endMs,
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

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Merkkleur voor de meldingsmail: geel NGM, blauw NGS, grijs onbekend. */
function mailKleur(key: string | undefined): { bg: string; tekst: string } {
  if (key === 'nextgenmedia') return { bg: '#fff848', tekst: '#111111' }
  if (key === 'nextgensolutions') return { bg: '#3b82f6', tekst: '#ffffff' }
  return { bg: '#e5e7eb', tekst: '#111111' }
}

/**
 * De HTML van de interne melding. Bewust ouderwets gebouwd — tabellen en
 * inline stijlen — want dit wordt in Outlook gelezen, en die kan geen
 * moderne CSS aan (zelfs white-space:pre-wrap negeert hij, waardoor de
 * eerste versie als één brij tekst binnenkwam).
 */
function meldingHtml(merk: string, merkKey: string | undefined, g: AfspraakGegevens): string {
  const kleur = mailKleur(merkKey)
  const rij = (label: string, waarde: string, html = false) => `
    <tr>
      <td style="padding:6px 16px 6px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top">${esc(label)}</td>
      <td style="padding:6px 0;font-size:14px;color:#111111;vertical-align:top">${html ? waarde : esc(waarde)}</td>
    </tr>`

  const rijen = [
    rij('Wanneer', `${fmtDatum(g.startMs)}, ${fmtUur(g.startMs)}–${fmtUur(g.endMs)}`),
    rij('Bedrijf', g.bedrijf),
    ...(g.contact ? [rij('Contact', g.contact)] : []),
    ...(g.telefoon ? [rij('Telefoon', g.telefoon)] : []),
    ...(g.email ? [rij('E-mail', g.email)] : []),
    ...(g.adres ? [rij('Adres', g.adres)] : []),
    ...(g.agendaNaam ? [rij('Agenda', g.agendaNaam)] : []),
    ...(g.meetUrl ? [rij('Google Meet', `<a href="${esc(g.meetUrl)}" style="color:#2563eb">${esc(g.meetUrl)}</a>`, true)] : []),
  ].join('')

  const briefing = g.notities ? `
    <tr><td style="padding:14px 24px 0 24px">
      <div style="font-size:13px;color:#6b7280;margin-bottom:4px">Briefing van de setter</div>
      <div style="font-size:14px;color:#111111;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px">${esc(g.notities)}</div>
    </td></tr>` : ''

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-family:Segoe UI,system-ui,Arial,sans-serif">
        <tr>
          <td style="background:${kleur.bg};padding:14px 24px;font-size:14px;font-weight:bold;color:${kleur.tekst}">
            Nieuwe afspraak — ${esc(merk)}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px 4px 24px;font-size:18px;font-weight:bold;color:#111111">
            ${esc(g.bedrijf)}${g.contact ? ` <span style="font-weight:normal;color:#6b7280">· ${esc(g.contact)}</span>` : ''}
          </td>
        </tr>
        <tr><td style="padding:8px 24px 0 24px">
          <table role="presentation" cellpadding="0" cellspacing="0">${rijen}</table>
        </td></tr>
        ${briefing}
        <tr><td style="padding:18px 24px 22px 24px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#111111;border-radius:8px">
              <a href="${esc(baseUrl())}/admin/sales/appointments"
                 style="display:inline-block;padding:10px 18px;font-size:13px;font-weight:bold;color:#ffffff;text-decoration:none">
                Open in de app
              </a>
            </td>
          </tr></table>
        </td></tr>
        <tr>
          <td style="padding:12px 24px;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af">
            Geboekt${g.setterEmail ? ` door ${esc(g.setterEmail)}` : ''} via het NextGen-portaal.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>`
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

  // De platte tekst blijft bestaan als terugval voor mailclients zonder HTML.
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
    html: meldingHtml(merk, pipeline?.key, g),
  })
  return res.ok ? null : `De afspraak staat geboekt, maar de melding naar ${naar} is niet verstuurd: ${res.error}`
}

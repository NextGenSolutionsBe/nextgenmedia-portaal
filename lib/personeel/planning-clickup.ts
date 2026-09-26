import 'server-only'
import { clickupConfigured, findMemberId, listClickupMembers, upsertPlanningTaak, annuleerAfspraakTaak } from '@/lib/clickup'
import { brusselNaarIso } from './tijd'
import type { Admin } from './server'

export type ClickupSyncResultaat = { status: 'toegewezen' | 'zonder_toegewezene' | 'fout'; toegewezen: string | null; fout: string | null }

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.nextgenmedia.be').replace(/\/$/, '')

/**
 * Een bevestigd werkblok als taak in ClickUp ("Planning medewerkers"), met
 * start- en einduur. Toegewezen aan het ClickUp-lid met hetzelfde e-mailadres
 * of dezelfde naam — enkel bij één duidelijke kandidaat; anders aan niemand
 * (liever niemand dan de verkeerde). Best-effort: het resultaat wordt op het
 * werkblok bewaard, een fout breekt de bevestiging nooit.
 */
export async function syncWerkblokNaarClickup(admin: Admin, planningId: string): Promise<ClickupSyncResultaat> {
  const bewaar = async (r: ClickupSyncResultaat, taskId?: string | null) => {
    await admin.from('personeel_planning').update({
      clickup_status: r.status, clickup_toegewezen: r.toegewezen, clickup_fout: r.fout,
      ...(taskId !== undefined ? { clickup_task_id: taskId } : {}),
    }).eq('id', planningId)
    return r
  }
  try {
    const { data: w } = await admin.from('personeel_planning').select('*').eq('id', planningId).maybeSingle()
    if (!w) return { status: 'fout', toegewezen: null, fout: 'Werkblok niet gevonden' }
    if (!clickupConfigured()) return bewaar({ status: 'fout', toegewezen: null, fout: 'ClickUp is niet ingesteld (CLICKUP_API_KEY).' })
    const [{ data: p }, klant, opdracht] = await Promise.all([
      admin.from('personeel').select('voornaam, achternaam, email').eq('id', w.personeel_id).maybeSingle(),
      w.client_id ? admin.from('clients').select('company_name').eq('id', w.client_id).maybeSingle().then((r) => r.data?.company_name as string | undefined) : Promise.resolve(undefined),
      w.opdracht_id ? admin.from('opdrachten').select('titel').eq('id', w.opdracht_id).maybeSingle().then((r) => r.data?.titel as string | undefined) : Promise.resolve(undefined),
    ])
    const naam = [p?.voornaam, p?.achternaam].filter(Boolean).join(' ') || 'Medewerker'

    // Wie is dit in ClickUp? Eerst e-mail, dan volledige naam.
    let assigneeId: number | null = null
    if (p?.email) assigneeId = await findMemberId(String(p.email))
    if (!assigneeId && naam !== 'Medewerker') assigneeId = await findMemberId(naam)
    let toegewezen: string | null = null
    if (assigneeId) {
      const lid = (await listClickupMembers()).find((m) => m.id === assigneeId)
      toegewezen = lid?.username || lid?.email || naam
    }

    const wat = w.taak || w.project || 'Werkblok'
    const omschrijving = [
      `Medewerker: ${naam}`,
      klant ? `Klant: ${klant}` : null,
      opdracht ? `Opdracht: ${opdracht}` : null,
      w.project && w.project !== wat ? `Project: ${w.project}` : null,
      w.thuiswerk ? 'Locatie: thuiswerk' : w.locatie ? `Locatie: ${w.locatie}` : null,
      w.deadline ? `Deadline: ${String(w.deadline).split('-').reverse().join('/')}` : null,
      w.briefing ? `\nBriefing:\n${w.briefing}` : null,
      w.deliverables ? `\nDeliverables:\n${w.deliverables}` : null,
      assigneeId ? null : `\n(Nog niemand toegewezen: ${naam} werd niet gevonden in de ClickUp-werkruimte.)`,
      `\nIn de app: ${APP_URL}/admin/personeel?tab=planning`,
    ].filter(Boolean).join('\n')

    const taskId = await upsertPlanningTaak(w.clickup_task_id ?? null, {
      naam: `${naam.split(' ')[0]} — ${wat}${klant ? ` (${klant})` : ''}`,
      omschrijving,
      startMs: Date.parse(brusselNaarIso(String(w.datum), String(w.start_tijd).slice(0, 5))),
      eindMs: Date.parse(brusselNaarIso(String(w.datum), String(w.eind_tijd).slice(0, 5))),
      assigneeId,
    })
    return bewaar({ status: assigneeId ? 'toegewezen' : 'zonder_toegewezene', toegewezen, fout: null }, taskId)
  } catch (e) {
    return bewaar({ status: 'fout', toegewezen: null, fout: (e instanceof Error ? e.message : String(e)).slice(0, 500) })
  }
}

/** Werkblok geannuleerd of verwijderd → de ClickUp-taak sluiten (niet wissen). Best-effort. */
export async function annuleerWerkblokInClickup(admin: Admin, w: { id: string; clickup_task_id?: string | null }, bewaren = true): Promise<void> {
  if (!w.clickup_task_id || !clickupConfigured()) return
  try {
    await annuleerAfspraakTaak(w.clickup_task_id)
    if (bewaren) await admin.from('personeel_planning').update({ clickup_status: 'geannuleerd', clickup_fout: null }).eq('id', w.id)
  } catch (e) {
    if (bewaren) await admin.from('personeel_planning').update({ clickup_fout: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq('id', w.id)
  }
}

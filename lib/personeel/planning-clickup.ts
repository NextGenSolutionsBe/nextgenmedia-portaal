import 'server-only'
import {
  clickupConfigured, clickupTaakIdUit, findMemberId, listClickupMembers, upsertPlanningTaak, annuleerAfspraakTaak,
  wijsTaakToe, haalVanTaak, reageerOpTaak, isTaskGone,
} from '@/lib/clickup'
import { brusselNaarIso } from './tijd'
import type { Admin } from './server'

export type ClickupSyncResultaat = { status: 'toegewezen' | 'zonder_toegewezene' | 'fout'; toegewezen: string | null; fout: string | null }

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.nextgenmedia.be').replace(/\/$/, '')
const dagNl = (d: string) => String(d).split('-').reverse().join('/')
const uur = (t: unknown) => String(t ?? '').slice(0, 5)

/** Wie is deze medewerker in ClickUp? Eerst e-mail, dan volledige naam — enkel bij één duidelijke kandidaat. */
async function clickupLid(p: { voornaam?: string | null; achternaam?: string | null; email?: string | null } | null): Promise<{ id: number | null; naam: string; toegewezen: string | null }> {
  const naam = [p?.voornaam, p?.achternaam].filter(Boolean).join(' ') || 'Medewerker'
  let id: number | null = null
  if (p?.email) id = await findMemberId(String(p.email))
  if (!id && naam !== 'Medewerker') id = await findMemberId(naam)
  let toegewezen: string | null = null
  if (id) {
    const lid = (await listClickupMembers()).find((m) => m.id === id)
    toegewezen = lid?.username || lid?.email || naam
  }
  return { id, naam, toegewezen }
}

/**
 * Een BEVESTIGD werkblok in ClickUp. Welke taak?
 *  1. de taak die dit werkblok al heeft;
 *  2. een bestaande taak die de admin bij het inboeken opgaf (bv. de contentshoot);
 *  3. de taak van een collega uit dezelfde inboeking (groep_id) — twee mensen op
 *     dezelfde shoot = één taak met twee toegewezenen;
 *  4. anders een nieuwe taak in "Planning medewerkers".
 * Bij 2 en 3 wordt de persoon enkel toegevoegd (naam, tekst en tijden van die
 * taak blijven ongemoeid) met een opmerking erbij. Best-effort: het resultaat
 * staat op het werkblok, een fout breekt de bevestiging nooit.
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
    const lid = await clickupLid(p)
    const status = (lid.id ? 'toegewezen' : 'zonder_toegewezene') as ClickupSyncResultaat['status']
    const moment = `${dagNl(w.datum)} ${uur(w.start_tijd)}–${uur(w.eind_tijd)}`

    // Een taak die al bestaat of met een collega gedeeld wordt: enkel toevoegen.
    let gedeeld: string | null = null
    if (w.clickup_task_id) {
      // Al een taak, maar gedeeld (opgegeven bestaande taak of een collega staat er ook op)?
      // Dan nooit naam/tekst/tijden overschrijven — enkel toevoegen en een opmerking.
      const { count } = await admin.from('personeel_planning').select('id', { count: 'exact', head: true })
        .eq('clickup_task_id', w.clickup_task_id).neq('id', w.id).neq('status', 'geannuleerd')
      if (w.clickup_bestaande_taak || (count ?? 0) > 0) gedeeld = w.clickup_task_id
    }
    if (!w.clickup_task_id && w.clickup_bestaande_taak) gedeeld = clickupTaakIdUit(w.clickup_bestaande_taak)
    if (!w.clickup_task_id && !gedeeld && w.groep_id) {
      const { data: collega } = await admin.from('personeel_planning').select('clickup_task_id')
        .eq('groep_id', w.groep_id).neq('id', w.id).neq('status', 'geannuleerd').not('clickup_task_id', 'is', null).limit(1).maybeSingle()
      gedeeld = (collega as { clickup_task_id?: string | null } | null)?.clickup_task_id ?? null
    }
    if (gedeeld) {
      try {
        if (lid.id) await wijsTaakToe(gedeeld, lid.id)
        await reageerOpTaak(gedeeld, `${lid.naam} ingeboekt en bevestigd: ${moment}${lid.id ? '' : ' (niet gevonden in ClickUp, dus niet toegewezen)'}.`)
        return bewaar({ status, toegewezen: lid.toegewezen, fout: null }, gedeeld)
      } catch (e) {
        if (!isTaskGone(e)) throw e
        // Die taak bestaat niet (meer) → hieronder een nieuwe.
      }
    }

    const wat = w.taak || w.project || 'Werkblok'
    const omschrijving = [
      `Ingeboekt: ${lid.naam} (${moment})`,
      klant ? `Klant: ${klant}` : null,
      opdracht ? `Opdracht: ${opdracht}` : null,
      w.project && w.project !== wat ? `Project: ${w.project}` : null,
      w.thuiswerk ? 'Locatie: thuiswerk' : w.locatie ? `Locatie: ${w.locatie}` : null,
      w.deadline ? `Deadline: ${dagNl(w.deadline)}` : null,
      w.briefing ? `\nBriefing:\n${w.briefing}` : null,
      w.deliverables ? `\nDeliverables:\n${w.deliverables}` : null,
      lid.id ? null : `\n(Nog niemand toegewezen: ${lid.naam} werd niet gevonden in de ClickUp-werkruimte.)`,
      `\nIn de app: ${APP_URL}/admin/personeel?tab=planning`,
    ].filter(Boolean).join('\n')

    const taskId = await upsertPlanningTaak(w.clickup_task_id ?? null, {
      // Een gedeelde inboeking krijgt een taaknaam zonder persoon; collega's worden toegevoegd.
      naam: w.groep_id ? `${wat}${klant ? ` (${klant})` : ''}` : `${lid.naam.split(' ')[0]} — ${wat}${klant ? ` (${klant})` : ''}`,
      omschrijving,
      startMs: Date.parse(brusselNaarIso(String(w.datum), uur(w.start_tijd))),
      eindMs: Date.parse(brusselNaarIso(String(w.datum), uur(w.eind_tijd))),
      assigneeId: lid.id,
    })
    return bewaar({ status, toegewezen: lid.toegewezen, fout: null }, taskId)
  } catch (e) {
    return bewaar({ status: 'fout', toegewezen: null, fout: (e instanceof Error ? e.message : String(e)).slice(0, 500) })
  }
}

/**
 * Werkblok geannuleerd of verwijderd. Is de taak van deze persoon alleen → de
 * taak sluiten (niet wissen). Is ze gedeeld (bestaande taak, of een collega uit
 * dezelfde inboeking staat er nog op) → enkel deze persoon eraf halen. Best-effort.
 */
export async function annuleerWerkblokInClickup(admin: Admin, w: { id: string; clickup_task_id?: string | null }, bewaren = true): Promise<void> {
  if (!w.clickup_task_id || !clickupConfigured()) return
  try {
    const { data: rij } = await admin.from('personeel_planning').select('personeel_id, clickup_bestaande_taak, datum, start_tijd, eind_tijd').eq('id', w.id).maybeSingle()
    const { count } = await admin.from('personeel_planning').select('id', { count: 'exact', head: true })
      .eq('clickup_task_id', w.clickup_task_id).neq('id', w.id).neq('status', 'geannuleerd')
    const gedeeld = !!(rij as { clickup_bestaande_taak?: string | null } | null)?.clickup_bestaande_taak || (count ?? 0) > 0
    if (gedeeld) {
      const r = rij as { personeel_id: string; datum: string; start_tijd: string; eind_tijd: string } | null
      const { data: p } = r ? await admin.from('personeel').select('voornaam, achternaam, email').eq('id', r.personeel_id).maybeSingle() : { data: null }
      const lid = await clickupLid(p)
      if (lid.id) await haalVanTaak(w.clickup_task_id, lid.id)
      await reageerOpTaak(w.clickup_task_id, `${lid.naam} is niet meer ingeboekt${r ? ` (${dagNl(r.datum)} ${uur(r.start_tijd)}–${uur(r.eind_tijd)})` : ''}.`)
    } else {
      await annuleerAfspraakTaak(w.clickup_task_id)
    }
    if (bewaren) await admin.from('personeel_planning').update({ clickup_status: 'geannuleerd', clickup_fout: null }).eq('id', w.id)
  } catch (e) {
    if (bewaren) await admin.from('personeel_planning').update({ clickup_fout: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq('id', w.id)
  }
}

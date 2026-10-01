import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { eindeMoment, maandBereik, maandenTekst, tel, vandaagBrussel, type Deadline, type Taal, type Tellingen } from './deadline-model'

/**
 * Goedkeuringsdeadlines (server). Eén plek voor het lezen, tellen en het
 * automatisch goedkeuren na een verstreken deadline — gebruikt door de nachtelijke
 * cron, het admin-overzicht en het klantenportaal (wie er het eerst bij is, doet
 * het; dubbel verwerken kan niet dankzij de voorwaardelijke update op status).
 */

export type DeadlineMet = Deadline & { klant: string | null; tellingen: Tellingen; laatsteMail: string | null }

/** Statussen van de content in de maanden van een deadline. */
async function statussenVoor(admin: SupabaseClient, d: Pick<Deadline, 'client_id' | 'maanden'>): Promise<string[]> {
  const uit: string[] = []
  for (const m of d.maanden) {
    const b = maandBereik(m)
    const { data } = await admin.from('social_content_items').select('status')
      .eq('client_id', d.client_id).gte('planned_date', b.van).lt('planned_date', b.tot)
    for (const r of (data ?? []) as { status: string }[]) uit.push(r.status)
  }
  return uit
}

/**
 * Verstreken deadlines verwerken: wat nog "bij klant" staat (ready_for_review)
 * wordt goedgekeurd. Feedback (changes_requested) en concepten blijven zoals ze
 * zijn — daar heeft de klant al gereageerd, of het lag nog niet bij de klant.
 */
export async function verwerkVerstreken(admin: SupabaseClient, clientId?: string): Promise<number> {
  const vandaag = vandaagBrussel()
  let q = admin.from('content_goedkeuring_deadlines').select('id, client_id, maanden, deadline').eq('status', 'open').lt('deadline', vandaag)
  if (clientId) q = q.eq('client_id', clientId)
  const { data } = await q
  let totaal = 0
  for (const d of (data ?? []) as Pick<Deadline, 'id' | 'client_id' | 'maanden' | 'deadline'>[]) {
    // Eerst "claimen": enkel wie de status van open naar afgerond zet, verwerkt.
    const nu = new Date().toISOString()
    const { data: geclaimd } = await admin.from('content_goedkeuring_deadlines')
      .update({ status: 'afgerond', afgerond_op: nu, updated_at: nu }).eq('id', d.id).eq('status', 'open').select('id')
    if (!geclaimd?.length) continue
    let aantal = 0
    for (const m of d.maanden) {
      const b = maandBereik(m)
      const { data: rijen } = await admin.from('social_content_items')
        .update({ status: 'approved', reviewed_at: nu, client_feedback: null })
        .eq('client_id', d.client_id).eq('status', 'ready_for_review').gte('planned_date', b.van).lt('planned_date', b.tot)
        .select('id')
      aantal += rijen?.length ?? 0
    }
    await admin.from('content_goedkeuring_deadlines').update({ auto_goedgekeurd: aantal }).eq('id', d.id)
    await logAudit({
      action: 'content.deadline_verstreken', entityType: 'client', entityId: d.client_id,
      summary: `Goedkeuringsdeadline ${d.deadline.split('-').reverse().join('/')} verstreken (${maandenTekst(d.maanden)}): ${aantal} item(s) automatisch goedgekeurd`,
      actorEmail: 'systeem', metadata: { deadline_id: d.id, maanden: d.maanden, aantal },
    })
    totaal += aantal
  }
  return totaal
}

/** Deadlines met klantnaam, tellingen en de laatste herinneringsmail. */
export async function leesDeadlines(admin: SupabaseClient, opts: { clientId?: string; alleenOpen?: boolean } = {}): Promise<DeadlineMet[]> {
  let q = admin.from('content_goedkeuring_deadlines').select('*').order('deadline', { ascending: true })
  if (opts.clientId) q = q.eq('client_id', opts.clientId)
  if (opts.alleenOpen) q = q.eq('status', 'open')
  const { data } = await q
  const rijen = (data ?? []) as Deadline[]
  if (!rijen.length) return []
  const klantIds = [...new Set(rijen.map((r) => r.client_id))]
  const [{ data: klanten }, { data: mails }] = await Promise.all([
    admin.from('clients').select('id, company_name').in('id', klantIds),
    admin.from('email_messages').select('to_client_id, created_at').eq('kind', 'goedkeuring').in('to_client_id', klantIds).order('created_at', { ascending: false }).limit(500),
  ])
  const naam = new Map(((klanten ?? []) as { id: string; company_name: string | null }[]).map((k) => [k.id, k.company_name]))
  const laatste = new Map<string, string>()
  for (const m of (mails ?? []) as { to_client_id: string; created_at: string }[]) if (!laatste.has(m.to_client_id)) laatste.set(m.to_client_id, m.created_at)
  return Promise.all(rijen.map(async (r) => ({
    ...r,
    klant: naam.get(r.client_id) ?? null,
    tellingen: tel(await statussenVoor(admin, r)),
    laatsteMail: laatste.get(r.client_id) ?? null,
  })))
}

/**
 * Voor het klantenportaal: de open deadlines waar nog iets "bij klant" staat,
 * klaar voor de aftelklok. Verwerkt eerst een eventueel verstreken deadline.
 */
export async function aftelItemsVoorKlant(admin: SupabaseClient, clientId: string, taal: Taal = 'nl'): Promise<{ id: string; maanden: string; datum: string; eindeIso: string; open: number }[]> {
  try {
    await verwerkVerstreken(admin, clientId)
    const lijst = await leesDeadlines(admin, { clientId, alleenOpen: true })
    return lijst.filter((d) => d.tellingen.bij_klant > 0).map((d) => ({
      id: d.id,
      maanden: maandenTekst(d.maanden, taal),
      datum: new Date(`${d.deadline}T12:00:00Z`).toLocaleDateString(taal === 'en' ? 'en-GB' : 'nl-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' }),
      eindeIso: eindeMoment(d.deadline),
      open: d.tellingen.bij_klant,
    }))
  } catch {
    return [] // de aftelklok is extra; het portaal mag er nooit door breken
  }
}

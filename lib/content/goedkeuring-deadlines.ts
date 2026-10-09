import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { eindeMoment, isVerstreken, maandBereik, maandenTekst, tel, vandaagBrussel, type Deadline, type Taal, type Tellingen } from './deadline-model'

/**
 * Goedkeuringsdeadlines (server). Eén plek voor het lezen en tellen, en voor de
 * manuele knop "Alles goedkeuren". Er wordt NOOIT automatisch goedgekeurd: na de
 * deadline blijft alles staan tot iemand van ons op de knop drukt.
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
 * "Alles goedkeuren" (manueel, door ons): wat in de maanden van de deadline nog
 * "bij klant" staat (ready_for_review) wordt goedgekeurd en de deadline wordt
 * afgerond. Feedback (changes_requested) en concepten blijven zoals ze zijn.
 * Dubbel klikken kan geen kwaad: enkel wie de status van open naar afgerond zet,
 * keurt goed.
 */
export async function keurAllesGoed(admin: SupabaseClient, id: string, actor: { id: string; email: string | null }): Promise<{ ok: true; aantal: number; client_id: string } | { ok: false; fout: string }> {
  const nu = new Date().toISOString()
  const { data: geclaimd } = await admin.from('content_goedkeuring_deadlines')
    .update({ status: 'afgerond', afgerond_op: nu, updated_at: nu }).eq('id', id).eq('status', 'open')
    .select('id, client_id, maanden, deadline')
  const d = (geclaimd ?? [])[0] as Pick<Deadline, 'id' | 'client_id' | 'maanden' | 'deadline'> | undefined
  if (!d) return { ok: false, fout: 'Deze deadline is al afgerond.' }
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
    action: 'content.deadline_alles_goedgekeurd', entityType: 'client', entityId: d.client_id,
    summary: `Alles goedgekeurd voor ${maandenTekst(d.maanden)} (deadline ${d.deadline.split('-').reverse().join('/')}): ${aantal} item(s)`,
    actorUserId: actor.id, actorEmail: actor.email, metadata: { deadline_id: d.id, maanden: d.maanden, aantal },
  })
  return { ok: true, aantal, client_id: d.client_id }
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
 * Voor het klantenportaal: de lopende deadlines (nog niet verstreken) waar nog
 * iets "bij klant" staat, klaar voor de aftelklok.
 */
export async function aftelItemsVoorKlant(admin: SupabaseClient, clientId: string, taal: Taal = 'nl'): Promise<{ id: string; maanden: string; datum: string; eindeIso: string; open: number }[]> {
  try {
    const vandaag = vandaagBrussel()
    const lijst = await leesDeadlines(admin, { clientId, alleenOpen: true })
    return lijst.filter((d) => d.tellingen.bij_klant > 0 && !isVerstreken(d.deadline, vandaag)).map((d) => ({
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

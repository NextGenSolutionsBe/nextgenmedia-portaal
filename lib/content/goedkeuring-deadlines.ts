import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { maandBereik, maandenTekst, tel, type Deadline, type Tellingen } from './deadline-model'
import { logContentActiviteit } from './kalender-beheer-server'

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
    // Eerst de mail die aan DEZE deadline gekoppeld is; oudere deadlines kennen enkel de laatste goedkeuringsmail aan de klant.
    laatsteMail: r.mail_verstuurd_op ?? laatste.get(r.client_id) ?? null,
  })))
}

/** Tellingen per maand voor één klant (de keuze in "Goedkeuring aanvragen"). */
export async function maandTellingen(admin: SupabaseClient, clientId: string, maanden: string[]): Promise<{ maand: string; tellingen: Tellingen }[]> {
  return Promise.all(maanden.map(async (maand) => ({ maand, tellingen: tel(await statussenVoor(admin, { client_id: clientId, maanden: [maand] })) })))
}

/**
 * Concepten van deze maanden naar de klant sturen ("Feedback gevraagd"), als
 * onderdeel van "Goedkeuring aanvragen". Enkel concepten: content met een
 * gevraagde aanpassing ligt nog bij ons en blijft staan.
 */
export async function conceptenNaarKlant(admin: SupabaseClient, clientId: string, maanden: string[], door: string | null): Promise<number> {
  let aantal = 0
  for (const m of maanden) {
    const b = maandBereik(m)
    const { data } = await admin.from('social_content_items').update({ status: 'ready_for_review', updated_at: new Date().toISOString() })
      .eq('client_id', clientId).eq('status', 'draft').gte('planned_date', b.van).lt('planned_date', b.tot).select('id')
    for (const r of (data ?? []) as { id: string }[]) {
      aantal++
      await logContentActiviteit(admin, { item_id: r.id, client_id: clientId, door, rol: 'nextgenmedia', actie: 'naar de klant gestuurd', details: { van: 'draft', naar: 'ready_for_review' } })
    }
  }
  return aantal
}

/** Voor het klantenportaal: open termijnen met de content die op goedkeuring wacht. Nooit de interne notitie. */
export type PortaalGoedkeuring = {
  id: string; maanden: string[]; deadline: string; aangevraagdOp: string
  items: { id: string; title: string; planned_date: string; content_type: string }[]
}
export async function goedkeuringenVoorKlant(admin: SupabaseClient, clientId: string): Promise<PortaalGoedkeuring[]> {
  try {
    const { data } = await admin.from('content_goedkeuring_deadlines').select('*').eq('client_id', clientId).eq('status', 'open').order('deadline', { ascending: true })
    const rijen = (data ?? []) as (Deadline & { created_at: string })[]
    return Promise.all(rijen.map(async (d) => {
      const items: PortaalGoedkeuring['items'] = []
      for (const m of d.maanden) {
        const b = maandBereik(m)
        const { data: it } = await admin.from('social_content_items').select('id, title, planned_date, content_type')
          .eq('client_id', clientId).eq('status', 'ready_for_review').gte('planned_date', b.van).lt('planned_date', b.tot).order('planned_date')
        items.push(...((it ?? []) as PortaalGoedkeuring['items']))
      }
      return { id: d.id, maanden: d.maanden, deadline: d.deadline, aangevraagdOp: d.aangevraagd_op ?? d.created_at, items }
    }))
  } catch {
    return [] // het overzicht is extra; het portaal mag er nooit door breken
  }
}

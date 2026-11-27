import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { opleveringStatus, type Versie, type Feedback } from '@/lib/opleveringen'
import type { WachtRij } from '@/lib/klant-wacht'

type Admin = ReturnType<typeof createAdminSupabaseClient>

/**
 * Alles waarop we van klanten wachten (fase 6): contracten die nog getekend
 * moeten worden, opleveringen die ze nog niet bekeken, content die op hun
 * goedkeuring wacht, offertes zonder antwoord en offertes op een aanvraag.
 * Elke bron apart en tegelijk; een bron die faalt, laat de rest staan.
 */
export async function wachtOpKlanten(admin: Admin): Promise<WachtRij[]> {
  const veilig = async <T,>(p: PromiseLike<{ data: T[] | null }>): Promise<T[]> => { try { return (await p).data ?? [] } catch { return [] } }
  const vandaag = new Date().toISOString().slice(0, 10)
  const tot = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)
  const van = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10)
  const [contracten, offertes, content, aanvragen, opl] = await Promise.all([
    veilig(admin.from('contracts').select('id, title, client_id, status, sent_at, created_at').in('status', ['sent', 'viewed']).not('client_id', 'is', null).limit(500)),
    veilig(admin.from('offertes').select('id, titel, client_id, status, verstuurd_op, created_at').eq('status', 'verstuurd').not('client_id', 'is', null).limit(500)),
    veilig(admin.from('social_content_items').select('client_id, planned_date, updated_at').eq('status', 'ready_for_review').gte('planned_date', van).lte('planned_date', tot).limit(3000)),
    veilig(admin.from('klant_aanvragen').select('id, client_id, type_label, offerte_status, offerte_verstuurd_op, updated_at').eq('offerte_status', 'open').limit(500)),
    veilig(admin.from('opleveringen').select('id, client_id, titel').is('gearchiveerd_op', null).limit(1000)),
  ]) as [
    { id: string; title: string; client_id: string; sent_at: string | null; created_at: string }[],
    { id: string; titel: string; client_id: string; verstuurd_op: string | null; created_at: string }[],
    { client_id: string; planned_date: string | null; updated_at: string | null }[],
    { id: string; client_id: string; type_label: string | null; offerte_verstuurd_op: string | null; updated_at: string }[],
    { id: string; client_id: string; titel: string }[],
  ]

  // Opleveringen: de laatst gedeelde versie zonder feedback = wacht op de klant.
  const oplIds = opl.map((o) => o.id)
  const [versies, feedback] = oplIds.length ? await Promise.all([
    veilig(admin.from('oplevering_versies').select('id, oplevering_id, nummer, is_finaal, gepubliceerd_op, verloopt_op, verwijderd_op').in('oplevering_id', oplIds)),
    veilig(admin.from('oplevering_feedback').select('versie_id, soort').in('oplevering_id', oplIds)),
  ]) as [(Versie & { oplevering_id: string })[], Pick<Feedback, 'versie_id' | 'soort'>[]] : [[], []]

  const klantIds = [...new Set([...contracten, ...offertes, ...content, ...aanvragen, ...opl].map((r) => r.client_id).filter(Boolean))]
  const { data: k } = klantIds.length ? await admin.from('clients').select('id, company_name').in('id', klantIds) : { data: [] }
  const naam = new Map(((k ?? []) as { id: string; company_name: string }[]).map((c) => [c.id, c.company_name]))
  const n = (id: string) => naam.get(id) ?? 'Klant'

  const uit: WachtRij[] = []
  for (const c of contracten) uit.push({ client_id: c.client_id, klant: n(c.client_id), soort: 'contract', titel: c.title, sinds: c.sent_at ?? c.created_at, href: `/admin/contracts/${c.id}` })
  for (const o of offertes) uit.push({ client_id: o.client_id, klant: n(o.client_id), soort: 'offerte', titel: o.titel, sinds: o.verstuurd_op ?? o.created_at, href: `/admin/offertes?offerte=${o.id}` })
  for (const a of aanvragen) if (a.client_id) uit.push({ client_id: a.client_id, klant: n(a.client_id), soort: 'aanvraag', titel: a.type_label ?? 'Aanvraag', sinds: a.offerte_verstuurd_op ?? a.updated_at, href: `/admin/aanvragen?aanvraag=${a.id}` })
  for (const o of opl) {
    const eigen = versies.filter((v) => v.oplevering_id === o.id)
    if (opleveringStatus(eigen, feedback) !== 'wacht_op_klant') continue
    const laatste = eigen.filter((v) => v.gepubliceerd_op).sort((a, b) => b.nummer - a.nummer)[0]
    if (laatste?.verwijderd_op) continue
    uit.push({ client_id: o.client_id, klant: n(o.client_id), soort: 'oplevering', titel: o.titel, sinds: laatste?.gepubliceerd_op ?? vandaag, href: `/admin/opleveringen?oplevering=${o.id}` })
  }
  // Content: één regel per klant met het aantal posts dat op goedkeuring wacht.
  const perKlant = new Map<string, { aantal: number; sinds: string }>()
  for (const c of content) {
    if (!c.client_id) continue
    const v = perKlant.get(c.client_id) ?? { aantal: 0, sinds: c.updated_at ?? vandaag }
    v.aantal++
    if ((c.updated_at ?? vandaag) < v.sinds) v.sinds = c.updated_at ?? vandaag
    perKlant.set(c.client_id, v)
  }
  for (const [id, v] of perKlant) uit.push({ client_id: id, klant: n(id), soort: 'content', titel: `${v.aantal} ${v.aantal === 1 ? 'post' : 'posts'} ter goedkeuring`, sinds: v.sinds, href: `/admin/services/social-media?klant=${id}`, aantal: v.aantal })
  return uit
}

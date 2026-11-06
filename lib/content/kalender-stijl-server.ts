import 'server-only'
import { controleerFaseKleuren, controleerLabel, geldigeLabelIds, leegStijl, type ContentLabel, type KalenderStijl } from './kalender-stijl'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

/**
 * Labels en fasekleuren van één klantkalender. De oproeper heeft de toegang tot
 * die klant al gecontroleerd (portaal: geresolveerde clientId; admin: staff).
 * Vóór de migratie (tabellen ontbreken) is alles gewoon leeg.
 */

export class StijlFout extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

const MIST = /content_labels|content_kalender_stijl|labels|does not exist|schema cache/i

export async function leesKalenderStijl(admin: Admin, clientId: string): Promise<KalenderStijl> {
  const [l, s] = await Promise.all([
    admin.from('content_labels').select('id, naam, kleur').eq('client_id', clientId).order('naam'),
    admin.from('content_kalender_stijl').select('fase_kleuren').eq('client_id', clientId).maybeSingle(),
  ])
  if (l.error && MIST.test(l.error.message)) return leegStijl
  return {
    labels: ((l.data ?? []) as ContentLabel[]).map((x) => ({ id: x.id, naam: x.naam, kleur: x.kleur })),
    faseKleuren: controleerFaseKleuren((s.data as { fase_kleuren?: unknown } | null)?.fase_kleuren),
  }
}

export async function maakLabel(admin: Admin, clientId: string, b: { naam?: unknown; kleur?: unknown }, door: string | null): Promise<KalenderStijl> {
  const c = controleerLabel(b)
  if ('fout' in c) throw new StijlFout(c.fout)
  const { count } = await admin.from('content_labels').select('id', { count: 'exact', head: true }).eq('client_id', clientId)
  if ((count ?? 0) >= 40) throw new StijlFout('Er zijn al 40 labels. Verwijder er eerst een.')
  const { error } = await admin.from('content_labels').insert({ client_id: clientId, ...c.label, created_by: door })
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new StijlFout('Dat label bestaat al.')
    throw new Error(error.message)
  }
  return leesKalenderStijl(admin, clientId)
}

export async function wijzigLabel(admin: Admin, clientId: string, id: string, b: { naam?: unknown; kleur?: unknown }): Promise<KalenderStijl> {
  const c = controleerLabel(b)
  if ('fout' in c) throw new StijlFout(c.fout)
  const { data, error } = await admin.from('content_labels').update(c.label).eq('id', id).eq('client_id', clientId).select('id')
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new StijlFout('Dat label bestaat al.')
    throw new Error(error.message)
  }
  if (!(data ?? []).length) throw new StijlFout('Label niet gevonden.', 404)
  return leesKalenderStijl(admin, clientId)
}

/** Label weg: ook van de posts waar het op stond. De posts zelf veranderen niet. */
export async function verwijderLabel(admin: Admin, clientId: string, id: string): Promise<KalenderStijl> {
  const { data: met } = await admin.from('social_content_items').select('id, labels').eq('client_id', clientId).contains('labels', [id])
  for (const it of (met ?? []) as { id: string; labels: string[] }[]) {
    await admin.from('social_content_items').update({ labels: (it.labels ?? []).filter((x) => x !== id) }).eq('id', it.id).eq('client_id', clientId)
  }
  const { error } = await admin.from('content_labels').delete().eq('id', id).eq('client_id', clientId)
  if (error) throw new Error(error.message)
  return leesKalenderStijl(admin, clientId)
}

export async function zetFaseKleuren(admin: Admin, clientId: string, kleuren: unknown, door: string | null): Promise<KalenderStijl> {
  const k = controleerFaseKleuren(kleuren)
  const { error } = await admin.from('content_kalender_stijl').upsert({ client_id: clientId, fase_kleuren: k, updated_at: new Date().toISOString(), updated_by: door }, { onConflict: 'client_id' })
  if (error) throw new Error(error.message)
  return leesKalenderStijl(admin, clientId)
}

/** De labels van één post zetten (enkel labels van deze klant). Inhoud en status blijven zoals ze zijn. */
export async function zetItemLabels(admin: Admin, clientId: string, itemId: string, ids: unknown): Promise<string[]> {
  const { data: item } = await admin.from('social_content_items').select('id').eq('id', itemId).eq('client_id', clientId).maybeSingle()
  if (!item) throw new StijlFout('Post niet gevonden.', 404)
  const { data: l } = await admin.from('content_labels').select('id').eq('client_id', clientId)
  const geldig = geldigeLabelIds(ids, new Set(((l ?? []) as { id: string }[]).map((x) => x.id)))
  const { error } = await admin.from('social_content_items').update({ labels: geldig }).eq('id', itemId).eq('client_id', clientId)
  if (error) throw new Error(error.message)
  return geldig
}

/** Eén ingang voor de routes: { actie, ... } → de nieuwe stijl (of de labels van een post). */
export async function stijlActie(admin: Admin, clientId: string, b: Record<string, unknown>, door: string | null): Promise<{ stijl?: KalenderStijl; labels?: string[] }> {
  const id = typeof b.id === 'string' && /^[0-9a-f-]{36}$/i.test(b.id) ? b.id : null
  switch (b.actie) {
    case 'label_maak': return { stijl: await maakLabel(admin, clientId, b, door) }
    case 'label_wijzig': if (!id) throw new StijlFout('Ongeldige vraag.'); return { stijl: await wijzigLabel(admin, clientId, id, b) }
    case 'label_verwijder': if (!id) throw new StijlFout('Ongeldige vraag.'); return { stijl: await verwijderLabel(admin, clientId, id) }
    case 'kleuren': return { stijl: await zetFaseKleuren(admin, clientId, b.kleuren, door) }
    case 'item_labels': {
      const item = typeof b.item === 'string' && /^[0-9a-f-]{36}$/i.test(b.item) ? b.item : null
      if (!item) throw new StijlFout('Ongeldige vraag.')
      return { labels: await zetItemLabels(admin, clientId, item, b.labels) }
    }
    default: throw new StijlFout('Onbekende actie.')
  }
}

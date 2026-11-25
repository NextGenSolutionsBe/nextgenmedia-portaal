import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { alleRijen } from '@/lib/agenda/server'
import { stelLabelVoor, labelInvoerVoor, klantNamenVoorLabels } from '@/lib/agenda/label-voorstel'

type Admin = SupabaseClient

/**
 * Elke taak die nog geen categorielabel heeft, krijgt er een (stelLabelVoor).
 * Er wordt enkel een label bijgezet: niets verwijderd, geen andere labels
 * weggehaald, geen taak aangepast buiten haar labels. `proef` = enkel tellen
 * en voorbeelden tonen, niets schrijven.
 */
export async function labelAlleTaken(admin: Admin, opts: { proef?: boolean } = {}) {
  const [items, { data: labels }, { data: lijsten }, { data: mappen }, { data: spaces }, { data: klanten }, { data: personen }] = await Promise.all([
    alleRijen<{ id: string; titel: string; soort: 'taak' | 'meeting'; lijst_id: string | null; labels: string[] | null }>((a, b) =>
      admin.from('ag_items').select('id, titel, soort, lijst_id, labels').is('verwijderd_op', null).order('id').range(a, b), 50_000),
    admin.from('ag_labels').select('id, naam, categorie'),
    admin.from('ag_lijsten').select('id, naam, map_id, client_id, space_id'),
    admin.from('ag_mappen').select('id, naam, client_id'),
    admin.from('ag_spaces').select('id, naam'),
    admin.from('clients').select('company_name').is('archived_at', null).limit(3000),
    admin.from('ag_personen').select('naam, actief'),
  ])
  const lb = (labels ?? []) as { id: string; naam: string; categorie: boolean }[]
  const categorie = new Set(lb.filter((l) => l.categorie).map((l) => l.id))
  const idVan = new Map(lb.filter((l) => l.categorie).map((l) => [l.naam.toLowerCase(), l.id]))
  const boom = {
    lijsten: (lijsten ?? []) as { id: string; naam: string; map_id: string | null; client_id: string | null; space_id: string }[],
    mappen: (mappen ?? []) as { id: string; naam: string; client_id: string | null }[],
    spaces: (spaces ?? []) as { id: string; naam: string }[],
  }
  const ctx = {
    klanten: klantNamenVoorLabels(((klanten ?? []) as { company_name: string | null }[]).map((k) => k.company_name)),
    team: [...new Set(((personen ?? []) as { naam: string; actief: boolean }[]).filter((p) => p.actief).map((p) => p.naam.split(' ')[0]).filter((n) => n.length >= 3))],
  }
  const perLabel = new Map<string, string[]>()
  const voorbeelden: Record<string, string[]> = {}
  let al = 0
  for (const i of items) {
    if ((i.labels ?? []).some((l) => categorie.has(l))) { al++; continue }
    const naam = stelLabelVoor(labelInvoerVoor(i, boom), ctx)
    const id = idVan.get(naam.toLowerCase())
    if (!id) continue
    perLabel.set(id, [...(perLabel.get(id) ?? []), i.id])
    if (opts.proef) { const v = (voorbeelden[naam] ??= []); if (v.length < 12) v.push(i.titel.slice(0, 80)) }
  }
  const telling: Record<string, number> = {}
  for (const [id, ids] of perLabel) telling[lb.find((l) => l.id === id)!.naam] = ids.length
  if (opts.proef) return { taken: items.length, alGelabeld: al, telling, voorbeelden }
  let toegevoegd = 0
  for (const [id, ids] of perLabel) {
    for (let n = 0; n < ids.length; n += 500) {
      const { data, error } = await admin.rpc('ag_label_erbij', { p_label: id, p_ids: ids.slice(n, n + 500) })
      if (error) throw new Error(error.message)
      toegevoegd += Number(data ?? 0)
    }
  }
  return { taken: items.length, alGelabeld: al, telling, toegevoegd }
}

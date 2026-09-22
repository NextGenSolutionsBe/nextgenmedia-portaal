import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logLeadEvent } from '@/lib/sales/service'
import { opdrachtRegel, type LeadOpdracht, type OpdrachtInvoer, type OpdrachtKort } from '@/lib/sales/opdrachten-model'

/**
 * Opdrachten op een lead — het databankwerk. De rekenregels (waarde, totalen,
 * bedrag lezen) staan in lib/sales/opdrachten-model.ts.
 *
 * VEERKRACHTIG: zolang de migratie van 22 sep 2026 niet gedraaid is, bestaat
 * `sales_lead_opdrachten` niet. Lezen geeft dan niets terug (het bord valt
 * terug op de dealwaarde), schrijven meldt netjes dat de migratie nodig is.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any>

const TABEL = 'sales_lead_opdrachten'
const KOLOMMEN = 'id, lead_id, titel, bedrag_cents, dienst, notitie, positie, created_at'

export const MIGRATIE_NODIG = 'Opdrachten op leads werken zodra de databankmigratie (22 sep 2026) gedraaid is.'

export function isOntbrekendeTabel(msg: string | null | undefined): boolean {
  return /sales_lead_opdrachten|does not exist|schema cache|relation|PGRST205|PGRST204/i.test(msg ?? '')
}

/**
 * Alle actieve opdrachten, gegroepeerd per lead. Eén gepagineerde query over de
 * hele (kleine) tabel i.p.v. een .in() per blok lead-ids: goedkoper bij een bord
 * van duizenden leads. null = tabel bestaat nog niet.
 */
export async function laadOpdrachtenPerLead(admin: Admin, leadIds?: Set<string>): Promise<Map<string, OpdrachtKort[]> | null> {
  const uit = new Map<string, OpdrachtKort[]>()
  const PAGINA = 1000
  for (let van = 0; van < 50_000; van += PAGINA) {
    const { data, error } = await admin.from(TABEL)
      .select('id, lead_id, titel, bedrag_cents, positie, created_at')
      .is('verwijderd_op', null)
      .order('lead_id', { ascending: true })
      .order('positie', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(van, van + PAGINA - 1)
    if (error) {
      if (isOntbrekendeTabel(error.message)) return null
      throw new Error(error.message)
    }
    const stuk = (data ?? []) as { id: string; lead_id: string; titel: string; bedrag_cents: number | string | null }[]
    for (const r of stuk) {
      if (leadIds && !leadIds.has(r.lead_id)) continue
      const lijst = uit.get(r.lead_id) ?? []
      lijst.push({ id: r.id, titel: r.titel, bedrag_cents: Number(r.bedrag_cents ?? 0) || 0 })
      uit.set(r.lead_id, lijst)
    }
    if (stuk.length < PAGINA) break
  }
  return uit
}

/** De opdrachten van één lead (volledig, voor het detailpaneel). null = tabel ontbreekt. */
export async function laadOpdrachtenVanLead(admin: Admin, leadId: string): Promise<LeadOpdracht[] | null> {
  const { data, error } = await admin.from(TABEL)
    .select(KOLOMMEN)
    .eq('lead_id', leadId).is('verwijderd_op', null)
    .order('positie', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) {
    if (isOntbrekendeTabel(error.message)) return null
    throw new Error(error.message)
  }
  return ((data ?? []) as (LeadOpdracht & { bedrag_cents: number | string })[])
    .map((r) => ({ ...r, bedrag_cents: Number(r.bedrag_cents ?? 0) || 0 }))
}

/** Nieuwe opdracht + tijdlijnregel. */
export async function voegOpdrachtToe(admin: Admin, input: {
  leadId: string
  invoer: Required<Pick<OpdrachtInvoer, 'titel' | 'bedrag_cents'>> & OpdrachtInvoer
  actor: { id: string | null; email: string | null }
}): Promise<{ ok: true; opdracht: LeadOpdracht } | { ok: false; error: string; migratie?: boolean }> {
  const { count } = await admin.from(TABEL)
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', input.leadId).is('verwijderd_op', null)
  const { data, error } = await admin.from(TABEL).insert({
    lead_id: input.leadId,
    titel: input.invoer.titel,
    bedrag_cents: input.invoer.bedrag_cents,
    dienst: input.invoer.dienst ?? null,
    notitie: input.invoer.notitie ?? null,
    positie: count ?? 0,
    created_by: input.actor.id,
  }).select(KOLOMMEN).single()
  if (error || !data) {
    if (error && isOntbrekendeTabel(error.message)) return { ok: false, error: MIGRATIE_NODIG, migratie: true }
    return { ok: false, error: error?.message ?? 'Opdracht toevoegen mislukt' }
  }
  await logLeadEvent(input.leadId, {
    kind: 'system', body: opdrachtRegel('toegevoegd', input.invoer.titel, input.invoer.bedrag_cents),
    actorId: input.actor.id, actorEmail: input.actor.email,
  })
  const r = data as LeadOpdracht & { bedrag_cents: number | string }
  return { ok: true, opdracht: { ...r, bedrag_cents: Number(r.bedrag_cents ?? 0) || 0 } }
}

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { listSalesMedewerkers } from '@/lib/sales/medewerkers'
import { leesActorNamen } from '@/lib/actor-namen'
import { berekenPrestaties, ONBEKEND, type PActiviteit, type PAfspraak, type PLead, type PUitkomst } from '@/lib/sales/prestaties'

/**
 * Ophaalwerk voor de salesprestaties (rekenen: lib/sales/prestaties.ts).
 * Enkel wat betrouwbaar geregistreerd is; ontbrekende historiek wordt apart
 * gemeld (bv. gesprekken zonder bron, afspraken nog niet bevestigd), nooit als 0.
 */

const PAGINA = 1000
const MAX = 50_000

async function allePaginas<T>(bouw: (van: number, tot: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const uit: T[] = []
  for (let van = 0; van < MAX; van += PAGINA) {
    const { data, error } = await bouw(van, van + PAGINA - 1)
    if (error) throw new Error(error.message)
    uit.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGINA) break
  }
  return uit
}

export type PrestatieData = PUitkomst & {
  namen: Record<string, string>
  /** Sinds wanneer gesprekken hun bron (Focus Mode) krijgen — daarvoor: "zonder bron". */
  bronSinds: string | null
}

export async function laadPrestaties(admin: SupabaseClient, van: Date, tot: Date): Promise<PrestatieData> {
  const org = await getOrCreateSalesOrg()
  const vanIso = van.toISOString(), totIso = tot.toISOString()

  // 1) Gesprekken en faseverplaatsingen in de periode (zacht verwijderd telt niet).
  const activiteiten = await allePaginas<PActiviteit>((a, b) => admin.from('sales_activiteiten')
    .select('id, lead_id, medewerker_id, type, uitkomst, bron, van_fase, naar_fase, gesprek_start, gesprek_eind, created_at')
    .in('type', ['telefoongesprek', 'fase_gewijzigd']).is('verwijderd_op', null)
    .gte('created_at', vanIso).lt('created_at', totIso)
    .order('created_at').order('id').range(a, b))

  // Oude belregistraties van vóór de activiteitentabel: gesprek zonder bron/uitkomst.
  const { data: eerste } = await admin.from('sales_activiteiten').select('created_at').order('created_at').limit(1).maybeSingle()
  const legacyTot = (eerste as { created_at?: string } | null)?.created_at ?? totIso
  if (legacyTot > vanIso) {
    const oud = await allePaginas<{ id: string; lead_id: string; actor_id: string | null; created_at: string }>((a, b) => admin.from('sales_lead_events')
      .select('id, lead_id, actor_id, created_at').eq('kind', 'call')
      .gte('created_at', vanIso).lt('created_at', legacyTot < totIso ? legacyTot : totIso)
      .order('created_at').order('id').range(a, b))
    for (const e of oud) activiteiten.push({ id: `oud-${e.id}`, lead_id: e.lead_id, medewerker_id: e.actor_id, type: 'telefoongesprek', bron: null, uitkomst: null, created_at: e.created_at })
  }

  // 2) Afspraken van deze organisatie (alle: gehouden afspraken bepalen de closer).
  const afspraken = await allePaginas<PAfspraak>((a, b) => admin.from('sales_appointments')
    .select('id, lead_id, setter_id, verantwoordelijke_id, starts_at, status, aanwezigheid, outcome, created_at')
    .eq('sales_client_id', org.id).order('created_at').order('id').range(a, b))

  // 3) Gesloten leads (gewonnen/verloren), ook gearchiveerde: de uitkomst blijft gebeurd.
  const leads = await allePaginas<PLead>((a, b) => admin.from('sales_leads')
    .select('id, stage_key, assigned_to, gesloten_op')
    .eq('sales_client_id', org.id).in('stage_key', ['gewonnen', 'verloren'])
    .order('id').range(a, b))

  const uitkomst = berekenPrestaties({ activiteiten, afspraken, leads, van: vanIso, tot: totIso, nu: new Date().toISOString() })

  // Namen: sales-medewerkers, aangevuld met elke andere gebruiker die voorkomt.
  const namen: Record<string, string> = {}
  for (const m of await listSalesMedewerkers()) namen[m.id] = m.naam
  const ontbreekt = uitkomst.perMedewerker.map((r) => r.sleutel).filter((k) => k !== ONBEKEND && !namen[k])
  if (ontbreekt.length) {
    const extra = await leesActorNamen(admin, ontbreekt)
    for (const [k, v] of Object.entries(extra)) namen[k] = v.naam
  }
  namen[ONBEKEND] = 'Niet toegewezen'

  const { data: bron } = await admin.from('sales_activiteiten').select('created_at').not('bron', 'is', null).order('created_at').limit(1).maybeSingle()
  return { ...uitkomst, namen, bronSinds: (bron as { created_at?: string } | null)?.created_at ?? null }
}

/** Voor het correctiescherm: afspraken en registraties in de periode, met leesbare namen. */
export async function laadRegistraties(admin: SupabaseClient, van: Date, tot: Date) {
  const org = await getOrCreateSalesOrg()
  const vanIso = van.toISOString(), totIso = tot.toISOString()
  const [{ data: afs }, { data: acts }, { data: corr }] = await Promise.all([
    admin.from('sales_appointments')
      .select('id, lead_id, setter_id, verantwoordelijke_id, starts_at, status, aanwezigheid, outcome')
      .eq('sales_client_id', org.id).neq('status', 'cancelled').gte('starts_at', vanIso).lt('starts_at', totIso)
      .order('starts_at', { ascending: false }).limit(300),
    admin.from('sales_activiteiten')
      .select('id, lead_id, medewerker_id, type, uitkomst, bron, van_fase, naar_fase, gesprek_start, gesprek_eind, created_at')
      .in('type', ['telefoongesprek', 'fase_gewijzigd']).is('verwijderd_op', null)
      .gte('created_at', vanIso).lt('created_at', totIso).order('created_at', { ascending: false }).limit(300),
    admin.from('sales_stat_correcties').select('*').order('created_at', { ascending: false }).limit(50),
  ])
  const leadIds = [...new Set([...(afs ?? []), ...(acts ?? [])].map((r) => (r as { lead_id: string | null }).lead_id).filter((x): x is string => !!x))]
  const leadNaam: Record<string, string> = {}
  for (let i = 0; i < leadIds.length; i += 300) {
    const { data } = await admin.from('sales_leads').select('id, sales_companies ( name )').in('id', leadIds.slice(i, i + 300))
    for (const l of (data ?? []) as unknown as { id: string; sales_companies: { name: string | null } | null }[]) leadNaam[l.id] = l.sales_companies?.name ?? '—'
  }
  return { afspraken: afs ?? [], activiteiten: acts ?? [], correcties: corr ?? [], leadNaam }
}

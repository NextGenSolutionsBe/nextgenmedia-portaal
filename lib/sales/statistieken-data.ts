import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { listSalesMedewerkers } from '@/lib/sales/medewerkers'
import {
  bereken, kiesTrendPer, legacyGesprekken,
  type LegacyGesprek, type StatActiviteit, type StatFilter, type StatLead, type StatMedewerker,
  type Statistieken, type TrendPer,
} from '@/lib/sales/statistieken'

/**
 * Het ophaalwerk achter de statistiekenpagina. Het rekenen zelf gebeurt in
 * lib/sales/statistieken.ts (puur, getest).
 *
 * BRON: sales_activiteiten (niet zacht verwijderd), gefilterd op het moment
 * van registreren. Oude belregistraties (sales_lead_events kind='call') van
 * vóór de eerste activiteitenrij tellen mee als telefoongesprek zonder duur.
 * Bestaat de tabel nog niet (migratie niet gedraaid), dan tellen enkel die
 * oude belregistraties.
 */

export type Periode = { van: Date; tot: Date }

/** De maand waarin `d` valt. */
export function maandPeriode(d = new Date()): Periode {
  return {
    van: new Date(d.getFullYear(), d.getMonth(), 1),
    tot: new Date(d.getFullYear(), d.getMonth() + 1, 1),
  }
}

/** Losse datums uit de URL (tot en met), met de huidige maand als terugval. */
export function leesPeriode(van: string | null, tot: string | null): Periode {
  const a = van ? new Date(`${van}T00:00:00`) : null
  const b = tot ? new Date(`${tot}T00:00:00`) : null
  if (!a || Number.isNaN(a.getTime()) || !b || Number.isNaN(b.getTime())) return maandPeriode()
  const [start, eind] = a <= b ? [a, b] : [b, a]
  return { van: start, tot: new Date(eind.getFullYear(), eind.getMonth(), eind.getDate() + 1) }
}

export type Filter = StatFilter & { periode: Periode; trendPer?: TrendPer }

export type Uitkomst = {
  stats: Statistieken
  medewerkers: StatMedewerker[]
  /** false = sales_activiteiten bestaat nog niet; enkel oude belregistraties. */
  metActiviteiten: boolean
}

const BLOK = 500
const PAGINA = 1000
const MAX_RIJEN = 50_000

function isTabelFout(msg: string): boolean {
  return /sales_activiteiten|does not exist|schema cache|relation/i.test(msg)
}

export async function laadStatistieken(filter: Filter): Promise<Uitkomst> {
  const admin = createAdminSupabaseClient()
  const org = await getOrCreateSalesOrg()
  const vanIso = filter.periode.van.toISOString()
  const totIso = filter.periode.tot.toISOString()

  // ── 1) Wanneer begon de activiteitenregistratie? ─────────────────────────
  let metActiviteiten = true
  let eersteActiviteitOp: string | null = null
  {
    const { data, error } = await admin.from('sales_activiteiten')
      .select('created_at').order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (error) {
      if (!isTabelFout(error.message)) throw new Error(error.message)
      metActiviteiten = false
    } else {
      eersteActiviteitOp = (data as { created_at: string } | null)?.created_at ?? null
    }
  }

  // ── 2) Activiteiten in de periode ────────────────────────────────────────
  const activiteiten: StatActiviteit[] = []
  if (metActiviteiten) {
    for (let van = 0; van < MAX_RIJEN; van += PAGINA) {
      let q = admin.from('sales_activiteiten')
        .select('id, lead_id, medewerker_id, medewerker_email, type, duur_seconden, uitkomst, afspraak_id, created_at, verwijderd_op')
        .is('verwijderd_op', null)
        .gte('created_at', vanIso).lt('created_at', totIso)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(van, van + PAGINA - 1)
      if (filter.medewerkerId) q = q.eq('medewerker_id', filter.medewerkerId)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      const stuk = (data ?? []) as StatActiviteit[]
      activiteiten.push(...stuk)
      if (stuk.length < PAGINA) break
    }
  }

  // ── 3) Oude belregistraties van vóór de eerste activiteit ────────────────
  const legacy: LegacyGesprek[] = []
  const legacyTot = eersteActiviteitOp && eersteActiviteitOp < totIso ? eersteActiviteitOp : totIso
  if (legacyTot > vanIso) {
    for (let van = 0; van < MAX_RIJEN; van += PAGINA) {
      let q = admin.from('sales_lead_events')
        .select('id, lead_id, actor_id, actor_email, created_at')
        .eq('kind', 'call')
        .gte('created_at', vanIso).lt('created_at', legacyTot)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(van, van + PAGINA - 1)
      if (filter.medewerkerId) q = q.eq('actor_id', filter.medewerkerId)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      const stuk = (data ?? []) as LegacyGesprek[]
      legacy.push(...stuk)
      if (stuk.length < PAGINA) break
    }
  }
  const alles = [...activiteiten, ...legacyGesprekken(legacy, eersteActiviteitOp)]

  // ── 4) De leads erbij (leadbron, dienst, dealwaarde), enkel van onze org ──
  const leadIds = [...new Set(alles.map((a) => a.lead_id).filter(Boolean))]
  const leads: StatLead[] = []
  let breed = true
  for (let i = 0; i < leadIds.length; i += BLOK) {
    const ids = leadIds.slice(i, i + BLOK)
    let rijen: Record<string, unknown>[] = []
    if (breed) {
      const { data, error } = await admin.from('sales_leads')
        .select('id, leadbron, dienst, deal_waarde_cents, labels')
        .eq('sales_client_id', org.id).in('id', ids)
      if (error) breed = false
      else rijen = (data ?? []) as Record<string, unknown>[]
    }
    if (!breed) {
      const { data, error } = await admin.from('sales_leads')
        .select('id, labels').eq('sales_client_id', org.id).in('id', ids)
      if (error) throw new Error(error.message)
      rijen = (data ?? []) as Record<string, unknown>[]
    }
    for (const r of rijen) {
      const labels = Array.isArray(r.labels) ? (r.labels as string[]) : []
      let bron = typeof r.leadbron === 'string' ? r.leadbron : null
      // Harrie-leads van vóór de leadbron-kolom herkennen aan hun label.
      if ((!bron || bron === 'outbound') && labels.includes('Harrie')) bron = 'harrie'
      leads.push({
        id: String(r.id),
        leadbron: bron,
        dienst: typeof r.dienst === 'string' ? r.dienst : null,
        deal_waarde_cents: typeof r.deal_waarde_cents === 'number' ? r.deal_waarde_cents : null,
      })
    }
  }
  const bekend = new Set(leads.map((l) => l.id))
  const eigen = alles.filter((a) => bekend.has(a.lead_id))

  // ── 5) Geannuleerde afspraken tellen niet ────────────────────────────────
  const afspraakIds = [...new Set(eigen.map((a) => a.afspraak_id).filter((x): x is string => !!x))]
  const geannuleerd: string[] = []
  for (let i = 0; i < afspraakIds.length; i += BLOK) {
    const { data } = await admin.from('sales_appointments')
      .select('id, status').in('id', afspraakIds.slice(i, i + BLOK))
    for (const r of (data ?? []) as { id: string; status: string }[]) {
      if (r.status === 'cancelled') geannuleerd.push(r.id)
    }
  }

  const medewerkers = await listSalesMedewerkers()
  const dagen = Math.max(1, Math.round((filter.periode.tot.getTime() - filter.periode.van.getTime()) / 86_400_000))

  const stats = bereken({
    activiteiten: eigen,
    leads,
    medewerkers,
    geannuleerdeAfspraken: geannuleerd,
    trendPer: filter.trendPer ?? kiesTrendPer(dagen),
  }, {
    // De medewerker is al in de query gefilterd; de rest hier.
    richting: filter.richting, dienst: filter.dienst, leadbron: filter.leadbron,
  })

  return { stats, medewerkers, metActiviteiten }
}

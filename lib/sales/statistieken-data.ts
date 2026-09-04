import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { listSetters } from '@/lib/sales/setters'
import {
  bereken, berekenLeadInteresse,
  type AfspraakRij, type BedrijfRij, type GesprekRij, type LeadRij,
  type LeadInteresseRij, type SectorInteresse, type Statistieken,
} from '@/lib/sales/statistieken'
import { redenGroep } from '@/lib/sales/redenen'

/**
 * Het ophaalwerk achter de statistiekenpagina.
 *
 * Los van lib/sales/statistieken.ts, dat alleen rekent. Die scheiding is niet
 * netheid om de netheid: de rekenkant is zo te testen zonder database, en dat
 * is bij conversiecijfers het verschil tussen "het ziet er plausibel uit" en
 * "het klopt".
 *
 * WELK VENSTER. Een afspraak telt mee in de periode waarin ze GEPLAND STAAT,
 * met de uitkomst die er nu op staat — ook als die later is ingevuld. Dat
 * beantwoordt de vraag waar dit scherm over gaat: "van de afspraken die ik in
 * maart boekte, hoeveel werden er klant?". Voor het GELD geldt een ander
 * venster (de maand van afsluiten); dat staat in lib/sales/setters.ts en hoort
 * daar ook thuis.
 */

export type Periode = { van: Date; tot: Date }

/** De maand waarin `d` valt. */
export function maandPeriode(d = new Date()): Periode {
  return {
    van: new Date(d.getFullYear(), d.getMonth(), 1),
    tot: new Date(d.getFullYear(), d.getMonth() + 1, 1),
  }
}

/** Losse datums uit de URL, met de huidige maand als terugval. */
export function leesPeriode(van: string | null, tot: string | null): Periode {
  const a = van ? new Date(`${van}T00:00:00`) : null
  const b = tot ? new Date(`${tot}T00:00:00`) : null
  if (!a || Number.isNaN(a.getTime()) || !b || Number.isNaN(b.getTime())) return maandPeriode()
  // Omgedraaid ingevuld: stilzwijgend rechtzetten in plaats van een lege pagina.
  const [start, eind] = a <= b ? [a, b] : [b, a]
  // `tot` is exclusief; de gekozen einddag hoort er wél bij.
  return { van: start, tot: new Date(eind.getFullYear(), eind.getMonth(), eind.getDate() + 1) }
}

export type Filter = {
  periode: Periode
  /** Beperken tot één setterprofiel. Verplicht voor wie zelf setter is. */
  setterId?: string
  /** Alleen deze sector. */
  sector?: string
}

export type Uitkomst = {
  stats: Statistieken
  setters: { id: string; naam: string }[]
  sectoren: string[]
  /**
   * Interesse per sector op LEADNIVEAU — de huidige stand van de hele
   * pipeline, niet periode-gebonden. Beantwoordt "hoeveel procent van de
   * bouwbedrijven is geïnteresseerd?" en waarom de rest afhaakte.
   */
  leadInteresse: { perSector: SectorInteresse[]; redenen: { reden: string; aantal: number }[] }
}

export async function laadStatistieken(filter: Filter): Promise<Uitkomst> {
  const admin = createAdminSupabaseClient()
  const org = await getOrCreateSalesOrg()
  const vanIso = filter.periode.van.toISOString()
  const totIso = filter.periode.tot.toISOString()

  const alleSetters = await listSetters()
  const setterLijst = alleSetters.map((s) => ({ id: s.id, naam: s.name }))
  const authVanSetter = new Map(alleSetters.map((s) => [s.id, s.auth_user_id]))

  // ── Afspraken ────────────────────────────────────────────────────────────
  let afspraakVraag = admin
    .from('sales_appointments')
    .select('id, lead_id, setter_profile_id, setter_id, status, outcome, outcome_reason, deal_value_cents, starts_at')
    .eq('sales_client_id', org.id)
    .gte('starts_at', vanIso)
    .lt('starts_at', totIso)
  if (filter.setterId) {
    // Op BEIDE velden filteren: een nog openstaande afspraak heeft alleen
    // setter_id ingevuld. Enkel op setter_profile_id filteren laat precies de
    // afspraken weg die nog moeten worden opgevolgd.
    const auth = authVanSetter.get(filter.setterId)
    afspraakVraag = auth
      ? afspraakVraag.or(`setter_profile_id.eq.${filter.setterId},setter_id.eq.${auth}`)
      : afspraakVraag.eq('setter_profile_id', filter.setterId)
  }

  // ── Gesprekken ───────────────────────────────────────────────────────────
  // sales_lead_events heeft geen org-kolom; we schiften straks op de leads.
  let gesprekVraag = admin
    .from('sales_lead_events')
    .select('lead_id, actor_id, created_at')
    .eq('kind', 'call')
    .gte('created_at', vanIso)
    .lt('created_at', totIso)
    .limit(20000)
  if (filter.setterId) {
    const auth = authVanSetter.get(filter.setterId)
    // Geen gekoppelde auth-gebruiker betekent dat er geen gesprek aan deze
    // setter te hangen valt. Dan liever niets dan andermans gesprekken.
    gesprekVraag = gesprekVraag.eq('actor_id', auth ?? '00000000-0000-0000-0000-000000000000')
  }

  const [{ data: afspraakData, error: afspraakFout }, { data: gesprekData }] =
    await Promise.all([afspraakVraag, gesprekVraag])

  if (afspraakFout) throw new Error(afspraakFout.message)

  const afspraken = (afspraakData ?? []) as AfspraakRij[]
  const ruweGesprekken = (gesprekData ?? []) as GesprekRij[]

  // ── Leads en bedrijven erbij ─────────────────────────────────────────────
  const leadIds = [...new Set([
    ...afspraken.map((a) => a.lead_id).filter((x): x is string => !!x),
    ...ruweGesprekken.map((g) => g.lead_id).filter(Boolean),
  ])]

  let leads: LeadRij[] = []
  if (leadIds.length > 0) {
    // In blokken opvragen: één `in`-filter met duizenden waarden geeft een
    // URL die de database weigert.
    for (let i = 0; i < leadIds.length; i += 500) {
      const { data } = await admin
        .from('sales_leads')
        .select('id, company_id, source, lost_reason')
        .eq('sales_client_id', org.id)
        .in('id', leadIds.slice(i, i + 500))
      leads.push(...((data ?? []) as LeadRij[]))
    }
  }

  const bedrijfIds = [...new Set(leads.map((l) => l.company_id).filter((x): x is string => !!x))]
  const bedrijven: BedrijfRij[] = []
  for (let i = 0; i < bedrijfIds.length; i += 500) {
    const { data } = await admin
      .from('sales_companies')
      .select('id, sector')
      .in('id', bedrijfIds.slice(i, i + 500))
    bedrijven.push(...((data ?? []) as BedrijfRij[]))
  }

  // Gesprekken van leads buiten deze organisatie horen hier niet bij.
  const bekend = new Set(leads.map((l) => l.id))
  let gesprekken = ruweGesprekken.filter((g) => bekend.has(g.lead_id))

  // ── Sectorfilter ─────────────────────────────────────────────────────────
  const sectorVanBedrijf = new Map(bedrijven.map((b) => [b.id, b.sector?.trim() || 'Onbekend']))
  const sectorVanLead = new Map(
    leads.map((l) => [l.id, (l.company_id ? sectorVanBedrijf.get(l.company_id) : null) ?? 'Onbekend']),
  )

  // De keuzelijst toont álle sectoren van de periode, ook als er nu op één
  // gefilterd wordt — anders kan je na het filteren niet meer terug.
  const sectoren = [...new Set(sectorVanLead.values())].sort((a, b) => a.localeCompare(b))

  let gefilterdeAfspraken = afspraken
  if (filter.sector) {
    const hoort = (leadId: string | null) => !!leadId && sectorVanLead.get(leadId) === filter.sector
    gefilterdeAfspraken = afspraken.filter((a) => hoort(a.lead_id))
    gesprekken = gesprekken.filter((g) => hoort(g.lead_id))
    leads = leads.filter((l) => sectorVanLead.get(l.id) === filter.sector)
  }

  const stats = bereken({
    afspraken: gefilterdeAfspraken,
    gesprekken,
    leads,
    bedrijven,
    setters: alleSetters.map((s) => ({ id: s.id, naam: s.name, auth_user_id: s.auth_user_id })),
  })

  // ── Interesse op leadniveau: de HELE actieve pipeline, niet de periode ────
  const { data: alleLeadData } = await admin
    .from('sales_leads')
    .select('id, company_id, stage_key, lost_reason')
    .eq('sales_client_id', org.id)
    .is('archived_at', null)
    .limit(10000)
  const alleLeads = (alleLeadData ?? []) as LeadInteresseRij[]

  // Sectoren van bedrijven die nog niet geladen waren erbij halen, in blokken.
  const bekendeBedrijven = new Set(bedrijven.map((b) => b.id))
  const missendeIds = [...new Set(
    alleLeads.map((l) => l.company_id).filter((x): x is string => !!x && !bekendeBedrijven.has(x)),
  )]
  const alleBedrijven = [...bedrijven]
  for (let i = 0; i < missendeIds.length; i += 500) {
    const { data } = await admin
      .from('sales_companies').select('id, sector')
      .in('id', missendeIds.slice(i, i + 500))
    alleBedrijven.push(...((data ?? []) as BedrijfRij[]))
  }

  const leadInteresse = berekenLeadInteresse(alleLeads, alleBedrijven, redenGroep)

  return { stats, setters: setterLijst, sectoren, leadInteresse }
}

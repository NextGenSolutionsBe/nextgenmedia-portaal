import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logLeadEvent, getOrCreateSalesOrg } from '@/lib/sales/service'
import { defaultPipelineId } from '@/lib/sales/pipelines'
import { companyDedupeKey } from '@/lib/sales/dedupe'
import { opdrachtRegel, OUDE_STATUS_NAAR_FASE, type LeadOpdracht, type OpdrachtInvoer, type OpdrachtKort } from '@/lib/sales/opdrachten-model'

/**
 * Opdrachten op een lead. ÉÉN BRON: de tabel `opdrachten` (de Opdrachten-
 * pagina, per klant meerdere opdrachten met status, deadline, contract en
 * factuur). De pipeline toont per lead de opdrachten met `opdrachten.lead_id`
 * en telt hun bedrag op; geannuleerde en afgewezen opdrachten tellen niet mee.
 *
 * Een opdracht zonder lead wordt automatisch gekoppeld aan de lead van dezelfde
 * klant (zelfde bedrijfssleutel) of krijgt een nieuwe lead — zie koppelAanLead.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any>

const TABEL = 'opdrachten'
/** Deze statussen tellen niet mee in de waarde van een lead en verschijnen niet op het bord. */
export const NIET_ACTIEF = ['geannuleerd', 'geen_interesse']

export const MIGRATIE_NODIG = 'De opdrachtentabel is niet beschikbaar.'

export function isOntbrekendeTabel(msg: string | null | undefined): boolean {
  return /does not exist|schema cache|relation|PGRST205|PGRST204|lead_id|bedrag_excl/i.test(msg ?? '')
}

type Rij = { id: string; lead_id: string; titel: string; bedrag_excl: number | string | null; omschrijving: string | null; status: string; created_at: string }
const naarCents = (v: number | string | null | undefined) => Math.max(0, Math.round((Number(v) || 0) * 100))

/** Alle actieve opdrachten die aan een lead hangen, gegroepeerd per lead. null = kolommen ontbreken. */
export async function laadOpdrachtenPerLead(admin: Admin, leadIds?: Set<string>): Promise<Map<string, OpdrachtKort[]> | null> {
  const uit = new Map<string, OpdrachtKort[]>()
  const PAGINA = 1000
  for (let van = 0; van < 50_000; van += PAGINA) {
    const { data, error } = await admin.from(TABEL)
      .select('id, lead_id, titel, bedrag_excl, status, created_at')
      .not('lead_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(van, van + PAGINA - 1)
    if (error) {
      if (isOntbrekendeTabel(error.message)) return null
      throw new Error(error.message)
    }
    const stuk = (data ?? []) as Rij[]
    for (const r of stuk) {
      if (NIET_ACTIEF.includes(r.status)) continue
      if (leadIds && !leadIds.has(r.lead_id)) continue
      const lijst = uit.get(r.lead_id) ?? []
      lijst.push({ id: r.id, titel: r.titel, bedrag_cents: naarCents(r.bedrag_excl) })
      uit.set(r.lead_id, lijst)
    }
    if (stuk.length < PAGINA) break
  }
  return uit
}

/** De opdrachten van één lead (voor het detailpaneel). null = kolommen ontbreken. */
export async function laadOpdrachtenVanLead(admin: Admin, leadId: string): Promise<(LeadOpdracht & { status: string })[] | null> {
  const { data, error } = await admin.from(TABEL)
    .select('id, lead_id, titel, bedrag_excl, omschrijving, status, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
  if (error) {
    if (isOntbrekendeTabel(error.message)) return null
    throw new Error(error.message)
  }
  return ((data ?? []) as Rij[])
    .filter((r) => !NIET_ACTIEF.includes(r.status))
    .map((r) => ({ id: r.id, lead_id: r.lead_id, titel: r.titel, bedrag_cents: naarCents(r.bedrag_excl), notitie: r.omschrijving, created_at: r.created_at, status: r.status }))
}

/** Nieuwe opdracht vanuit de pipeline: een gewone opdracht (verschijnt ook op de Opdrachten-pagina), gekoppeld aan de lead. */
export async function voegOpdrachtToe(admin: Admin, input: {
  leadId: string
  invoer: Required<Pick<OpdrachtInvoer, 'titel' | 'bedrag_cents'>> & OpdrachtInvoer
  actor: { id: string | null; email: string | null }
}): Promise<{ ok: true; opdracht: LeadOpdracht } | { ok: false; error: string; migratie?: boolean }> {
  // Klantnaam voor de Opdrachten-pagina: de naam van het bedrijf van de lead.
  const { data: lead } = await admin.from('sales_leads').select('id, company:sales_companies(name)').eq('id', input.leadId).maybeSingle()
  const bedrijf = (lead as { company?: { name?: string | null } | null } | null)?.company?.name ?? null
  const nu = new Date().toISOString()
  const { data, error } = await admin.from(TABEL).insert({
    titel: input.invoer.titel,
    bedrag_excl: input.invoer.bedrag_cents / 100,
    omschrijving: input.invoer.notitie ?? null,
    status: 'open',
    lead_id: input.leadId,
    klant_vrij: bedrijf,
    aangemaakt_door_email: input.actor.email,
    status_bron: 'handmatig',
    status_gewijzigd_op: nu,
  }).select('id, lead_id, titel, bedrag_excl, omschrijving, created_at').single()
  if (error || !data) {
    if (error && isOntbrekendeTabel(error.message)) return { ok: false, error: MIGRATIE_NODIG, migratie: true }
    return { ok: false, error: error?.message ?? 'Opdracht toevoegen mislukt' }
  }
  await logLeadEvent(input.leadId, {
    kind: 'system', body: opdrachtRegel('toegevoegd', input.invoer.titel, input.invoer.bedrag_cents),
    actorId: input.actor.id, actorEmail: input.actor.email,
  })
  const r = data as Rij
  return { ok: true, opdracht: { id: r.id, lead_id: r.lead_id, titel: r.titel, bedrag_cents: naarCents(r.bedrag_excl), notitie: r.omschrijving, created_at: r.created_at } }
}

/**
 * Koppel een opdracht zonder lead aan de pipeline: de actieve lead van hetzelfde
 * bedrijf (zelfde bedrijfssleutel als createLead), anders een nieuwe lead in de
 * fase die bij de status van de opdracht past. Geeft de lead-id terug (of null
 * als er geen naam is om op te koppelen). Faalt stil: een opdracht bewaren mag
 * nooit mislukken omdat de koppeling niet lukt.
 */
export async function koppelAanLead(admin: Admin, opdrachtId: string, actor?: { id: string | null; email: string | null }): Promise<string | null> {
  try {
    const { data: o } = await admin.from(TABEL).select('id, titel, status, client_id, klant_vrij, lead_id, bedrag_excl').eq('id', opdrachtId).maybeSingle()
    if (!o || o.lead_id) return (o?.lead_id as string | null) ?? null
    let naam: string | null = null
    if (o.client_id) {
      const { data: c } = await admin.from('clients').select('company_name').eq('id', o.client_id).maybeSingle()
      naam = (c?.company_name as string | null) ?? null
    }
    naam = (naam || o.klant_vrij || '').trim()
    if (!naam) return null
    const org = await getOrCreateSalesOrg()
    const dedupe = companyDedupeKey(naam, null)
    let { data: bedrijf } = await admin.from('sales_companies').select('id').eq('sales_client_id', org.id).eq('dedupe_key', dedupe).maybeSingle()
    if (!bedrijf) {
      const ins = await admin.from('sales_companies').insert({ sales_client_id: org.id, name: naam, dedupe_key: dedupe }).select('id').single()
      bedrijf = ins.data ?? (await admin.from('sales_companies').select('id').eq('sales_client_id', org.id).eq('dedupe_key', dedupe).maybeSingle()).data
    }
    if (!bedrijf) return null
    const { data: bestaand } = await admin.from('sales_leads').select('id').eq('sales_client_id', org.id).eq('company_id', bedrijf.id).is('archived_at', null).order('created_at', { ascending: true }).limit(1).maybeSingle()
    let leadId = (bestaand?.id as string | undefined) ?? null
    if (!leadId) {
      const fase = OUDE_STATUS_NAAR_FASE[String(o.status)] ?? 'inbound'
      const rij: Record<string, unknown> = {
        sales_client_id: org.id, pipeline_id: (await defaultPipelineId()) || null, company_id: bedrijf.id, stage_key: fase,
        labels: ['Opdracht'], leadbron: 'manueel', gesloten_op: fase === 'gewonnen' || fase === 'verloren' ? new Date().toISOString() : null,
      }
      let ins = await admin.from('sales_leads').insert(rij).select('id').single()
      if (ins.error && /leadbron|gesloten_op|schema cache|PGRST204/i.test(ins.error.message)) {
        delete rij.leadbron; delete rij.gesloten_op
        ins = await admin.from('sales_leads').insert(rij).select('id').single()
      }
      if (ins.error || !ins.data) return null
      leadId = String(ins.data.id)
      await logLeadEvent(leadId, { kind: 'system', body: 'Lead aangemaakt vanuit een opdracht', actorId: actor?.id ?? null, actorEmail: actor?.email ?? null })
    }
    await admin.from(TABEL).update({ lead_id: leadId }).eq('id', opdrachtId).is('lead_id', null)
    await logLeadEvent(leadId, { kind: 'system', body: opdrachtRegel('toegevoegd', String(o.titel), naarCents(o.bedrag_excl as number | null)), actorId: actor?.id ?? null, actorEmail: actor?.email ?? null })
    return leadId
  } catch {
    return null
  }
}

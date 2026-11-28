import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { bedrijfVan } from '@/lib/opdrachten-kanban'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { faseVoorKaart, bronVoorKaart, type SolutionsKaart } from './solutions-kaarten'

type Admin = ReturnType<typeof createAdminSupabaseClient>
export class SolutionsKaartFout extends Error { constructor(m: string, public status = 400) { super(m) } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

type Rij = { id: string; titel: string | null; status: string; merk: string | null; diensten: string[] | null; client_id: string | null; klant_vrij: string | null
  verantwoordelijke: string | null; bedrag_excl: number | null; bron: string | null; omschrijving: string | null; stop_reden: string | null; datum: string | null
  ngs_keuze?: string | null; ngs_deal_id?: string | null }

/** Alle kaarten op Projecten die bij NextGenSolutions horen (ook de al verhuisde, met een link naar de deal). */
export async function solutionsKaarten(admin: Admin): Promise<SolutionsKaart[]> {
  const { data, error } = await admin.from('opdrachten')
    .select('id, titel, status, merk, diensten, client_id, klant_vrij, verantwoordelijke, bedrag_excl, bron, omschrijving, stop_reden, datum, ngs_keuze, ngs_deal_id')
    .limit(2000)
  if (error) return []
  const rijen = ((data ?? []) as Rij[]).filter((r) => bedrijfVan(r.merk, r.diensten ?? []) === 'nextgensolutions')
  const klantIds = [...new Set(rijen.map((r) => r.client_id).filter(Boolean))] as string[]
  const { data: k } = klantIds.length ? await admin.from('clients').select('id, company_name').in('id', klantIds) : { data: [] }
  const naam = new Map(((k ?? []) as { id: string; company_name: string | null }[]).map((x) => [x.id, x.company_name]))
  return rijen.map((r): SolutionsKaart => ({
    id: r.id, titel: r.titel ?? 'Project', klant: (r.client_id ? naam.get(r.client_id) : null) ?? r.klant_vrij ?? null, status: r.status, fase: faseVoorKaart(r.status),
    verantwoordelijke: r.verantwoordelijke, bedrag: r.bedrag_excl === null ? null : Number(r.bedrag_excl),
    keuze: r.ngs_keuze === 'verhuisd' ? 'verhuisd' : r.ngs_keuze === 'laten' ? 'laten' : null, deal_id: r.ngs_deal_id ?? null,
  })).sort((a, b) => Number(!!a.keuze) - Number(!!b.keuze) || (a.klant ?? '').localeCompare(b.klant ?? ''))
}

/**
 * Een kaart verhuizen: één deal in de passende fase (Won met de datum, Lost met de
 * reden), met de notities van de kaart. De kaart blijft bewaard (ngs_keuze =
 * verhuisd, link naar de deal) en verdwijnt van het bord. Twee keer = één deal.
 */
export async function verhuisKaart(admin: Admin, id: string, door: string | null): Promise<string> {
  if (!UUID.test(id)) throw new SolutionsKaartFout('Kaart niet gevonden.', 404)
  const { data } = await admin.from('opdrachten')
    .select('id, titel, status, merk, diensten, client_id, klant_vrij, verantwoordelijke, bedrag_excl, bron, omschrijving, stop_reden, datum, ngs_keuze, ngs_deal_id').eq('id', id).maybeSingle()
  const r = data as Rij | null
  if (!r) throw new SolutionsKaartFout('Kaart niet gevonden.', 404)
  if (r.ngs_deal_id) return r.ngs_deal_id
  // Eerst vastnemen: wie twee keer klikt, maakt geen tweede deal.
  const { data: genomen } = await admin.from('opdrachten').update({ ngs_keuze: 'verhuisd' }).eq('id', id).is('ngs_deal_id', null).or('ngs_keuze.is.null,ngs_keuze.eq.laten').select('id')
  if (!(genomen ?? []).length) throw new SolutionsKaartFout('Deze kaart wordt al verhuisd.', 409)
  let klant = r.klant_vrij
  if (r.client_id) { const { data: c } = await admin.from('clients').select('company_name').eq('id', r.client_id).maybeSingle(); klant = (c as { company_name?: string | null } | null)?.company_name ?? klant }
  const fase = faseVoorKaart(r.status)
  const dag = (r.datum ?? vandaag()).slice(0, 10)
  const nu = new Date().toISOString()
  const rij: Record<string, unknown> = {
    bedrijf: String(klant || r.titel || 'Klant').slice(0, 160), titel: [r.titel, r.omschrijving].filter(Boolean).join('\n').slice(0, 2000) || null,
    diensten: [], fase, fase_sinds: nu, bron: bronVoorKaart(r.bron), verantwoordelijke: r.verantwoordelijke, client_id: r.client_id,
    waarde_eenmalig: r.bedrag_excl ?? null, created_by: door,
    ...(fase === 'won' ? { gewonnen_op: dag > vandaag() ? vandaag() : dag, start_datum: dag } : {}),
    ...(fase === 'lost' ? { verloren_op: vandaag(), verloren_reden: r.stop_reden || 'Verhuisd van Projecten (geen reden genoteerd)' } : {}),
  }
  const { data: deal, error } = await admin.from('ngs_deals').insert(rij).select('id').single()
  if (error || !deal) {
    await admin.from('opdrachten').update({ ngs_keuze: null }).eq('id', id)
    throw new Error(error?.message ?? 'De deal kon niet gemaakt worden.')
  }
  const dealId = String((deal as { id: string }).id)
  // De notities van de kaart mee, de oudste eerst; daarna de verhuis zelf.
  const { data: nots } = await admin.from('opdracht_notities').select('tekst, soort, created_at, auteur_naam, auteur_email').eq('opdracht_id', id).order('created_at', { ascending: true }).limit(200)
  const lijst = ((nots ?? []) as { tekst: string; soort: string; created_at: string; auteur_naam: string | null; auteur_email: string | null }[])
    .map((n) => ({ deal_id: dealId, tekst: n.tekst, soort: n.soort === 'systeem' ? 'systeem' : 'notitie', door: n.auteur_naam ?? n.auteur_email ?? null, created_at: n.created_at }))
  if (lijst.length) await admin.from('ngs_deal_notities').insert(lijst).then(() => null, () => null)
  await admin.from('ngs_deal_notities').insert({ deal_id: dealId, tekst: `Verhuisd van Projecten (kaart "${r.titel ?? ''}")`, soort: 'systeem', door }).then(() => null, () => null)
  await admin.from('ngs_deal_fases').insert({ deal_id: dealId, van: null, naar: fase, door }).then(() => null, () => null)
  await admin.from('opdrachten').update({ ngs_deal_id: dealId, updated_at: nu }).eq('id', id)
  await voegNotitieToe(admin, id, 'Verhuisd naar de Pipeline van NextGenSolutions.', 'systeem', null)
  return dealId
}

/** Laten staan: de kaart blijft op Projecten en komt niet meer op de lijst bovenaan. Terugzetten kan. */
export async function laatKaartStaan(admin: Admin, id: string, aan: boolean): Promise<void> {
  if (!UUID.test(id)) throw new SolutionsKaartFout('Kaart niet gevonden.', 404)
  const { error } = await admin.from('opdrachten').update({ ngs_keuze: aan ? 'laten' : null }).eq('id', id).is('ngs_deal_id', null)
  if (error) throw new Error(error.message)
}

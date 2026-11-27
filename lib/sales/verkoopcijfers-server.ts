import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { laadReeksen } from '@/lib/agenda/team-server'
import { blokIntervallen } from '@/lib/agenda/reeksen'
import {
  mediaTrechter, solutionsTrechter, perBron, verliesRedenen, salesActiviteit, urenVan, salesUren, bereikteStap,
  type KaartKort, type DealKort, type AbmNotitie,
} from './verkoopcijfers'
import { kolomVan } from '@/lib/opdrachten-kanban'

type Admin = ReturnType<typeof createAdminSupabaseClient>

/**
 * Verkoopcijfers (fase 6) voor een periode: alles op aanmaakdatum in die periode.
 * Enkel lezen; elke bron apart, een bron die faalt laat de rest staan.
 */
export async function laadVerkoopcijfers(admin: Admin, van: string, tot: string) {
  const veilig = async <T,>(p: PromiseLike<{ data: T[] | null }>): Promise<T[]> => { try { return (await p).data ?? [] } catch { return [] } }
  const vanIso = `${van}T00:00:00Z`, totIso = `${tot}T23:59:59Z`
  const [kaarten, deals, notities, afspraken, reeksen, personen] = await Promise.all([
    veilig(admin.from('opdrachten').select('status, bron, stop_reden, offerte_op, offerte_via, contract_id, created_at, bedrijf, merk').gte('created_at', vanIso).lte('created_at', totIso).limit(5000)),
    veilig(admin.from('ngs_deals').select('fase, bron, verloren_reden, created_at').is('verwijderd_op', null).gte('created_at', vanIso).lte('created_at', totIso).limit(5000)),
    veilig(admin.from('abm_notities').select('door, uitkomst, soort, created_at').gte('created_at', vanIso).lte('created_at', totIso).limit(20000)),
    veilig(admin.from('sales_appointments').select('starts_at, ends_at, aanwezigheid, status').eq('aanwezigheid', 'gehouden').gte('starts_at', vanIso).lte('starts_at', totIso).limit(5000)),
    laadReeksen(admin, van, tot).catch(() => []),
    veilig(admin.from('ag_personen').select('id, naam').limit(500)),
  ]) as [(KaartKort & { merk: string | null })[], DealKort[], AbmNotitie[], { starts_at: string; ends_at: string | null }[], Awaited<ReturnType<typeof laadReeksen>>, { id: string; naam: string }[]]

  const solutionsKaart = (k: { bedrijf: string | null; merk: string | null }) => (k.bedrijf ?? k.merk) === 'nextgensolutions'
  const media = kaarten.filter((k) => !solutionsKaart(k))
  const gewonnenKaart = (k: KaartKort) => bereikteStap(k) >= 3 && kolomVan(k.status) !== 'stopgezet'

  // Geplande salesuren = vaste blokken Sales in de agenda; gedaan = gehouden verkoopafspraken.
  const vanMs = Date.parse(vanIso), totMs = Date.parse(totIso)
  const salesReeksen = reeksen.filter((r) => r.soort === 'blok' && r.blok_type === 'sales')
  const perPersoon = personen.map((p) => ({ naam: p.naam, uren: urenVan(blokIntervallen(salesReeksen, p.id, vanMs, totMs)) })).filter((p) => p.uren > 0).sort((a, b) => b.uren - a.uren)
  const gepland = perPersoon.reduce((t, p) => t + p.uren, 0)
  const gedaan = urenVan(afspraken.map((a) => ({ start: Date.parse(a.starts_at), end: a.ends_at ? Date.parse(a.ends_at) : Date.parse(a.starts_at) + 30 * 60_000 })))

  return {
    media: mediaTrechter(media),
    solutions: solutionsTrechter(deals),
    solutionsKaarten: kaarten.length - media.length,
    bronnen: perBron([
      ...kaarten.map((k) => ({ bron: k.bron, gewonnen: gewonnenKaart(k), verloren: kolomVan(k.status) === 'stopgezet' })),
      ...deals.map((d) => ({ bron: d.bron, gewonnen: d.fase === 'won', verloren: d.fase === 'lost' })),
    ]),
    verlies: {
      media: verliesRedenen(media.filter((k) => kolomVan(k.status) === 'stopgezet').map((k) => k.stop_reden)),
      solutions: verliesRedenen(deals.filter((d) => d.fase === 'lost').map((d) => d.verloren_reden)),
    },
    activiteit: salesActiviteit(notities),
    uren: { ...salesUren(gepland, gedaan), perPersoon, afspraken: afspraken.length },
  }
}
export type Verkoopcijfers = Awaited<ReturnType<typeof laadVerkoopcijfers>>

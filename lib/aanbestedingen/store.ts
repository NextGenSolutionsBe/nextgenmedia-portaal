import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { normaliseer, type BdaPublication, type Opdracht } from '@/lib/aanbestedingen/normalize'

/**
 * Opgehaalde opdrachten wegschrijven.
 *
 * Regels die uit de praktijk komen:
 *  • Nooit iets verwijderen. Wat niet meer in de ophaal zit, krijgt
 *    record_status 'verdwenen' en blijft staan.
 *  • Bij een lege ophaal NIETS als verdwenen markeren. Eén mislukte run zou
 *    anders het hele overzicht leegvegen.
 *  • Bij het bijwerken van een bestaande opdracht blijven `ingediend`,
 *    `ingediend_at`, `genegeerd` en `first_seen_at` ongemoeid — dat is werk van
 *    de gebruiker en geen data van de BDA.
 */

export type OpslagResultaat = {
  totaal: number
  nieuw: number
  bijgewerkt: number
  verdwenen: number
}

export async function bewaarOpdrachten(
  filterId: string, publicaties: BdaPublication[],
): Promise<OpslagResultaat> {
  const admin = createAdminSupabaseClient()
  const uit: OpslagResultaat = { totaal: 0, nieuw: 0, bijgewerkt: 0, verdwenen: 0 }

  // Ontdubbelen op referentienummer: dezelfde opdracht kan in twee pagina's
  // opduiken wanneer er tijdens het pagineren iets gepubliceerd wordt.
  const perReferentie = new Map<string, Opdracht>()
  for (const pub of publicaties) {
    const o = normaliseer(pub)
    if (o.referentienummer) perReferentie.set(o.referentienummer, o)
  }
  const opdrachten = [...perReferentie.values()]
  uit.totaal = opdrachten.length

  if (opdrachten.length === 0) {
    // Bewust: geen enkele wijziging bij een lege ophaal.
    return uit
  }

  // Welke kennen we al? Bepaalt nieuw versus bijgewerkt.
  const { data: bestaandeRijen } = await admin
    .from('aanbestedingen')
    .select('referentienummer')
    .eq('filter_id', filterId)
  const bestaand = new Set(
    ((bestaandeRijen ?? []) as { referentienummer: string }[]).map((r) => r.referentienummer),
  )

  const nu = new Date().toISOString()

  // In blokken van 200: één grote upsert kan de payloadlimiet overschrijden.
  for (let i = 0; i < opdrachten.length; i += 200) {
    const blok = opdrachten.slice(i, i + 200)
    const rijen = blok.map((o) => {
      const isNieuw = !bestaand.has(o.referentienummer)
      return {
        filter_id: filterId,
        ...o,
        record_status: isNieuw ? 'nieuw' : 'bestaand',
        last_seen_at: nu,
        // first_seen_at enkel meesturen bij een insert; bij een update zou de
        // upsert de oorspronkelijke datum overschrijven.
        ...(isNieuw ? { first_seen_at: nu } : {}),
      }
    })
    const { error } = await admin.from('aanbestedingen')
      .upsert(rijen, { onConflict: 'filter_id,referentienummer' })
    if (error) throw new Error(error.message)

    for (const o of blok) {
      if (bestaand.has(o.referentienummer)) uit.bijgewerkt++
      else uit.nieuw++
    }
  }

  // Wat er niet meer bij zit: markeren, niet wissen. Enkel rijen die nog niet
  // ingediend zijn — een ingediende opdracht verdwijnt normaal uit de zoeklijst
  // en dat mag niet als "verdwenen" gaan tellen.
  const gezien = opdrachten.map((o) => o.referentienummer)
  const { data: weg } = await admin.from('aanbestedingen')
    .update({ record_status: 'verdwenen' })
    .eq('filter_id', filterId)
    .eq('ingediend', false)
    .neq('record_status', 'verdwenen')
    .not('referentienummer', 'in', `(${gezien.map((r) => `"${r.replace(/"/g, '')}"`).join(',')})`)
    .select('referentienummer')
  uit.verdwenen = (weg ?? []).length

  return uit
}

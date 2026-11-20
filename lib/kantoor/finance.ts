import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { boekMaand } from '@/lib/kantoor/model'

/**
 * Wat de samenwerkingen in het Kantoor betekenen voor ONZE cijfers.
 *
 * Bewust AFGELEID en niet weggeschreven als rijen in revenue_entries /
 * cost_entries. Dat is dezelfde keuze als bij de setterkosten, en om dezelfde
 * reden: een opdracht kan later gewijzigd, heropend of geannuleerd worden, en
 * dan zou een eerder weggeschreven rij blijven staan en de cijfers vervuilen.
 * Afleiden kan niet uit de pas lopen met de werkelijkheid.
 *
 * Boekmoment: alles landt in de maand waarin de opdracht is AFGEROND — omzet
 * én kosten samen, zodat de marge volledig in één maand staat en de
 * maandcijfers kloppen.
 *
 * Wat telt als wat, gezien vanuit ons:
 *  · factureren wij de eindklant, dan is het totaal onze omzet en is de
 *    vergoeding aan de partner een kost (marge = het verschil);
 *  · voeren wij het werk uit voor een ander, dan is onze vergoeding omzet en
 *    staat er geen kost tegenover.
 *
 * Een samenwerking tussen twee EIGEN bedrijven (NextGenMedia ↔
 * NextGenSolutions) telt bewust als omzet én kost: intern verschuift het geld
 * van de ene entiteit naar de andere, en beide voeren een eigen boekhouding.
 */

export type KantoorMaanden = {
  /** Extra omzet per maand (0-11), in euro. */
  omzet: number[]
  /** Extra kosten per maand (0-11), in euro. */
  kosten: number[]
}

const leeg = (): number[] => Array.from({ length: 12 }, () => 0)

export async function kantoorPerMaand(jaar: number): Promise<KantoorMaanden> {
  const omzet = leeg(), kosten = leeg()
  try {
    const admin = createAdminSupabaseClient()
    const [{ data: eigen }, { data: opdrachten }] = await Promise.all([
      admin.from('kantoor_bedrijven').select('id').eq('is_eigen', true),
      admin.from('kantoor_opdrachten')
        .select('factureert_id, ontvangt_id, totaal_cents, vergoeding_cents, afgerond_op')
        .eq('status', 'afgerond').not('afgerond_op', 'is', null),
    ])

    const onsId = new Set(((eigen ?? []) as { id: string }[]).map((b) => b.id))
    type Rij = {
      factureert_id: string; ontvangt_id: string
      totaal_cents: number; vergoeding_cents: number; afgerond_op: string
    }

    for (const o of (opdrachten ?? []) as Rij[]) {
      const maand = boekMaand(o.afgerond_op)
      if (!maand || !maand.startsWith(`${jaar}-`)) continue
      const mi = Number(maand.slice(5, 7)) - 1
      if (mi < 0 || mi > 11) continue

      if (onsId.has(o.factureert_id)) {
        omzet[mi] += o.totaal_cents / 100
        kosten[mi] += o.vergoeding_cents / 100
      }
      if (onsId.has(o.ontvangt_id)) {
        omzet[mi] += o.vergoeding_cents / 100
      }
    }
  } catch {
    // Tabellen nog niet gemigreerd → geen bijdrage, en zeker geen stukke
    // financiënpagina.
    return { omzet: leeg(), kosten: leeg() }
  }
  return { omzet, kosten }
}

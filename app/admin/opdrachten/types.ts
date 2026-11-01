import type { Opdracht } from '@/lib/opdrachten'
import type { Facturatie, KolomKey, Bron } from '@/lib/opdrachten-kanban'

/** Een opdracht zoals de API ze voor het bord teruggeeft. */
export type KaartOpdracht = Opdracht & {
  kolom: KolomKey
  diensten: string[]
  bron?: Bron | null
  offerte_via?: string | null
  offerte_op?: string | null
  stop_reden?: string | null
  facturatie?: Facturatie | null
  notities_aantal?: number
  laatste_notitie?: { tekst: string; auteur_naam: string | null; auteur_email: string | null; created_at: string } | null
  /** Voorstel voor inbound/outbound uit de leadbron in de pipeline. */
  bron_voorstel?: Bron | null
}

export type Klant = { id: string; naam: string; contact_name?: string | null; email?: string | null; verantwoordelijke?: string | null }
export type ContractOptie = { id: string; titel: string; status: string; label: string; client_id: string | null }
export type FactuurOptie = { id: string; description: string | null; status: string; invoice_date: string | null; client_id: string | null; contract_id: string | null; amount_incl: number | null; klant_naam: string | null }

export type Notitie = {
  id: string
  tekst: string
  soort: 'notitie' | 'systeem'
  auteur_user_id: string | null
  auteur_email: string | null
  auteur_naam: string | null
  created_at: string
}

/** Wat het bord meestuurt bij een verplaatsing (naast de status). */
export type VerplaatsExtra = {
  offerte_via?: string | null
  offerte_op?: string | null
  bedrag_excl?: string | null
  contract_id?: string | null
  stop_reden?: string | null
  notitie?: string | null
}

export const FACTUUR_LABEL: Record<string, string> = { te_versturen: 'te versturen', verstuurd: 'verstuurd', gefactureerd: 'verstuurd', betaald: 'betaald', geannuleerd: 'geannuleerd' }

export const datumKort = (s: string | null | undefined) =>
  s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) : ''

/** "vandaag", "gisteren", "3 d", "2 wk", anders de datum. */
export function hoeLangGeleden(iso: string | null | undefined, nu: Date = new Date()): string {
  if (!iso) return ''
  const ms = nu.getTime() - new Date(iso).getTime()
  const d = Math.floor(ms / 86_400_000)
  if (ms < 3_600_000) return `${Math.max(1, Math.floor(ms / 60_000))} min`
  if (d < 1) return `${Math.floor(ms / 3_600_000)} u`
  if (d === 1) return 'gisteren'
  if (d < 14) return `${d} d`
  if (d < 60) return `${Math.floor(d / 7)} wk`
  return datumKort(iso.slice(0, 10))
}

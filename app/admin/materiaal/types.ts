import type { Uitlening as U } from '@/lib/materiaal/model'

export type Uitlening = U & { actie_sleutel?: string | null; mail_uit_op?: string | null; mail_terug_op?: string | null; created_at?: string }
export type Item = {
  id: string; naam: string; categorie_id: string | null; merk: string | null; model: string | null; serienummer: string | null
  foto_pad: string | null; foto_url: string | null; aankoopdatum: string | null; aankoopwaarde: number | null; opmerkingen: string | null
  gearchiveerd_op: string | null; created_at: string
  /** Wat het is, wat erbij zit en de aankoop (22 nov 2026; ook uit de factuur gelezen). */
  omschrijving?: string | null; inhoud?: string[] | null; kenmerken?: string[] | null
  leverancier?: string | null; factuurnummer?: string | null; garantie_tot?: string | null
  factuur_pad?: string | null; factuur_naam?: string | null
}
export type Categorie = { id: string; naam: string; volgorde: number }
export type Ontlener = { id: string; personeel_id: string | null; voornaam: string; achternaam: string | null; email: string | null; telefoon: string | null; type: string | null; gearchiveerd_op: string | null }
export type Activiteit = { id: number; op: string; soort: string; item_id: string | null; ontlener_id: string | null; uitlening_id: string | null; door: string | null; opmerking: string | null; meta: Record<string, unknown> | null }
export type Data = {
  items: Item[]; categorieen: Categorie[]; ontleners: Ontlener[]; uitleningen: Uitlening[]; activiteiten: Activiteit[]
  kan: { uitlenen: boolean; beheren: boolean }; ik: string | null
}
export type Doe = (actie: string, body?: Record<string, unknown>, opts?: { stil?: boolean }) => Promise<Record<string, unknown> | null>

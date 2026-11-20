// Types van het integratie-overzicht (API ↔ scherm). Puur.
export type IntegratieStatus = 'actief' | 'niet_ingesteld' | 'fout' | 'onbekend'
export type Integratie = {
  key: string; naam: string; omschrijving: string
  status: IntegratieStatus
  /** Gemaskeerde sleutel (laatste vier tekens) — nooit de volledige waarde. */
  sleutel: string | null
  laatsteSync: string | null
  details: string[]
  kanTesten: boolean
  kanSync: boolean
}

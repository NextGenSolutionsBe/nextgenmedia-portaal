// Personeel — wat een medewerker van zichzelf te zien krijgt. Puur en testbaar.
//
// De werknemersomgeving (/team) krijgt NOOIT loon, uurprijs, kostprijs,
// lasten, btw of adminnotities. In plaats van velden te verbergen in het
// scherm, halen we ze hier weg vóór iets de server verlaat: een whitelist,
// geen blacklist — een nieuwe kolom lekt dus nooit ongemerkt uit.

const SESSIE_VELDEN = ['id', 'start_at', 'eind_at', 'pauzes', 'pauze_actief_sinds', 'status', 'client_id', 'opdracht_id', 'project', 'taak', 'planning_id', 'verslag', 'links', 'correctie_vraag', 'beoordeeld_op', 'created_at'] as const
const PLANNING_VELDEN = ['id', 'datum', 'start_tijd', 'eind_tijd', 'client_id', 'opdracht_id', 'project', 'taak', 'verwachte_duur_min', 'deadline', 'prioriteit', 'briefing', 'links', 'deliverables', 'locatie', 'thuiswerk', 'status', 'werkstatus', 'voortgang'] as const
const BESCHIKBAARHEID_VELDEN = ['id', 'datum', 'start_tijd', 'eind_tijd', 'opmerking', 'status', 'goedgekeurd_start', 'goedgekeurd_eind', 'voorstel_start', 'voorstel_eind', 'reactie', 'created_at'] as const
const PROFIEL_VELDEN = ['id', 'voornaam', 'achternaam', 'type', 'functie', 'email', 'profielfoto_pad'] as const

/** Velden die nooit naar een medewerker mogen, ook niet via een omweg. */
export const VERBODEN_VOOR_MEDEWERKER = ['kost_per_uur', 'kost_bedrag', 'kost_snapshot', 'tarief_id', 'basis_uur', 'lijnen', 'btw_pct', 'admin_opmerking', 'interne_notities', 'iban_enc', 'rijksregisternummer_enc', 'bedrag', 'berekening']

function kies<T extends Record<string, unknown>>(rij: T | null | undefined, velden: readonly string[]): Record<string, unknown> | null {
  if (!rij) return null
  const uit: Record<string, unknown> = {}
  for (const v of velden) if (v in rij) uit[v] = rij[v]
  return uit
}

export const sessieVoorMedewerker = (r: Record<string, unknown> | null | undefined) => kies(r, SESSIE_VELDEN)
export const planningVoorMedewerker = (r: Record<string, unknown> | null | undefined) => kies(r, PLANNING_VELDEN)
export const beschikbaarheidVoorMedewerker = (r: Record<string, unknown> | null | undefined) => kies(r, BESCHIKBAARHEID_VELDEN)
export const profielVoorMedewerker = (r: Record<string, unknown> | null | undefined) => kies(r, PROFIEL_VELDEN)

/** Zelfde selectie als kolomlijst voor een databankquery (minder data over de lijn). */
export const SESSIE_KOLOMMEN = SESSIE_VELDEN.join(', ')
export const PLANNING_KOLOMMEN = PLANNING_VELDEN.join(', ')
export const BESCHIKBAARHEID_KOLOMMEN = BESCHIKBAARHEID_VELDEN.join(', ')
export const PROFIEL_KOLOMMEN = PROFIEL_VELDEN.join(', ')

/** Controle voor tests en voor een laatste vangnet in de API. */
export function bevatFinancieel(x: unknown): boolean {
  const s = JSON.stringify(x ?? null)
  return VERBODEN_VOOR_MEDEWERKER.some((v) => s.includes(`"${v}"`))
}

/**
 * Een projectkaart verwijderen (27 nov 2026). Pure regels, getest in
 * tests/opdrachten-verwijderen.test.ts; de server staat in opdrachten-verwijderen-server.ts.
 *
 * Wat aan de kaart hangt (mails, meetings, opleveringen, het voorstel uit de mail …) wordt
 * nooit mee verwijderd: het wordt losgekoppeld, of verhuist mee met het contract of de
 * offerte naar een andere kaart van dezelfde klant (dan is het hetzelfde project).
 * Een contract en een lopende offerte hebben altijd een kaart (het vangnet maakt er anders
 * meteen een nieuwe). Die verhuizen dus naar een andere kaart van de klant; is er geen,
 * dan verwijderen we niet en zeggen we waarom.
 */

export type KaartKort = { id: string; titel: string; client_id: string | null; contract_id: string | null; created_at?: string | null }
export type OfferteKort = { id: string; titel: string | null; status: string | null }

/** Lopende offertes: die krijgen anders vanzelf een nieuwe kaart (zorgVoorOfferteKaarten). */
export const LOPENDE_OFFERTE = new Set(['concept', 'verstuurd', 'geaccepteerd'])

export type VerwijderPlan =
  | { ok: false; reden: string }
  | {
      ok: true
      /** De kaart die het contract overneemt (enkel als de kaart een contract had). */
      contractNaar: string | null
      /** De kaart die offertes en de mail-opvolging overneemt; null = loskoppelen. */
      restNaar: string | null
    }

/**
 * Wat er gebeurt met wat aan de kaart hangt. `andere` = de andere kaarten van dezelfde
 * klant, recentste eerst.
 */
export function verwijderPlan(kaart: KaartKort, andere: KaartKort[], offertes: OfferteKort[]): VerwijderPlan {
  const zelfdeKlant = kaart.client_id ? andere.filter((a) => a.id !== kaart.id && a.client_id === kaart.client_id) : []
  let contractNaar: string | null = null
  if (kaart.contract_id) {
    const vrij = zelfdeKlant.find((a) => !a.contract_id)
    if (!vrij) {
      return { ok: false, reden: 'Aan deze kaart hangt een contract, en elk contract heeft een kaart: ze zou meteen terugkomen. Zet de kaart op Verloren of verwijder eerst het contract.' }
    }
    contractNaar = vrij.id
  }
  const lopend = offertes.filter((o) => LOPENDE_OFFERTE.has(String(o.status ?? '')))
  // Enkel meeverhuizen als het contract of een lopende offerte verhuist (= zelfde project).
  const restNaar = contractNaar ?? (lopend.length ? zelfdeKlant[0]?.id ?? null : null)
  if (lopend.length && !restNaar) {
    const naam = lopend[0].titel ? ` "${lopend[0].titel}"` : ''
    return { ok: false, reden: `Aan deze kaart hangt de offerte${naam}, en elke lopende offerte heeft een kaart: ze zou meteen terugkomen. Zet de kaart op Verloren of verwijder eerst de offerte.` }
  }
  return { ok: true, contractNaar, restNaar }
}

/**
 * Tabellen die naar een kaart verwijzen zonder "bij verwijderen". `volgt`: verhuist mee
 * naar `restNaar` (offertes en de mail-opvolging van het project); de rest wordt losgekoppeld
 * (de meeting, oplevering of het ABM-bedrijf blijft bij de klant).
 */
export const VERWIJZINGEN: { tabel: string; kolom: string; volgt: boolean }[] = [
  { tabel: 'offertes', kolom: 'opdracht_id', volgt: true },
  { tabel: 'mail_berichten', kolom: 'opdracht_id', volgt: true },
  { tabel: 'opvolg_meetings', kolom: 'opdracht_id', volgt: true },
  { tabel: 'mail_taken', kolom: 'opdracht_id', volgt: true },
  { tabel: 'mail_projecten', kolom: 'opdracht_id', volgt: true },
  { tabel: 'mail_projecten', kolom: 'lopende_opdracht_id', volgt: true },
  { tabel: 'klant_meetings', kolom: 'project_id', volgt: false },
  { tabel: 'opleveringen', kolom: 'opdracht_id', volgt: false },
  { tabel: 'abm_bedrijven', kolom: 'opdracht_id', volgt: false },
  { tabel: 'sales_lead_opdrachten', kolom: 'bron_opdracht_id', volgt: false },
]

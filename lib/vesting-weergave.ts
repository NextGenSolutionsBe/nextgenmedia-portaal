/**
 * Wat het nieuwe Vesting-scherm krijgt: alles al uitgerekend op de server
 * (lib/vesting-data-server.ts), zodat scherm en tekenen exact dezelfde cijfers
 * gebruiken. Enkel types; geen logica.
 */

import type { Akkoord, AkkoordStand, KostSoort, Vennoot } from './vesting-akkoord'
import type { KandidaatContract } from './vesting-snel'

export type AkkoordWeergave = { inhoud: Akkoord; tekst: string; stand: AkkoordStand; wijzigingen: string[] }

export type ContractWeergave = {
  id: string
  nr: string
  klant: string
  client_id: string | null
  /** Titel van het contract in Contracten, als het gekoppeld is. */
  titel: string | null
  contract_id: string | null
  ondertekend_op: string | null
  /** Gekoppeld contract dat de klant nog niet tekende. */
  wachtOpKlant: boolean
  facturatiemodel: 'maandcontract' | 'eenmalig'
  maandbedrag: number | null
  duur: number | null
  totaal: number | null
  kostLijnen: { id: string; soort: KostSoort; omschrijving: string | null; bedrag: number }[]
  /** Directe kosten op de facturen van het contract (afgeleid), als die er zijn. */
  kostenFacturen: number | null
  kostenAftrek: number
  netto: number | null
  afspraak: boolean
  closing: boolean
  toerekening_pct: number | null
  factor: number
  /** Wat er voor Marco meetelt (zoals getekend). */
  teltMee: number
  /** Deel van de algemene kosten dat op dit contract valt (als WAM ze niet kon dragen). */
  algemeneKostenAftrek: number
  status: 'actief' | 'voltooid' | 'stopgezet' | 'niet_betaler'
  /** Telt het nu effectief mee (niet uitgesloten door status, periode of betalingen)? */
  telt: boolean
  definitief: boolean
  ruweVesting: number
  akkoord: AkkoordWeergave
}

export type KostWeergave = { id: string; datum: string | null; omschrijving: string; bedrag: number; akkoord: AkkoordWeergave }

export type AandelenWeergave = {
  marco: number
  marcoDefinitief: number
  /** Marco's aandeel als enkel de contracten tellen die alle drie getekend hebben. */
  marcoGetekend: number
  bram: number
  chiara: number
  maxMarco: number
  /** Alles wat voor Marco meetelt na kosten: WAM netto + contracten. */
  meetellend: number
  wam: { ontvangen: number; aandeel: number; bedragPerPct: number; max: number }
  contracten: { teltMee: number; aantal: number; aandeel: number }
  algemeneKosten: { totaal: number; vanWam: number; vanContracten: number; nietGedekt: number }
  volgendeProcent: { nodig: number; tarief: number } | null
  getekend: { volledig: number; totaal: number }
}

export type VestingWeergave = {
  aandelen: AandelenWeergave
  contracten: ContractWeergave[]
  kosten: KostWeergave[]
  teBeoordelen: KandidaatContract[]
  nietMee: KandidaatContract[]
  klanten: { id: string; naam: string; closer: string | null; setter: string | null }[]
  /** Wie kijkt: een vennoot (mag tekenen) of niet. */
  ik: { vennoot: Vennoot | null; naam: string | null }
  vennoten: Record<Vennoot, string>
}

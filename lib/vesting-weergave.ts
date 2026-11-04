/**
 * Wat het nieuwe Vesting-scherm krijgt: alles al uitgerekend op de server
 * (lib/vesting-data-server.ts), zodat scherm en tekenen exact dezelfde cijfers
 * gebruiken. Enkel types; geen logica.
 */

import type { Akkoord, AkkoordStand, KostSoort, Registratie, Vennoot } from './vesting-akkoord'
import type { KandidaatContract } from './vesting-snel'

export type AkkoordWeergave = { inhoud: Akkoord; tekst: string; stand: AkkoordStand; wijzigingen: string[] }

/** Het laatste certificaat van een kaart (als alle drie ooit tekenden). */
export type CertificaatKort = { id: string; nummer: string; volledig_op: string; mail_status: 'wacht' | 'verstuurd' | 'mislukt'; mail_op: string | null; mail_fout: string | null; huidig: boolean }

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
  kostLijnen: { id: string; soort: KostSoort; omschrijving: string | null; bedrag: number; verantwoording: string | null; bewijs: { pad: string; naam: string } | null }[]
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
  /** Wat er na de algemene kosten in de aandelen telt. */
  teltVoorAandeel: number
  status: 'actief' | 'voltooid' | 'stopgezet' | 'niet_betaler'
  /** Telt het nu effectief mee (niet uitgesloten door status, periode of betalingen)? */
  telt: boolean
  definitief: boolean
  /** Het aandeel dat dit contract Marco oplevert (fractie, 0,003 = 0,30%). */
  ruweVesting: number
  /** Hoe dat aandeel berekend werd: deel aan het reguliere tarief, deel aan het jaartarief. */
  schijven: { goedkoop: number; jaar: number; regulierTarief: number; jaarTarief: number | null; jaar_label: string }
  akkoord: AkkoordWeergave
  certificaat: CertificaatKort | null
}

/** Een inkomst (bv. via WAM) of algemene kost, met verantwoording en akkoord. */
export type RegistratieWeergave = Registratie & { akkoord: AkkoordWeergave; certificaat: CertificaatKort | null }

export type AandelenWeergave = {
  marco: number
  marcoDefinitief: number
  /** Marco's aandeel als enkel de contracten tellen die alle drie getekend hebben. */
  marcoGetekend: number
  bramGetekend: number
  bram: number
  chiara: number
  maxMarco: number
  /** Alles wat voor Marco meetelt na kosten: WAM netto + contracten. */
  meetellend: number
  /** Inkomsten via WAM of een andere weg (registraties). */
  wam: { ontvangen: number; aantal: number; aandeel: number; bedragPerPct: number; max: number }
  contracten: { teltMee: number; aantal: number; aandeel: number }
  algemeneKosten: { totaal: number; vanWam: number; vanContracten: number; nietGedekt: number }
  volgendeProcent: { nodig: number; tarief: number } | null
  getekend: { volledig: number; totaal: number }
}

export type VestingWeergave = {
  aandelen: AandelenWeergave
  contracten: ContractWeergave[]
  registraties: RegistratieWeergave[]
  teBeoordelen: KandidaatContract[]
  nietMee: KandidaatContract[]
  klanten: { id: string; naam: string; closer: string | null; setter: string | null }[]
  /** Wie kijkt: een vennoot (mag tekenen) of niet. */
  ik: { vennoot: Vennoot | null; naam: string | null }
  vennoten: Record<Vennoot, string>
}

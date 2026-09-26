// Eenmalige verzending van álle contracten naar één archiefadres: per contract
// één aparte mail, met het contract als PDF en — indien beschikbaar — het
// ondertekeningscertificaat als tweede PDF.
//
// Deze module is puur: geen databank, geen netwerk. Ze bepaalt wie nog een mail
// moet krijgen, hoe het onderwerp en de tekst eruitzien en hoe de samenvatting
// telt. Zo is ze los testbaar en leest de route als een verhaal.
//
// Uitgangspunten uit de opdracht: niets aan de contracten wijzigen, nooit twee
// keer dezelfde mail, en een mislukte verzending moet apart opnieuw kunnen.

import { statusInfo } from '@/lib/contract-status'

/** Waar het archief naartoe gaat als er niets anders is ingesteld. */
export const LEGAL_VERZENDING_STANDAARD = 'legal@nextgenmedia.be'

/** Exact de zin die in de mail moet staan als er geen certificaat is. */
export const GEEN_CERTIFICAAT_ZIN = 'Geen ondertekeningscertificaat beschikbaar.'

export type ContractInfo = {
  id: string
  klantNaam: string | null
  titel: string | null
  contracttype: string | null
  status: string | null
  signedAt: string | null
  startDatum: string | null
  eindDatum: string | null
}

export type VerzendRij = {
  contract_id: string
  status: 'verstuurd' | 'mislukt'
  certificaat: boolean
  fout: string | null
  verstuurd_op: string | null
  pogingen: number
}

export type Verzendresultaat = {
  contractId: string
  ok: boolean
  certificaat: boolean
  fout?: string
}

const leeg = (s: string | null | undefined, terugval: string) => (String(s ?? '').trim() || terugval)

/** "Contract – Klant – Contractnaam – Contracttype" */
export function onderwerpVan(c: ContractInfo): string {
  return ['Contract', leeg(c.klantNaam, 'Zonder klant'), leeg(c.titel, 'Contract'), leeg(c.contracttype, 'Niet toegewezen')].join(' – ')
}

/** Datum als 14/09/2026; leeg wordt een streepje. */
export function datumNl(d: string | null | undefined): string {
  const s = String(d ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—'
  const [j, m, dag] = s.split('-')
  return `${dag}/${m}/${j}`
}

/**
 * De tekst van één archiefmail. Alle gevraagde velden staan er altijd in,
 * ook wanneer ze leeg zijn — dan met een streepje, zodat de ontvanger ziet
 * dat het veld bestaat maar niet ingevuld is.
 */
export function tekstVan(c: ContractInfo, opties: { certificaat: boolean; adminUrl?: string | null }): string {
  const regels: string[] = [
    'Archiefkopie van een contract uit het NextGenMedia-portaal.',
    '',
    `Klantnaam: ${leeg(c.klantNaam, 'Zonder klant')}`,
    `Contractnaam: ${leeg(c.titel, 'Contract')}`,
    `Contracttype: ${leeg(c.contracttype, 'Niet toegewezen')}`,
    `Contractstatus: ${statusInfo(c.status).label}`,
    `Datum van ondertekening: ${datumNl(c.signedAt)}`,
    `Startdatum: ${datumNl(c.startDatum)}`,
    `Einddatum: ${datumNl(c.eindDatum)}`,
    '',
    opties.certificaat
      ? 'In bijlage: het contract als pdf en het ondertekeningscertificaat als aparte pdf.'
      : `In bijlage: het contract als pdf. ${GEEN_CERTIFICAAT_ZIN}`,
  ]
  if (opties.adminUrl) regels.push('', `Contract in het portaal: ${opties.adminUrl}`)
  regels.push('', 'Deze mail hoort bij een eenmalige archiefverzending van alle bestaande contracten. Er volgt geen automatische of terugkerende mailing.')
  return regels.join('\n')
}

/** Een contract dat al met succes verstuurd is, gaat nooit een tweede keer mee. */
export function alVerstuurd(rij: VerzendRij | null | undefined): boolean {
  return !!rij && rij.status === 'verstuurd'
}

/**
 * Wie nog een mail moet krijgen: alles wat nog nooit succesvol verstuurd is,
 * in de volgorde van de lijst. `max` beperkt één ronde, zodat een serverless
 * functie niet in haar tijdslimiet loopt; de browser roept gewoon opnieuw aan.
 */
export function teVersturen(contracten: ContractInfo[], rijen: VerzendRij[], max?: number): ContractInfo[] {
  const per = new Map(rijen.map((r) => [r.contract_id, r]))
  const todo = contracten.filter((c) => !alVerstuurd(per.get(c.id)))
  return typeof max === 'number' && max > 0 ? todo.slice(0, max) : todo
}

export type Samenvatting = {
  totaal: number
  verstuurd: number
  mislukt: number
  nogTeDoen: number
  zonderCertificaat: string[]
  mislukteContracten: { id: string; naam: string; fout: string | null }[]
}

/** Het overzicht ná afloop: hoeveel gelukt, wat misliep, waar geen certificaat was. */
export function samenvatting(contracten: ContractInfo[], rijen: VerzendRij[]): Samenvatting {
  const per = new Map(rijen.map((r) => [r.contract_id, r]))
  const naam = (c: ContractInfo) => `${leeg(c.klantNaam, 'Zonder klant')} — ${leeg(c.titel, 'Contract')}`
  let verstuurd = 0, mislukt = 0, nogTeDoen = 0
  const zonderCertificaat: string[] = []
  const mislukteContracten: { id: string; naam: string; fout: string | null }[] = []
  for (const c of contracten) {
    const r = per.get(c.id)
    if (!r) { nogTeDoen++; continue }
    if (r.status === 'verstuurd') {
      verstuurd++
      if (!r.certificaat) zonderCertificaat.push(naam(c))
    } else {
      mislukt++
      mislukteContracten.push({ id: c.id, naam: naam(c), fout: r.fout })
    }
  }
  return { totaal: contracten.length, verstuurd, mislukt, nogTeDoen, zonderCertificaat, mislukteContracten }
}

/** Eén ontvanger, netjes genormaliseerd. Onzin valt terug op het standaardadres. */
export function ontvangerVan(waarde: string | null | undefined): string {
  const t = String(waarde ?? '').trim().toLowerCase()
  return t.includes('@') && !/\s/.test(t) ? t : LEGAL_VERZENDING_STANDAARD
}

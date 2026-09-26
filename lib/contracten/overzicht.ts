/**
 * Klantmappen-overzicht van de contractenmodule — pure logica.
 *
 * Contracten worden gegroepeerd per KLANT-ID (nooit per naam: twee klanten
 * mogen dezelfde bedrijfsnaam dragen). Contracten zonder klant belanden samen
 * in één map "Zonder klant". Lege mappen bestaan niet: een map ontstaat pas
 * doordat er een contract in zit.
 *
 * Zowel `contracts-client.tsx` als `tests/contract-groepering.test.ts` gebruiken
 * exact deze functies, zodat de test hetzelfde gedrag controleert als het scherm.
 */

import { canonicalStatus, statusInfo } from '@/lib/contract-status'
import { typeVanContract, typeSleutel, ontdubbelTypes } from './types'

export const ZONDER_KLANT = '__zonder_klant__'
export const ZONDER_KLANT_LABEL = 'Zonder klant'

export type OverzichtContract = {
  id: string
  title: string
  status: string
  contract_type: string | null
  client_id: string | null
  client: { id: string; company_name: string } | null
  created_at: string
  sent_at?: string | null
  signed_at?: string | null
  start_date?: string | null
  end_date?: string | null
  /** Extra tekst die de zoekterm óók mag raken (ondertekenaar, dienst, template). */
  zoekExtra?: string | null
}

export type Sortering = 'klant' | 'aantal' | 'recent'

export type Filters = {
  zoek?: string
  type?: string      // 'all' of een typenaam
  status?: string    // 'all' of een canonieke statuskey
}

export type Klantmap = {
  sleutel: string                  // client_id, of ZONDER_KLANT
  klantId: string | null
  klantNaam: string
  contracten: OverzichtContract[]  // na het type-/statusfilter, gesorteerd (nieuwste eerst)
  treffers: string[]               // contract-id's die op de zoekterm matchen ([] zonder zoekterm)
  aantal: number
  actief: number
  beeindigd: number
  laatsteDatum: string | null
}

/** De datum waarop een contract "gebeurd" is: getekend > verstuurd > aangemaakt. */
export function contractDatum(c: OverzichtContract): string | null {
  return c.signed_at || c.sent_at || c.created_at || null
}

/** Is dit contract beëindigd (verlopen, geannuleerd, vervangen of einddatum voorbij)? */
export function isBeeindigd(c: OverzichtContract, vandaag = new Date().toISOString().slice(0, 10)): boolean {
  const key = canonicalStatus(c.status)
  if (key === 'verlopen' || key === 'geannuleerd' || key === 'vervangen') return true
  const eind = c.end_date ? String(c.end_date).slice(0, 10) : null
  return !!eind && eind < vandaag
}

/** Is dit contract actief (getekend en niet beëindigd)? */
export function isActief(c: OverzichtContract, vandaag = new Date().toISOString().slice(0, 10)): boolean {
  return canonicalStatus(c.status) === 'getekend' && !isBeeindigd(c, vandaag)
}

/** Naam van de map waar dit contract in hoort. */
export function mapNaam(c: OverzichtContract): string {
  return c.client?.company_name?.trim() || (c.client_id ? 'Onbekende klant' : ZONDER_KLANT_LABEL)
}

/** Sleutel van de map waar dit contract in hoort (client_id, of ZONDER_KLANT). */
export function mapSleutel(c: OverzichtContract): string {
  return c.client_id || ZONDER_KLANT
}

/** Voldoet het contract aan de harde filters (contracttype + status)? */
export function voldoetAanFilters(c: OverzichtContract, filters: Filters): boolean {
  const type = filters.type ?? 'all'
  if (type !== 'all' && typeSleutel(typeVanContract(c.contract_type)) !== typeSleutel(type)) return false
  const status = filters.status ?? 'all'
  if (status !== 'all' && canonicalStatus(c.status) !== status) return false
  return true
}

/** Matcht het contract op de zoekterm (klantnaam, contractnaam, contracttype)? */
export function matchtZoek(c: OverzichtContract, zoek: string): boolean {
  const q = zoek.trim().toLowerCase()
  if (!q) return true
  const hooiberg = [mapNaam(c), c.title, typeVanContract(c.contract_type), statusInfo(c.status).label, c.zoekExtra]
    .filter(Boolean).join(' ').toLowerCase()
  return hooiberg.includes(q)
}

/** Alle contracttypes die in de keuzelijsten horen: de beheerde types + wat écht gebruikt wordt. */
export function typeOpties(contracten: Array<{ contract_type?: string | null }>, beheerd: Array<string | null | undefined> = []): string[] {
  const gebruikt = contracten.map((c) => typeVanContract(c.contract_type))
  return ontdubbelTypes([...beheerd, ...gebruikt]).sort((a, b) => a.localeCompare(b, 'nl'))
}

/**
 * Bouwt de klantmappen.
 *  - Type-/statusfilter is HARD: niet-passende contracten zitten niet in de map
 *    en tellen niet mee in de cijfers.
 *  - De zoekterm is ZACHT: de map blijft volledig zichtbaar, de treffers worden
 *    gemarkeerd, en een map zonder enkele treffer valt weg.
 *  - Een map zonder contracten bestaat nooit.
 */
export function bouwKlantmappen(
  contracten: OverzichtContract[],
  opties: Filters & { sorteer?: Sortering; vandaag?: string } = {},
): Klantmap[] {
  const vandaag = opties.vandaag ?? new Date().toISOString().slice(0, 10)
  const zoek = (opties.zoek ?? '').trim()

  const mappen = new Map<string, Klantmap>()
  for (const c of contracten) {
    if (!voldoetAanFilters(c, opties)) continue
    const sleutel = mapSleutel(c)
    let map = mappen.get(sleutel)
    if (!map) {
      map = {
        sleutel,
        klantId: c.client_id || null,
        klantNaam: mapNaam(c),
        contracten: [],
        treffers: [],
        aantal: 0,
        actief: 0,
        beeindigd: 0,
        laatsteDatum: null,
      }
      mappen.set(sleutel, map)
    }
    map.contracten.push(c)
    map.aantal++
    if (isActief(c, vandaag)) map.actief++
    if (isBeeindigd(c, vandaag)) map.beeindigd++
    const d = contractDatum(c)
    if (d && (!map.laatsteDatum || d > map.laatsteDatum)) map.laatsteDatum = d
    if (zoek && matchtZoek(c, zoek)) map.treffers.push(c.id)
  }

  const uit = [...mappen.values()].filter((m) => m.aantal > 0 && (!zoek || m.treffers.length > 0))
  for (const m of uit) {
    m.contracten.sort((a, b) => (contractDatum(b) ?? '').localeCompare(contractDatum(a) ?? ''))
  }
  return sorteerMappen(uit, opties.sorteer ?? 'klant')
}

/** Sorteert de mappen. Mappen zonder datum komen achteraan bij 'recent'. */
export function sorteerMappen(mappen: Klantmap[], sorteer: Sortering): Klantmap[] {
  const opNaam = (a: Klantmap, b: Klantmap) => a.klantNaam.localeCompare(b.klantNaam, 'nl', { sensitivity: 'base' })
  const uit = [...mappen]
  if (sorteer === 'aantal') uit.sort((a, b) => b.aantal - a.aantal || opNaam(a, b))
  else if (sorteer === 'recent') {
    uit.sort((a, b) => {
      if (!a.laatsteDatum && !b.laatsteDatum) return opNaam(a, b)
      if (!a.laatsteDatum) return 1
      if (!b.laatsteDatum) return -1
      return b.laatsteDatum.localeCompare(a.laatsteDatum) || opNaam(a, b)
    })
  } else uit.sort(opNaam)
  return uit
}

/** Totalen over de zichtbare mappen (voor de kop boven het overzicht). */
export function totalen(mappen: Klantmap[]): { mappen: number; contracten: number; actief: number; beeindigd: number } {
  return {
    mappen: mappen.length,
    contracten: mappen.reduce((s, m) => s + m.aantal, 0),
    actief: mappen.reduce((s, m) => s + m.actief, 0),
    beeindigd: mappen.reduce((s, m) => s + m.beeindigd, 0),
  }
}

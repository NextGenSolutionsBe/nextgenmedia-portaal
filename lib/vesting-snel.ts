import { DIENSTEN } from './vesting'

/**
 * Vesting, de korte weg: een getekend contract met een prijs erbij, en wie het
 * binnenbracht. De rest (kosten, status, termijnen) blijft in het uitgebreide
 * venster. De berekening zelf staat ongewijzigd in lib/vesting.ts.
 *
 * "Te beoordelen" = getekende contracten uit Contracten/Projecten die nog niet
 * in Vesting staan en waarvan niemand zei dat ze niet meetellen. Zo valt er
 * geen contract tussen de mazen. Pure module.
 */

export type KandidaatContract = {
  id: string; titel: string; status: string; client_id: string | null; klant: string | null
  signed_at: string | null; start_date: string | null; waarde: number | null
}

export const NIET_MEETELLEN_SLEUTEL = 'vesting_niet_meetellen'

const GETEKEND = new Set(['signed', 'getekend'])
const TESTKLANT = /^test$/i

export const isGetekend = (status: string | null | undefined) => GETEKEND.has(String(status ?? '').toLowerCase())

/**
 * Standaard enkel getekende contracten. Met `ookNietGetekend` ook wat nog bij de
 * klant ligt (verstuurd, bekeken, concept): zo beslissen we bij elk contract dat
 * aangemaakt wordt of het voor Marco meetelt. Getekende eerst, nieuwste bovenaan.
 */
export function teBeoordelen(module: KandidaatContract[], gekoppeld: Set<string>, nietMeetellen: Set<string>, opties: { ookNietGetekend?: boolean } = {}): KandidaatContract[] {
  return module
    .filter((m) => (opties.ookNietGetekend || isGetekend(m.status)) && !gekoppeld.has(m.id) && !nietMeetellen.has(m.id) && !TESTKLANT.test(String(m.klant ?? '').trim()))
    .sort((a, b) => Number(isGetekend(b.status)) - Number(isGetekend(a.status)) || String(b.signed_at ?? '').localeCompare(String(a.signed_at ?? '')))
}

type Dienst = (typeof DIENSTEN)[number]

/** De dienst raden uit de contracttitel; aanpasbaar in het uitgebreide venster. */
export function raadVestingDienst(titel: string): Dienst {
  const t = titel.toLowerCase()
  if (/social|smm|short form|content/.test(t)) return 'Social media management'
  if (/hosting|verhuur/.test(t) && /website|site/.test(t)) return 'Websiteverhuur'
  if (/website|webdesign|webshop|site\b/.test(t)) return 'Webdesign'
  if (/grafisch|design|drukwerk|brochure|logo|banner|rollup|werfdoek/.test(t)) return 'Grafisch ontwerp'
  if (/e-?mail|nieuwsbrief/.test(t)) return 'E-mailmarketing'
  if (/\bai\b|automatisat/.test(t)) return 'AI-automatisatie'
  return 'Andere'
}

export type SnelInvoer = {
  klant: string; client_id: string | null; contract_id: string | null; titel?: string | null
  ondertekend_op: string; start_dienst?: string | null
  /** 'eenmalig' = prijs is het totaal; 'maand' = prijs per maand × maanden. */
  soort: 'eenmalig' | 'maand'
  prijs: number | null; maanden: number | null
  afspraak: boolean; closing: boolean
  /** Gekoppeld contract dat de klant nog niet tekende: de datum volgt bij ondertekening. */
  wachtOpKlant?: boolean
}

export type SnelFout = string | null

export function controleerSnel(i: SnelInvoer): SnelFout {
  if (!i.klant.trim()) return 'Kies of typ de klant.'
  const zonderDatum = !!i.wachtOpKlant && !!i.contract_id && !i.ondertekend_op
  if (!zonderDatum && !/^\d{4}-\d{2}-\d{2}$/.test(i.ondertekend_op)) return 'Vul de datum van ondertekening in.'
  if (i.prijs === null || !Number.isFinite(i.prijs) || i.prijs <= 0) return 'Vul de prijs in (excl. btw).'
  if (i.soort === 'maand' && (i.maanden === null || !Number.isInteger(i.maanden) || i.maanden < 1 || i.maanden > 120)) return 'Hoeveel maanden loopt het contract?'
  return null
}

/** Totale waarde van wat ingevuld is. */
export function snelTotaal(i: Pick<SnelInvoer, 'soort' | 'prijs' | 'maanden'>): number | null {
  if (i.prijs === null || !Number.isFinite(i.prijs)) return null
  if (i.soort === 'eenmalig') return i.prijs
  return i.maanden && i.maanden > 0 ? Math.round(i.prijs * i.maanden * 100) / 100 : null
}

/** De rij voor POST /api/admin/vesting (resource contract), in de velden van het bestaande model. */
export function snelNaarRij(i: SnelInvoer): Record<string, unknown> {
  const basis = {
    resource: 'contract', klant: i.klant.trim(), client_id: i.client_id || null, contract_id: i.contract_id || null,
    ondertekend_op: i.ondertekend_op || null, dienst: raadVestingDienst(i.titel ?? ''),
    appointment_door_marco: i.afspraak, closed_door_marco: i.closing,
    status: 'actief', betalingen_op_schema: true, uitgesloten_kosten: 0,
  }
  if (i.soort === 'maand') {
    return { ...basis, facturatiemodel: 'maandcontract', maandbedrag: i.prijs, duur_maanden: i.maanden, handmatige_totaalwaarde: null, start_dienst: i.start_dienst || i.ondertekend_op || null }
  }
  return { ...basis, facturatiemodel: 'eenmalig', handmatige_totaalwaarde: i.prijs, maandbedrag: null, duur_maanden: null, start_dienst: i.start_dienst || null }
}

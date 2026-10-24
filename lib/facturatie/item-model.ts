// Facturatie-item — PUUR model (client-safe, getest in tests/facturatie-item.test.ts).
//
// Een facturatie-item is wat het team aangeeft dat gefactureerd moet worden:
// klant, geplande datum, artikelen (regels), mededeling en interne notitie.
// Bram neemt het over in het externe facturatiesysteem en markeert het daarna
// als gefactureerd. Hier staan de regels die daarvoor nodig zijn: wat er op de
// factuur mag komen (kopieertekst), en wat er nog ontbreekt.

import { berekenRegel, berekenTotalen, eenheidTekst, type FactuurRegel } from '@/lib/facturen/regels'

export type FactuurType = 'eenmalig' | 'voorschot' | 'saldo' | 'terugkerend'
export const FACTUUR_TYPES: { key: FactuurType; label: string }[] = [
  { key: 'eenmalig', label: 'Eenmalig' }, { key: 'voorschot', label: 'Voorschot' },
  { key: 'saldo', label: 'Saldo' }, { key: 'terugkerend', label: 'Terugkerend' },
]
export const isFactuurType = (v: unknown): v is FactuurType => FACTUUR_TYPES.some((t) => t.key === v)

/** Facturatiegegevens van een klant (uit de centrale klantenlijst). */
export type KlantInfo = {
  id: string
  naam: string
  contact: string | null
  email: string | null
  facturatie_email: string | null
  telefoon: string | null
  btw: string | null
  straat: string | null
  postcode: string | null
  gemeente: string | null
  land: string | null
}

/** Alles wat Bram nodig heeft om één factuur over te nemen. */
export type ItemDetail = {
  klant: KlantInfo | null
  project: string | null
  titel: string | null
  type: string | null
  datum: string
  prestatie_van: string | null
  prestatie_tot: string | null
  periode: string | null
  betaaltermijn: number
  klant_referentie: string | null
  regels: FactuurRegel[]
  mededeling: string | null
  /** Interne notitie voor Bram — komt NOOIT in de kopieertekst. */
  notitie: string | null
  extern_factuurnummer: string | null
}

const eur = (n: number) => `€${n.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const getal = (n: number) => n.toLocaleString('nl-BE', { maximumFractionDigits: 4 })
const datumNl = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '')

export function adresRegels(k: Pick<KlantInfo, 'straat' | 'postcode' | 'gemeente' | 'land'> | null): string[] {
  if (!k) return []
  const plaats = [k.postcode, k.gemeente].filter(Boolean).join(' ')
  return [k.straat, plaats, k.land].map((x) => (x ?? '').trim()).filter(Boolean)
}

export function prestatieTekst(d: Pick<ItemDetail, 'prestatie_van' | 'prestatie_tot' | 'periode'>): string {
  if (d.prestatie_van && d.prestatie_tot) return `${datumNl(d.prestatie_van)} – ${datumNl(d.prestatie_tot)}`
  if (d.prestatie_van) return `vanaf ${datumNl(d.prestatie_van)}`
  return d.periode && !/^\d{4}-\d{2}$/.test(d.periode) ? d.periode : ''
}

/** Eén regel als tekst voor op de factuur: naam, beschrijving en de berekening. */
export function regelKopie(r: FactuurRegel): string {
  const b = berekenRegel(r)
  const korting = [r.korting_pct ? `−${getal(r.korting_pct)}%` : '', r.korting_eur ? `−${eur(r.korting_eur)}` : ''].filter(Boolean).join(' ')
  const lijnen = [r.artikel || r.omschrijving]
  if (r.omschrijving && r.omschrijving !== r.artikel) lijnen.push(r.omschrijving)
  lijnen.push(`${getal(r.aantal)} ${eenheidTekst(r.eenheid, r.aantal)} × ${eur(r.prijs_excl)} excl. btw${korting ? ` (korting ${korting})` : ''} = ${eur(b.excl)} excl. btw · btw ${getal(r.btw_pct)}%`)
  return lijnen.join('\n')
}

/**
 * De factuurgegevens als tekst, om over te nemen in het externe systeem.
 * Bevat ENKEL wat op de factuur hoort — nooit de interne notitie of interne kosten.
 */
export function kopieerTekst(d: ItemDetail): string {
  const t = berekenTotalen(d.regels)
  const kop: string[] = []
  if (d.klant) {
    kop.push(`Klant: ${d.klant.naam}`)
    if (d.klant.btw) kop.push(`Btw-nummer: ${d.klant.btw}`)
    const adres = adresRegels(d.klant)
    if (adres.length) kop.push(`Adres: ${adres.join(', ')}`)
    const mail = d.klant.facturatie_email || d.klant.email
    if (mail) kop.push(`E-mail facturatie: ${mail}`)
    if (d.klant.contact) kop.push(`T.a.v.: ${d.klant.contact}`)
  }
  if (d.klant_referentie) kop.push(`Uw referentie / bestelbon: ${d.klant_referentie}`)
  if (d.project) kop.push(`Project: ${d.project}`)
  const prest = prestatieTekst(d)
  if (prest) kop.push(`Prestatieperiode: ${prest}`)
  kop.push(`Betaaltermijn: ${d.betaaltermijn} dagen`)

  const regels = d.regels.map((r, i) => `${i + 1}. ${regelKopie(r).split('\n').join('\n   ')}`)
  const totaal = [
    `Subtotaal excl. btw: ${eur(t.excl)}`,
    ...t.perBtw.map((p) => `Btw ${getal(p.pct)}%: ${eur(p.btw)}`),
    `Totaal incl. btw: ${eur(t.incl)}`,
  ]
  const delen = [kop.join('\n'), d.titel ? `Omschrijving: ${d.titel}` : '', regels.length ? `Factuurregels\n${regels.join('\n')}` : '', totaal.join('\n')]
  if (d.mededeling?.trim()) delen.push(`Mededeling:\n${d.mededeling.trim()}`)
  return delen.filter(Boolean).join('\n\n')
}

/**
 * Wat er nog ontbreekt om de factuur te kunnen opmaken — concreet, per punt.
 * Een item met ontbrekende gegevens mag bewaard blijven, maar wordt niet
 * ongemerkt als gefactureerd afgewerkt.
 */
export function ontbrekendeGegevens(d: Pick<ItemDetail, 'klant' | 'regels' | 'datum'>): string[] {
  const uit: string[] = []
  if (!d.klant) uit.push('Er is geen klant gekoppeld.')
  if (!d.datum) uit.push('De geplande facturatiedatum ontbreekt.')
  if (d.regels.length === 0) uit.push('Er staat nog geen enkel artikel op.')
  d.regels.forEach((r, i) => {
    const naam = r.artikel || r.omschrijving || `regel ${i + 1}`
    if (!r.artikel && !r.omschrijving) uit.push(`Regel ${i + 1} heeft geen naam of beschrijving.`)
    if (!(r.aantal > 0)) uit.push(`Regel ${i + 1} (${naam}) heeft geen aantal.`)
    if (!(r.prijs_excl > 0)) uit.push(`Regel ${i + 1} (${naam}) heeft nog geen eenheidsprijs.`)
  })
  if (d.regels.length > 0 && berekenTotalen(d.regels).excl <= 0) uit.push('Het totaal is € 0,00.')
  return uit
}

/** Geen blokkade, wel het bekijken waard voor Bram (bv. een klant zonder btw-nummer of adres). */
export function aandachtspunten(d: Pick<ItemDetail, 'klant'>): string[] {
  const uit: string[] = []
  if (d.klant && !d.klant.btw) uit.push(`${d.klant.naam} heeft geen btw-nummer in de klantenlijst.`)
  if (d.klant && adresRegels(d.klant).length === 0) uit.push(`Het facturatieadres van ${d.klant.naam} staat niet in de klantenlijst.`)
  return uit
}

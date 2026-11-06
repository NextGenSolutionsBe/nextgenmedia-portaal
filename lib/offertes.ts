/**
 * Offertes — pure module (browser en server).
 *
 * Een offerte is een pdf (eigen upload of een sjabloon) met een publieke link.
 * Wij versturen ze altijd handmatig via de MailComposer (voorbeeld + knop); de
 * klant bekijkt ze op /offerte/<token> en accepteert met één knop. "Geopend"
 * telt enkel als de klant kijkt, niet als het team de link opent.
 *
 * Sjablonen zijn de achterliggende pdf's (offerte reel, website …). Bij het
 * aanmaken kopiëren we de pdf naar de offerte, zodat een nieuwe prijslijst
 * nooit een al verstuurde offerte verandert.
 */

import { mailMerkVan, MERK_STIJL, type MailMerk } from './merk-mail'

export const OFFERTE_BUCKET = 'offertes'
export const MAX_PDF = 25 * 1024 * 1024
export const GELDIG_DAGEN = 30
/** Na zoveel dagen zonder akkoord staat een verstuurde offerte in "Opvolgen". */
export const OPVOLGEN_NA_DAGEN = 3

export type OfferteStatus = 'concept' | 'verstuurd' | 'geaccepteerd' | 'ingetrokken'

export type Offerte = {
  id: string; client_id: string | null; opdracht_id: string | null; klant_naam: string | null
  titel: string; bedrag_excl: number | null; merk: MailMerk; sjabloon_id: string | null
  pdf_pad: string; pdf_naam: string | null; token: string; status: OfferteStatus
  ontvanger_email: string | null; ontvanger_naam: string | null; geldig_tot: string | null
  verstuurd_op: string | null; klant_geopend_op: string | null; laatst_geopend_op: string | null; aantal_keer_geopend: number
  geaccepteerd_op: string | null; geaccepteerd_door: string | null; ingetrokken_op: string | null
  created_at: string; created_by_email: string | null
}

/** Wat de projectkaart van een offerte toont. */
export type OfferteOpKaart = Pick<Offerte, 'id' | 'titel' | 'status' | 'bedrag_excl' | 'verstuurd_op' | 'klant_geopend_op' | 'geaccepteerd_op' | 'geldig_tot'>

export type Sjabloon = {
  id: string; naam: string; merk: MailMerk; dienst: string | null; beschrijving: string | null
  pdf_pad: string; pdf_naam: string | null; bytes: number | null; actief: boolean; volgorde: number; updated_at: string
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PAD_OFFERTE = new RegExp(`^offertes/${UUID}/[A-Za-z0-9._-]{1,140}\\.pdf$`)
const PAD_SJABLOON = new RegExp(`^sjablonen/${UUID}/[A-Za-z0-9._-]{1,140}\\.pdf$`)
export const geldigOffertePad = (p: unknown): p is string => typeof p === 'string' && PAD_OFFERTE.test(p)
export const geldigSjabloonPad = (p: unknown): p is string => typeof p === 'string' && PAD_SJABLOON.test(p)

/** Een veilige bestandsnaam voor in de opslag; de echte naam bewaren we apart. */
export function veiligePdfNaam(naam: string): string {
  const basis = String(naam ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 120)
  return `${basis || 'offerte'}.pdf`
}

const dagPlus = (vandaag: string, n: number) => { const d = new Date(`${vandaag}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const isDag = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))

/** Bedrag uit invoer ("1.250,50", "4950", 4950) naar een getal; leeg = null; onzin = undefined. */
export function leesBedrag(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : undefined
  let s = String(v).replace(/[€\s]/g, '')
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined
}

export type NieuweOfferte = {
  titel: string; bedrag_excl: number | null; geldig_tot: string; merk: MailMerk
  sjabloon_id: string | null; eigen_pad: string | null; eigen_naam: string | null
  client_id: string | null; opdracht_id: string | null; klant_naam: string | null
}

/** Wat het venster "Stuur offerte" meestuurt nakijken. `vandaag` als JJJJ-MM-DD. */
export function valideerOfferte(b: Record<string, unknown>, vandaag: string): { ok: true; waarde: NieuweOfferte } | { ok: false; fout: string } {
  const titel = String(b.titel ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (titel.length < 2) return { ok: false, fout: 'Geef de offerte een titel.' }
  const bedrag = leesBedrag(b.bedrag_excl)
  if (bedrag === undefined) return { ok: false, fout: 'Dat bedrag begrijpen we niet. Gebruik bv. 1250 of 1.250,50.' }
  const geldig = b.geldig_tot === undefined || b.geldig_tot === null || b.geldig_tot === '' ? dagPlus(vandaag, GELDIG_DAGEN) : b.geldig_tot
  if (!isDag(geldig)) return { ok: false, fout: 'Kies tot wanneer de offerte geldig is.' }
  if (geldig < vandaag) return { ok: false, fout: 'De geldigheid ligt in het verleden.' }
  const sjabloon = typeof b.sjabloon_id === 'string' && new RegExp(`^${UUID}$`).test(b.sjabloon_id) ? b.sjabloon_id : null
  const eigen = geldigOffertePad(b.eigen_pad) ? b.eigen_pad : null
  if (!sjabloon && !eigen) return { ok: false, fout: 'Kies een sjabloon of laad een pdf op.' }
  if (sjabloon && eigen) return { ok: false, fout: 'Kies ofwel een sjabloon, ofwel een eigen pdf.' }
  const uuid = (v: unknown) => (typeof v === 'string' && new RegExp(`^${UUID}$`).test(v) ? v : null)
  const clientId = uuid(b.client_id)
  const klantNaam = String(b.klant_naam ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null
  if (!clientId && !klantNaam) return { ok: false, fout: 'Voor welke klant is de offerte?' }
  return {
    ok: true,
    waarde: {
      titel, bedrag_excl: bedrag, geldig_tot: geldig, merk: mailMerkVan(b.merk),
      sjabloon_id: sjabloon, eigen_pad: eigen, eigen_naam: eigen ? String(b.eigen_naam ?? '').slice(0, 160) || null : null,
      client_id: clientId, opdracht_id: uuid(b.opdracht_id), klant_naam: klantNaam,
    },
  }
}

export const isVerlopen = (o: Pick<Offerte, 'status' | 'geldig_tot'>, vandaag: string): boolean =>
  o.status === 'verstuurd' && !!o.geldig_tot && o.geldig_tot < vandaag

const datumKort = (iso: string, nu: Date) => {
  const d = new Date(iso)
  const jaar = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }).slice(0, 4) !== nu.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }).slice(0, 4)
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', ...(jaar ? { year: 'numeric' } : {}), timeZone: 'Europe/Brussels' })
}

export type Weergave = { label: string; kleur: 'grijs' | 'blauw' | 'amber' | 'groen' | 'rood'; sub: string | null }

/** Hoe de offerte er in lijsten uitziet: status en wat de klant al deed. */
export function offerteWeergave(o: Pick<Offerte, 'status' | 'geldig_tot' | 'verstuurd_op' | 'klant_geopend_op' | 'geaccepteerd_op' | 'geaccepteerd_door'>, nu: Date = new Date()): Weergave {
  const vandaag = nu.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  if (o.status === 'concept') return { label: 'Concept', kleur: 'grijs', sub: 'Nog niet verstuurd' }
  if (o.status === 'ingetrokken') return { label: 'Ingetrokken', kleur: 'grijs', sub: null }
  if (o.status === 'geaccepteerd') return { label: 'Geaccepteerd', kleur: 'groen', sub: o.geaccepteerd_op ? `op ${datumKort(o.geaccepteerd_op, nu)}${o.geaccepteerd_door ? ` door ${o.geaccepteerd_door}` : ''}` : null }
  const geopend = o.klant_geopend_op ? `Door klant geopend op ${datumKort(o.klant_geopend_op, nu)}` : 'Nog niet geopend door de klant'
  if (isVerlopen(o, vandaag)) return { label: 'Verlopen', kleur: 'rood', sub: geopend }
  return { label: o.klant_geopend_op ? 'Geopend' : 'Verstuurd', kleur: o.klant_geopend_op ? 'amber' : 'blauw', sub: `${o.verstuurd_op ? `Verstuurd ${datumKort(o.verstuurd_op, nu)} · ` : ''}${geopend}` }
}

/** Moet het team deze offerte opvolgen? Verstuurd, niet geaccepteerd, en al een paar dagen stil of verlopen. */
export function moetOpvolgen(o: Pick<Offerte, 'status' | 'verstuurd_op' | 'geldig_tot'>, nu: Date = new Date()): boolean {
  if (o.status !== 'verstuurd' || !o.verstuurd_op) return false
  const vandaag = nu.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  if (isVerlopen(o, vandaag)) return true
  return nu.getTime() - new Date(o.verstuurd_op).getTime() >= OPVOLGEN_NA_DAGEN * 86_400_000
}

/** Standaardmail bij een offerte; de mens past ze aan in de MailComposer. */
export function offerteMail(o: { contact: string | null; klant: string | null; titel: string; geldigTot: string | null; merk: MailMerk }): { onderwerp: string; tekst: string; knop: string } {
  const m = MERK_STIJL[mailMerkVan(o.merk)]
  const tot = o.geldigTot ? new Date(`${o.geldigTot}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  const aanhef = o.contact?.trim().split(/\s+/)[0] || null
  return {
    onderwerp: `Offerte: ${o.titel}`,
    tekst: [
      `Beste${aanhef ? ` ${aanhef}` : ''},`,
      '',
      `Zoals beloofd vind je hieronder onze offerte voor ${o.titel}${o.klant ? ` voor ${o.klant}` : ''}.`,
      '',
      `Met de knop hieronder bekijk je de offerte. Klopt alles, dan kan je ze daar meteen accepteren.${tot ? ` De offerte is geldig tot ${tot}.` : ''}`,
      '',
      'Vragen of iets aanpassen? Antwoord gewoon op deze mail.',
      '',
      'Met vriendelijke groet,',
      m.naam,
    ].join('\n'),
    knop: 'Offerte bekijken',
  }
}

/** Publieke link van een offerte. */
export const offerteLink = (basis: string, token: string): string => `${basis.replace(/\/$/, '')}/offerte/${encodeURIComponent(token)}`

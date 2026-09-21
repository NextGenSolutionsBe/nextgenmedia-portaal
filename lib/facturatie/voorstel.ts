// Factuurvoorstel uit een contract — pure module (client-safe, testbaar).
//
// Een ondertekend contract (of een medewerker die op "Factuurplanning
// genereren" klikt) levert een VOORSTEL van toekomstige facturen op. Dat zijn
// nog geen facturen: een mens controleert, past aan en bevestigt. Pas bij de
// bevestiging worden er facturen aangemaakt (in één transactie, zie de
// databankfunctie bevestig_factuurplanning).
//
// Wat onduidelijk is wordt NIET geraden: het veld krijgt "controle vereist" en
// de gebruiker vult het zelf in. Elke geïnterpreteerde waarde krijgt een bron
// mee, zodat het scherm kan tonen wat de app afleidde en wat een mens aanpaste.

import { leidSchemaAf, type ContractRij, type KlantRij, type OpdrachtType } from './schema'
import { nieuweRegel, berekenTotalen, normaliseerRegels, type FactuurRegel } from '@/lib/facturen/regels'
import { normaliseerVerzendstatus, isAfgesloten, type Verzendstatus } from '@/lib/facturen/status'

export type Bron = 'contract' | 'afgeleid' | 'handmatig' | 'controle'

/** Eén voorgestelde factuur, zoals ze in contract_facturatie_opdrachten komt. */
export type Voorstelregel = {
  volgnr: number
  aantal: number
  type: OpdrachtType
  factuurdatum: string
  periode: string | null
  omschrijving: string
  bedrag_excl: number | null
  btw_pct: number
  betalingstermijn_dagen: number | null
  regels: FactuurRegel[]
  /** Per veld: waar de waarde vandaan komt. */
  bron_velden: Record<string, Bron>
  ontbrekend: string[]
  aandachtspunten: string[]
}

export type Interpretatie = { veld: string; label: string; waarde: string | null; bron: Bron }

export type Voorstel = {
  regels: Voorstelregel[]
  ontbrekend: string[]
  aandachtspunten: string[]
  /** Wat de app uit het contract las, voor het overzicht "geïnterpreteerde gegevens". */
  interpretatie: Interpretatie[]
  eenmalig: boolean
}

const FREQ_LABEL: Record<string, string> = { eenmalig: 'Eenmalig', maandelijks: 'Maandelijks', kwartaal: 'Per kwartaal', aangepast: 'Aangepast' }
const eur = (n: number) => `€ ${n.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Het voorstel: de momenten uit leidSchemaAf() (bestaande, geteste afleiding),
 * elk met één contractuele factuurregel en de bronnen per veld.
 */
export function maakVoorstel(c: ContractRij, klant: KlantRij | null, btw = 21, betalingstermijn: number | null = 30, nu?: string): Voorstel {
  const schema = leidSchemaAf(c, klant, nu)
  const ontbrekend = schema.ontbrekend
  const titel = c.title ?? 'Contract'
  const bedragOk = c.expected_invoice_amount_excl !== null && Number(c.expected_invoice_amount_excl) > 0
  const freq = (c.invoice_frequency ?? '').trim()
  const eenmalig = schema.momenten.length === 1 && schema.momenten[0].type === 'volledig' && ontbrekend.length === 0

  const bronBedrag: Bron = bedragOk ? 'contract' : 'controle'
  const bronDatum: Bron = c.start_date ? 'contract' : c.signed_at ? 'afgeleid' : 'controle'
  const regels: Voorstelregel[] = schema.momenten.map((m) => {
    const excl = m.bedrag_excl
    const regel = excl === null ? [] : [nieuweRegel({ artikel: titel.slice(0, 120), omschrijving: m.omschrijving, aantal: 1, eenheid: 'forfait', prijs_excl: excl, is_extra: false }, btw)]
    return {
      volgnr: m.volgnr, aantal: m.aantal, type: m.type, factuurdatum: m.factuurdatum, periode: m.periode,
      omschrijving: m.omschrijving, bedrag_excl: excl, btw_pct: btw, betalingstermijn_dagen: betalingstermijn,
      regels: regel,
      bron_velden: { factuurdatum: bronDatum, bedrag_excl: bronBedrag, omschrijving: 'afgeleid', btw_pct: 'afgeleid', periode: 'afgeleid', betalingstermijn_dagen: betalingstermijn === null ? 'controle' : 'afgeleid' },
      ontbrekend: schema.ontbrekend, aandachtspunten: schema.aandachtspunten,
    }
  })

  const interpretatie: Interpretatie[] = [
    { veld: 'klant', label: 'Klant', waarde: klant?.company_name ?? null, bron: klant ? 'contract' : 'controle' },
    { veld: 'titel', label: 'Contract / project', waarde: c.title ?? null, bron: c.title ? 'contract' : 'controle' },
    { veld: 'contractnummer', label: 'Contractnummer', waarde: `NGM-${c.id.slice(0, 8).toUpperCase()}`, bron: 'afgeleid' },
    { veld: 'start_date', label: 'Startdatum', waarde: c.start_date ?? (c.signed_at ? String(c.signed_at).slice(0, 10) : null), bron: bronDatum },
    { veld: 'end_date', label: 'Einddatum', waarde: c.end_date ?? null, bron: c.end_date ? 'contract' : c.duration_type === 'onbepaald' ? 'afgeleid' : 'controle' },
    { veld: 'looptijd', label: 'Looptijd', waarde: c.duration_type ?? null, bron: c.duration_type ? 'contract' : 'controle' },
    { veld: 'frequentie', label: 'Facturatiefrequentie', waarde: freq ? (FREQ_LABEL[freq] ?? freq) : null, bron: freq ? 'contract' : 'controle' },
    { veld: 'aantal', label: 'Aantal facturen', waarde: ontbrekend.length ? null : String(schema.momenten.length), bron: c.expected_invoice_count ? 'contract' : ontbrekend.length ? 'controle' : 'afgeleid' },
    { veld: 'bedrag', label: 'Bedrag per factuur (excl. btw)', waarde: bedragOk ? eur(Number(c.expected_invoice_amount_excl)) : null, bron: bronBedrag },
    { veld: 'btw', label: 'Btw-tarief', waarde: `${btw} %`, bron: 'afgeleid' },
    { veld: 'facturatiemoment', label: 'Facturatiemoment', waarde: schema.momenten.length && !ontbrekend.length ? `dag ${Number(schema.momenten[0].factuurdatum.slice(8, 10))} van de periode` : null, bron: 'afgeleid' },
    { veld: 'betalingstermijn', label: 'Betaaltermijn', waarde: betalingstermijn === null ? null : `${betalingstermijn} dagen`, bron: betalingstermijn === null ? 'controle' : 'afgeleid' },
    { veld: 'valuta', label: 'Valuta', waarde: 'EUR', bron: 'afgeleid' },
    { veld: 'voorschot', label: 'Voorschot / slotfactuur', waarde: 'geen in het contract vastgelegd', bron: 'afgeleid' },
  ]

  return { regels, ontbrekend, aandachtspunten: schema.aandachtspunten, interpretatie, eenmalig }
}

/** Bedrag van een voorstel: som van de regels als die er zijn, anders het losse bedrag. */
export function voorstelBedrag(v: { bedrag_excl: number | null; btw_pct: number; regels?: unknown }): { excl: number | null; btw: number; incl: number | null } {
  const regels = normaliseerRegels(v.regels, v.btw_pct)
  if (regels.length > 0) { const t = berekenTotalen(regels); return { excl: t.excl, btw: t.btw, incl: t.incl } }
  if (v.bedrag_excl === null || v.bedrag_excl === undefined) return { excl: null, btw: 0, incl: null }
  const excl = Math.round(Number(v.bedrag_excl) * 100) / 100
  const btw = Math.round(excl * v.btw_pct) / 100
  return { excl, btw, incl: Math.round((excl + btw) * 100) / 100 }
}

/** Verplichte velden vóór bevestiging. Leeg = in orde. */
export function valideerVoorstel(v: { factuurdatum: string | null; omschrijving: string | null; bedrag_excl: number | null; btw_pct: number | null; regels?: unknown; client_id?: string | null }): string[] {
  const fouten: string[] = []
  if (!v.factuurdatum || !/^\d{4}-\d{2}-\d{2}$/.test(v.factuurdatum)) fouten.push('factuurdatum ontbreekt')
  if (!v.omschrijving?.trim()) fouten.push('omschrijving ontbreekt')
  const b = voorstelBedrag({ bedrag_excl: v.bedrag_excl, btw_pct: v.btw_pct ?? 21, regels: v.regels })
  if (b.excl === null || b.excl <= 0) fouten.push('bedrag ontbreekt')
  if (v.btw_pct === null || v.btw_pct === undefined || v.btw_pct < 0) fouten.push('btw-tarief ontbreekt')
  if (v.client_id === null) fouten.push('klant ontbreekt op het contract')
  return fouten
}

// ── Samenvatting per contract ───────────────────────────────────────────────

export type FactuurVoorSamenvatting = {
  status: string
  amount_excl: number
  amount_incl: number
  betaald_bedrag?: number | null
  /** Contractueel deel excl. btw (null = volledig contractueel). */
  contract_bedrag_excl?: number | null
}
export type VoorstelVoorSamenvatting = { status: string; bedrag_excl: number | null; invoice_id: string | null }

export type ContractSamenvatting = {
  contractwaarde: number | null
  /** Alles wat als factuur bestaat, zonder geannuleerd/gecrediteerd (excl. btw). */
  bevestigd: number
  extraKosten: number
  verstuurd: number
  ontvangen: number
  nogTeVersturen: number
  nogTeOntvangen: number
  /** Nog niet bevestigde voorstellen (excl. btw). */
  inVoorstel: number
  aantal: { voorstellen: number; teVersturen: number; verstuurd: number; geannuleerd: number; totaal: number }
  voortgangPct: number
}

const rond = (n: number) => Math.round(n * 100) / 100

/**
 * De kaarten boven het factuuroverzicht van een contract. Regels:
 *  · geannuleerd/gecrediteerd telt nergens als "nog te versturen" of "te ontvangen";
 *  · ontvangen = wat effectief betaald is (naar excl. omgerekend via de verhouding);
 *  · een ondertekend contract of een onbetaalde factuur is géén ontvangen omzet.
 */
export function contractSamenvatting(p: { contractwaarde: number | null; facturen: FactuurVoorSamenvatting[]; voorstellen: VoorstelVoorSamenvatting[] }): ContractSamenvatting {
  let bevestigd = 0, extra = 0, verstuurd = 0, ontvangen = 0, nogTeVersturen = 0, nogTeOntvangen = 0
  let nTe = 0, nV = 0, nG = 0
  for (const f of p.facturen) {
    const s: Verzendstatus = normaliseerVerzendstatus(f.status)
    if (isAfgesloten(s)) { nG++; continue }
    const excl = Number(f.amount_excl) || 0, incl = Number(f.amount_incl) || 0
    const contractueel = f.contract_bedrag_excl === null || f.contract_bedrag_excl === undefined ? excl : Math.min(excl, Number(f.contract_bedrag_excl) || 0)
    bevestigd += excl
    extra += Math.max(0, excl - contractueel)
    if (s === 'verstuurd') {
      nV++; verstuurd += excl
      const betaald = Math.max(0, Number(f.betaald_bedrag) || 0)
      const deel = incl > 0 ? Math.min(1, betaald / incl) : 0
      const ontv = rond(excl * deel)
      ontvangen += ontv
      nogTeOntvangen += Math.max(0, excl - ontv)
    } else { nTe++; nogTeVersturen += excl }
  }
  const openVoorstellen = p.voorstellen.filter((v) => !v.invoice_id && (v.status === 'open' || v.status === 'controle_vereist'))
  const inVoorstel = openVoorstellen.reduce((t, v) => t + (Number(v.bedrag_excl) || 0), 0)
  const totaal = nTe + nV
  return {
    contractwaarde: p.contractwaarde,
    bevestigd: rond(bevestigd), extraKosten: rond(extra), verstuurd: rond(verstuurd), ontvangen: rond(ontvangen),
    nogTeVersturen: rond(nogTeVersturen), nogTeOntvangen: rond(nogTeOntvangen), inVoorstel: rond(inVoorstel),
    aantal: { voorstellen: openVoorstellen.length, teVersturen: nTe, verstuurd: nV, geannuleerd: nG, totaal },
    voortgangPct: totaal > 0 ? Math.round((nV / totaal) * 100) : 0,
  }
}

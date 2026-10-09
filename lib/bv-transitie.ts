/**
 * BV-transitie — de overgang van drie eenmanszaken naar één BV.
 *
 * Drie vragen die in die overgangsmaanden telkens terugkomen:
 *
 *  1. Wie heeft er nog wat persoonlijk te goed in de BV? Een factuur van de BV
 *     die eigenlijk in iemands eenmanszaak thuishoorde, telt als een recht (+).
 *     Een privé-uitgave die de BV voor iemand droeg, telt ertegenin (−).
 *  2. Hoe verdelen we de gezamenlijke winst van juni tot oktober, als ieder
 *     al een deel op zijn rekening kreeg en zelf kosten voorschoot?
 *  3. Hoeveel moet ieder opzijzetten voor sociale bijdragen en belasting op
 *     zijn eenmanszaak?
 *
 * PURE MODULE: geen database, geen server-only imports. De formules zijn één
 * op één overgenomen uit BV_transitie_opvolger.xlsx, inclusief de keuzes die
 * dat bestand maakt (zie de opmerkingen bij de raming). Waar het Excel een
 * fout bevatte — een ontbrekende formule, een verwijzing naar de verkeerde
 * kolom — is hier de bedoeling gevolgd; dat staat telkens bij de code.
 *
 * Het is een interne opvolging en een raming, geen aangifte. De boekhouder
 * beslist hoe dit juridisch verwerkt wordt.
 */

export type Persoon = 'bram' | 'chiara' | 'marco'
export const PERSONEN: Persoon[] = ['bram', 'chiara', 'marco']
export const PERSOON_LABEL: Record<Persoon, string> = { bram: 'Bram', chiara: 'Chiara', marco: 'Marco' }

export type RechtType = 'factuur_bv_ez' | 'prive_voordeel' | 'terugbetaling' | 'correctie'
export const RECHT_TYPES: { type: RechtType; label: string; richting: 1 | -1 | null; uitleg: string }[] = [
  { type: 'factuur_bv_ez', label: 'Factuur BV → EZ', richting: 1, uitleg: 'Creëert een persoonlijk recht voor degene wiens eenmanszaak gefactureerd wordt.' },
  { type: 'prive_voordeel', label: 'Privé voordeel betaald door BV', richting: -1, uitleg: 'Bijvoorbeeld een auto, materiaal of andere uitgave met directe persoonlijke baat.' },
  { type: 'terugbetaling', label: 'Persoonlijke terugbetaling', richting: -1, uitleg: 'Als de BV effectief aan jullie terugbetaalt.' },
  { type: 'correctie', label: 'Correctie', richting: null, uitleg: 'Kies zelf +1 of −1.' },
]
export const KOST_CATEGORIEEN = ['Oprichtingskost', 'Boekhouding', 'Juridisch', 'Software', 'Materiaal', 'Auto / huur', 'Marketing', 'Andere'] as const
export type BetaaldDoor = 'bv' | 'bram_prive' | 'chiara_prive' | 'marco_prive'
export const BETAALD_DOOR_LABEL: Record<BetaaldDoor, string> = { bv: 'BV', bram_prive: 'Bram privé', chiara_prive: 'Chiara privé', marco_prive: 'Marco privé' }

export type Recht = {
  id: string; datum: string; persoon: Persoon; type: RechtType; omschrijving: string | null
  bedrag_excl: number; richting: 1 | -1; bewijs: string | null; notitie: string | null
}
export type Kost = {
  id: string; datum: string; leverancier: string | null; categorie: string | null; omschrijving: string | null
  bedrag_excl: number; btw_pct: number; betaald_door: BetaaldDoor; verrekenen_met: Persoon | null
}
export type Winstverdeling = {
  persoon: Persoon
  ontvangen_op_rekening: number; nog_te_ontvangen: number
  zakelijke_kosten_betaald: number; prive_gebruikt: number; al_ontvangen: number
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

// ── Rechtenbalans en BV-kosten ───────────────────────────────────────────────

/** Effect van één regel op het persoonlijk recht: bedrag × richting. */
export const rechtEffect = (r: Pick<Recht, 'bedrag_excl' | 'richting'>): number => n(r.bedrag_excl) * r.richting

/** Effect van een BV-kost op iemands recht: −bedrag als hij met iemand verrekend wordt. */
export const kostEffect = (k: Pick<Kost, 'bedrag_excl' | 'verrekenen_met'>): number => (k.verrekenen_met ? -n(k.bedrag_excl) : 0)
export const kostBtw = (k: Pick<Kost, 'bedrag_excl' | 'btw_pct'>): number => n(k.bedrag_excl) * n(k.btw_pct) / 100
export const kostIncl = (k: Pick<Kost, 'bedrag_excl' | 'btw_pct'>): number => n(k.bedrag_excl) + kostBtw(k)

export type RechtenPerPersoon = {
  persoon: Persoon
  /** Som van de rechtenbalans. */
  bruto: number
  /** Som van de privé-voordelen via BV-kosten (negatief). */
  priveVoordelen: number
  /** Wat er netto nog te goed staat. */
  netto: number
}

export function rechtenPerPersoon(rechten: Recht[], kosten: Kost[]): RechtenPerPersoon[] {
  return PERSONEN.map((p) => {
    const bruto = rechten.filter((r) => r.persoon === p).reduce((s, r) => s + rechtEffect(r), 0)
    const priveVoordelen = kosten.filter((k) => k.verrekenen_met === p).reduce((s, k) => s + kostEffect(k), 0)
    return { persoon: p, bruto, priveVoordelen, netto: bruto + priveVoordelen }
  })
}

export type Kerncijfers = {
  totaalRechten: number
  opstartkosten: number
  priveVerrekend: number
  nietToegewezen: number
}

export function kerncijfers(rechten: Recht[], kosten: Kost[]): Kerncijfers {
  const per = rechtenPerPersoon(rechten, kosten)
  return {
    totaalRechten: per.reduce((s, p) => s + p.netto, 0),
    opstartkosten: kosten.filter((k) => k.categorie === 'Oprichtingskost').reduce((s, k) => s + n(k.bedrag_excl), 0),
    priveVerrekend: -kosten.reduce((s, k) => s + kostEffect(k), 0),
    nietToegewezen: kosten.filter((k) => !k.verrekenen_met).reduce((s, k) => s + n(k.bedrag_excl), 0),
  }
}

// ── Verdeling gezamenlijke winst ─────────────────────────────────────────────

export type VerdelingBerekend = Winstverdeling & {
  /** Ontvangen + nog te ontvangen − zakelijke kosten. */
  nettoPot: number
  /** Een derde van de totale pot. */
  recht: number
  /** Recht − privé gebruikt − al ontvangen. Positief: nog te krijgen; negatief: af te staan. */
  saldo: number
  betekenis: 'Nog ontvangen' | 'Moet afstaan' | 'In orde'
}

export function berekenVerdeling(rijen: Winstverdeling[]): { personen: VerdelingBerekend[]; totaalPot: number } {
  const volledig = PERSONEN.map((p) => rijen.find((r) => r.persoon === p) ?? {
    persoon: p, ontvangen_op_rekening: 0, nog_te_ontvangen: 0, zakelijke_kosten_betaald: 0, prive_gebruikt: 0, al_ontvangen: 0,
  })
  const potten = volledig.map((r) => n(r.ontvangen_op_rekening) + n(r.nog_te_ontvangen) - n(r.zakelijke_kosten_betaald))
  const totaalPot = potten.reduce((s, x) => s + x, 0)
  const recht = totaalPot / PERSONEN.length
  const personen = volledig.map((r, idx) => {
    const saldo = recht - n(r.prive_gebruikt) - n(r.al_ontvangen)
    return {
      ...r, nettoPot: potten[idx], recht, saldo,
      betekenis: saldo > 0 ? 'Nog ontvangen' as const : saldo < 0 ? 'Moet afstaan' as const : 'In orde' as const,
    }
  })
  return { personen, totaalPot }
}

// ── Eenmanszaak: sociale bijdragen en belastingraming ────────────────────────

export type Statuut = 'hoofdberoep' | 'bijberoep' | 'primostarter'
export const STATUUT_LABEL: Record<Statuut, string> = { hoofdberoep: 'Hoofdberoep', bijberoep: 'Bijberoep', primostarter: 'Primostarter' }

export type Aannames = {
  jaar: number
  gemeentebelasting: number
  beheerskost_fonds: number
  soc_laag: number
  soc_hoog: number
  soc_grens1: number
  soc_grens2: number
  min_jaarbijdrage_hoofd: number
  vrijstelling_bijberoep: number
  belastingvrije_som: number
  schijf1_grens: number; schijf1_tarief: number
  schijf2_grens: number; schijf2_tarief: number
  schijf3_grens: number; schijf3_tarief: number
  schijf4_tarief: number
}

export const STANDAARD_AANNAMES: Omit<Aannames, 'jaar'> = {
  gemeentebelasting: 0.07, beheerskost_fonds: 0.0305, soc_laag: 0.205, soc_hoog: 0.1416,
  soc_grens1: 75024.54, soc_grens2: 110562.42, min_jaarbijdrage_hoofd: 3561.68, vrijstelling_bijberoep: 1922.16,
  belastingvrije_som: 11180, schijf1_grens: 16720, schijf1_tarief: 0.25, schijf2_grens: 29510, schijf2_tarief: 0.40,
  schijf3_grens: 51070, schijf3_tarief: 0.45, schijf4_tarief: 0.50,
}

export function leesAannames(jaar: number, rij: Record<string, unknown> | null | undefined): Aannames {
  const uit: Aannames = { jaar, ...STANDAARD_AANNAMES }
  if (!rij) return uit
  for (const k of Object.keys(STANDAARD_AANNAMES) as (keyof typeof STANDAARD_AANNAMES)[]) {
    const v = rij[k]
    if (v !== undefined && v !== null && v !== '') uit[k] = Number(v)
  }
  return uit
}

export type EzInvoer = {
  persoon: Persoon
  winst: number
  andere_inkomsten: number
  aftrekken: number
  statuut: Statuut
  kwartalen: number
}

export type EzRaming = EzInvoer & {
  socialeBijdragen: number
  belastbaar: number
  federaalVoorVrijstelling: number
  belastingkorting: number
  federaalNa: number
  gemeentebelasting: number
  totaalPB: number
  /** Belasting die enkel door de eenmanszaak veroorzaakt wordt. */
  ezBelasting: number
  netto: number
  /** Deel van de winst dat opzij moet: (bijdragen + belasting) / winst. */
  reserveren: number
}

/**
 * Sociale bijdragen zoals het Excel ze raamt.
 *
 * Bijberoep: niets onder de vrijstellingsgrens, daarboven het lage tarief op
 * de volledige winst plus de beheerskost. Hoofdberoep en primostarter: het
 * lage tarief op de volledige winst, met de minimumbijdrage als vloer, plus
 * beheerskost.
 *
 * Bewust zo overgenomen: het hoge tarief en de inkomensgrenzen staan wel in
 * de aannames, maar het Excel gebruikt ze niet. Voor winsten onder €75.000
 * maakt dat niets uit.
 */
export function socialeBijdragen(winst: number, statuut: Statuut, a: Aannames): number {
  if (!winst) return 0
  if (statuut === 'bijberoep') {
    return winst < a.vrijstelling_bijberoep ? 0 : winst * a.soc_laag * (1 + a.beheerskost_fonds)
  }
  return Math.max(a.min_jaarbijdrage_hoofd, winst * a.soc_laag) * (1 + a.beheerskost_fonds)
}

/** Federale personenbelasting vóór de belastingvrije som, met de vier schijven. */
export function federaleBelasting(inkomen: number, a: Aannames): number {
  const x = Math.max(0, inkomen)
  return Math.min(x, a.schijf1_grens) * a.schijf1_tarief
    + Math.max(0, Math.min(x, a.schijf2_grens) - a.schijf1_grens) * a.schijf2_tarief
    + Math.max(0, Math.min(x, a.schijf3_grens) - a.schijf2_grens) * a.schijf3_tarief
    + Math.max(0, x - a.schijf3_grens) * a.schijf4_tarief
}

/** De korting door de belastingvrije som: die som tegen het laagste tarief, nooit meer dan de belasting zelf. */
export const belastingkorting = (federaal: number, a: Aannames): number =>
  Math.min(federaal, a.belastingvrije_som * a.schijf1_tarief)

export function berekenEz(inv: EzInvoer, a: Aannames): EzRaming {
  const winst = n(inv.winst)
  const soc = socialeBijdragen(winst, inv.statuut, a)
  const belastbaar = Math.max(0, winst - soc + n(inv.andere_inkomsten) - n(inv.aftrekken))
  const federaal = federaleBelasting(belastbaar, a)
  const korting = belastingkorting(federaal, a)
  const federaalNa = Math.max(0, federaal - korting)
  const gemeente = federaalNa * a.gemeentebelasting
  const totaal = federaalNa + gemeente

  // Wat zou de belasting zijn ZONDER de eenmanszaak (enkel de andere
  // inkomsten)? Het verschil is wat de eenmanszaak zelf kost.
  const andere = n(inv.andere_inkomsten)
  const fedAnder = federaleBelasting(andere, a)
  const belastingZonderEz = (fedAnder - belastingkorting(fedAnder, a)) * (1 + a.gemeentebelasting)
  const ezBelasting = Math.max(0, totaal - belastingZonderEz)

  const netto = winst - soc - ezBelasting
  const reserveren = winst > 0 ? (soc + ezBelasting) / winst : 0

  return {
    ...inv, socialeBijdragen: soc, belastbaar, federaalVoorVrijstelling: federaal, belastingkorting: korting,
    federaalNa, gemeentebelasting: gemeente, totaalPB: totaal, ezBelasting, netto, reserveren,
  }
}

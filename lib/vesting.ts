/**
 * Vestigingsprincipe — het contractmodel van de samenwerkingsovereenkomst.
 *
 * Marco verwerft aandelen (0% → maximaal 33%) op twee manieren:
 *
 *  1. De WAM-portefeuille: zijn eigen klanten van vóór de samenwerking. Elke
 *     volledige €5.000 netto ontvangen levert 1% op, tot 5%. Kosten die bij
 *     WAM gemaakt worden gaan er eerst af.
 *  2. Contracten die hij binnenhaalt. De ONDERTEKENINGSDATUM bepaalt het
 *     contractjaar en daarmee het tarief boven de eerste 10%: jaar 1 €10.000
 *     per procent, jaar 2 €12.000, jaar 3 €15.000. Tot een totaal van 10%
 *     geldt een goedkoper regulier tarief van €5.000 per procent.
 *
 * Wat meetelt hangt af van de status. Actief = voorlopig, voltooid =
 * definitief, vroegtijdig stopgezet of niet-betaler = €0. Een contract telt
 * naar rato van Marco's aandeel in het binnenhalen: 50% voor de afspraak, 50%
 * voor het closen.
 *
 * Bram krijgt wat Marco niet verwerft; Chiara staat vast op 33%.
 *
 * PURE MODULE. Geen database, geen server-only imports: dezelfde berekening
 * draait op de server en in het scherm, en is los te controleren tegen het
 * Excel waaruit dit model komt (MARCO VESTIGINGSPRINCIPE.xlsx). Alle drempels
 * komen uit `VestingInstellingen`; er staat hier geen enkel getal hard.
 *
 * Wijzigt geen echte aandelen. Dit is de berekening, niet de notaris.
 */

export type ContractStatus = 'actief' | 'voltooid' | 'stopgezet' | 'niet_betaler'
export type Facturatiemodel = 'maandcontract' | 'eenmalig'
export type Contractjaar = 'jaar1' | 'jaar2' | 'jaar3' | 'buiten'
export type Erkenning = 'voorlopig' | 'definitief' | 'uitgesloten' | 'onvolledig'

export const STATUS_LABEL: Record<ContractStatus, string> = {
  actief: 'Actief', voltooid: 'Voltooid', stopgezet: 'Vroegtijdig stopgezet', niet_betaler: 'Niet-betaler',
}
export const ERKENNING_LABEL: Record<Erkenning, string> = {
  voorlopig: 'Voorlopig', definitief: 'Definitief', uitgesloten: 'Uitgesloten', onvolledig: 'Onvolledig',
}
export const JAAR_LABEL: Record<Contractjaar, string> = {
  jaar1: 'Jaar 1', jaar2: 'Jaar 2', jaar3: 'Jaar 3', buiten: 'Buiten periode',
}
export const DIENSTEN = [
  'Social media management', 'Webdesign', 'Websiteverhuur', 'Grafisch ontwerp',
  'E-mailmarketing', 'AI-automatisatie', 'AI-project NextGenSolutions', 'Andere',
] as const

export type VestingInstellingen = {
  max_aandeel_marco: number
  vast_aandeel_chiara: number
  startaandeel_marco: number
  startaandeel_bram: number
  wam_bedrag_per_pct: number
  wam_max_aandeel: number
  regulier_tarief: number
  einde_goedkope_schijf: number
  jaar1_start: string; jaar1_eind: string; jaar1_tarief: number
  jaar2_start: string; jaar2_eind: string; jaar2_tarief: number
  jaar3_start: string; jaar3_eind: string; jaar3_tarief: number
}

export const STANDAARD_INSTELLINGEN: VestingInstellingen = {
  max_aandeel_marco: 0.33, vast_aandeel_chiara: 0.33, startaandeel_marco: 0, startaandeel_bram: 0.67,
  wam_bedrag_per_pct: 5000, wam_max_aandeel: 0.05, regulier_tarief: 5000, einde_goedkope_schijf: 0.10,
  jaar1_start: '2026-04-01', jaar1_eind: '2027-06-01', jaar1_tarief: 10000,
  jaar2_start: '2027-06-01', jaar2_eind: '2028-06-01', jaar2_tarief: 12000,
  jaar3_start: '2028-06-01', jaar3_eind: '2029-06-01', jaar3_tarief: 15000,
}

/** Database-rijen komen als tekst of null binnen; hier worden het getallen. */
export function leesInstellingen(rij: Record<string, unknown> | null | undefined): VestingInstellingen {
  const uit = { ...STANDAARD_INSTELLINGEN }
  if (!rij) return uit
  for (const k of Object.keys(uit) as (keyof VestingInstellingen)[]) {
    const v = rij[k]
    if (v === undefined || v === null || v === '') continue
    if (typeof uit[k] === 'number') (uit as Record<string, unknown>)[k] = Number(v)
    else (uit as Record<string, unknown>)[k] = String(v).slice(0, 10)
  }
  return uit
}

export type Contract = {
  id: string
  nr: string
  klant: string
  ondertekend_op: string
  start_dienst: string | null
  einde_dienst: string | null
  dienst: string | null
  facturatiemodel: Facturatiemodel
  maandbedrag: number | null
  duur_maanden: number | null
  handmatige_totaalwaarde: number | null
  uitgesloten_kosten: number
  status: ContractStatus
  betalingen_op_schema: boolean
  appointment_door_marco: boolean
  closed_door_marco: boolean
  laatste_betaalde_maand: string | null
  reden_stop: string | null
  notitie: string | null
  /** Het contract in de Contractenmodule waar dit op slaat, als het er is. */
  contract_id: string | null
  /**
   * Directe (doorgerekende) kosten op de facturen van het gekoppelde contract,
   * excl. btw — afgeleid, niet ingevoerd. null = geen koppeling of geen facturen.
   * Telt mee als aftrek, maar nooit bovenop `uitgesloten_kosten`: het hoogste
   * van de twee wordt gebruikt, zodat niets dubbel wordt afgetrokken.
   */
  directe_kosten_facturen?: number | null
  /** Status van de kostengegevens op die facturen (volledig / voorlopig / …). */
  kostenstatus_facturen?: 'volledig' | 'voorlopig' | 'controle_vereist' | 'geen_directe_kosten' | 'ongecontroleerd' | null
  /** Aantal klantfacturen dat aan het contract hangt. */
  facturen_gekoppeld?: number | null
}

export type Frequentie = 'maandelijks' | 'kwartaal' | 'halfjaar' | 'jaarlijks' | 'eenmalig'
export const FREQUENTIES: { key: Frequentie; label: string; maanden: number }[] = [
  { key: 'maandelijks', label: 'Maandelijks', maanden: 1 },
  { key: 'kwartaal', label: 'Per kwartaal', maanden: 3 },
  { key: 'halfjaar', label: 'Per half jaar', maanden: 6 },
  { key: 'jaarlijks', label: 'Jaarlijks', maanden: 12 },
  { key: 'eenmalig', label: 'Eenmalig', maanden: 0 },
]

export type WamRij = {
  id: string; nr: string; klant: string
  /** Gekoppelde klant uit het klantenbestand; nodig om een factuur op naam te zetten. */
  client_id: string | null
  contractwaarde: number
  /** Wat er al binnen was VÓÓR de facturatie via de app liep (historiek). */
  netto_ontvangen: number
  status: ContractStatus; betalingen_op_schema: boolean; notitie: string | null
  // Het facturatieschema. Leeg = geen schema; dan telt enkel de historiek.
  start_datum: string | null
  contract_maanden: number | null
  bedrag_per_factuur: number | null
  frequentie: Frequentie | null
  btw_pct: number
  omschrijving: string | null
}
export type WamKost = { id: string; datum: string | null; omschrijving: string; bedrag: number }

export type TermijnStatus = 'gepland' | 'gefactureerd' | 'betaald' | 'geannuleerd'
export const TERMIJN_LABEL: Record<TermijnStatus, string> = {
  gepland: 'Gepland', gefactureerd: 'Gefactureerd', betaald: 'Betaald', geannuleerd: 'Geannuleerd',
}
export type WamTermijn = {
  id: string; wam_id: string; volgnr: number; periode: string; factuurdatum: string
  bedrag_excl: number; btw_pct: number; status: TermijnStatus; betaald_op: string | null
  invoice_id: string | null; clickup_task_id: string | null; notitie: string | null
}

/**
 * Het facturatieschema van een WAM-klant: welke termijnen horen er te zijn?
 *
 * Maandelijks over 6 maanden = 6 termijnen; per kwartaal over 6 maanden = 2;
 * eenmalig = 1. De factuurdatum is de eerste dag van de periode. Dit is de
 * PROGNOSE; wat er effectief gefactureerd en betaald is staat op de termijnen
 * zelf, zodat een gewijzigd schema nooit een betaalde termijn overschrijft.
 */
export function wamSchema(r: Pick<WamRij, 'start_datum' | 'contract_maanden' | 'bedrag_per_factuur' | 'frequentie' | 'btw_pct'>):
  { volgnr: number; periode: string; factuurdatum: string; bedrag_excl: number; btw_pct: number }[] {
  const start = dag(r.start_datum)
  const bedrag = n(r.bedrag_per_factuur)
  if (!start || !r.frequentie || bedrag <= 0) return []
  const freq = FREQUENTIES.find((f) => f.key === r.frequentie)
  if (!freq) return []
  const maanden = Math.max(0, Math.round(n(r.contract_maanden)))
  const aantal = freq.maanden === 0 ? 1 : (maanden > 0 ? Math.ceil(maanden / freq.maanden) : 0)
  const uit: { volgnr: number; periode: string; factuurdatum: string; bedrag_excl: number; btw_pct: number }[] = []
  for (let i = 0; i < aantal; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i * (freq.maanden || 0), 1)
    const periode = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const dagNr = Math.min(start.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())
    const factuurdatum = `${periode}-${String(dagNr).padStart(2, '0')}`
    uit.push({ volgnr: i + 1, periode, factuurdatum, bedrag_excl: bedrag, btw_pct: n(r.btw_pct) || 21 })
  }
  return uit
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const dag = (s: string | null | undefined): Date | null => {
  if (!s) return null
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00')
  return Number.isFinite(d.getTime()) ? d : null
}

// ── Contractjaar en tarief ───────────────────────────────────────────────────

/** In welk contractjaar valt een ondertekening? Grenzen zijn inclusief, zoals in het Excel. */
export function contractjaar(ondertekendOp: string, i: VestingInstellingen): Contractjaar {
  const d = dag(ondertekendOp)
  if (!d) return 'buiten'
  const t = d.getTime()
  const in_ = (a: string, b: string) => { const x = dag(a), y = dag(b); return !!x && !!y && t >= x.getTime() && t <= y.getTime() }
  if (in_(i.jaar1_start, i.jaar1_eind)) return 'jaar1'
  if (in_(i.jaar2_start, i.jaar2_eind)) return 'jaar2'
  if (in_(i.jaar3_start, i.jaar3_eind)) return 'jaar3'
  return 'buiten'
}

/** € omzet per 1% boven de goedkope schijf, voor dit contractjaar. */
export function jaartarief(jaar: Contractjaar, i: VestingInstellingen): number | null {
  if (jaar === 'jaar1') return i.jaar1_tarief
  if (jaar === 'jaar2') return i.jaar2_tarief
  if (jaar === 'jaar3') return i.jaar3_tarief
  return null
}

// ── Eén contract ─────────────────────────────────────────────────────────────

export type ContractBerekend = Contract & {
  jaar: Contractjaar
  tarief: number | null
  /** Duur in maanden: ingevoerd, anders afgeleid uit start en einde. */
  duur: number | null
  /** Totale contractwaarde: maandbedrag × duur, of de handmatige waarde. */
  totaal: number | null
  /** Totaal min de kostenaftrek, nooit negatief. */
  netto: number | null
  /** Wat er effectief afgetrokken is: het hoogste van `uitgesloten_kosten` en de directe kosten uit facturen. */
  kostenAftrek: number
  /** Waarschuwing over de kostengegevens (voorlopig, conflict handmatig ↔ facturen, definitief met onvolledige kosten). */
  kostenWaarschuwing: string | null
  /** Marco's aandeel in het binnenhalen: 0 / 0,5 / 1. */
  factor: number
  /** Wat er in de aandelenpot telt: netto × factor, of €0. */
  meetellend: number
  erkenning: Erkenning
  /** Som van `meetellend` van alle eerdere contracten (chronologisch). */
  cumulatiefVoor: number
  /** Deel dat nog tegen het reguliere tarief gaat. */
  goedkopeSchijf: number
  /** Deel dat tegen het jaartarief gaat. */
  jaarschijf: number
  /** Verworven aandeel uit dit contract, als fractie (0,0123 = 1,23%). */
  ruweVesting: number
  /** Bij stop: aantal betaalde maanden, uit de laatste betaalde maand. */
  betaaldeMaanden: number | null
  /** Bij stop: wat er werkelijk ontvangen is vóór de stop. */
  ontvangenVoorStop: number | null
  /** Bij stop of niet-betaler: wat er van de contractwaarde wegvalt. */
  uitgevallen: number
}

/** Maanden tussen twee data, afgerond op één cijfer — 30,4375 dagen per maand zoals in het Excel. */
export function duurUitData(start: string | null, einde: string | null): number | null {
  const s = dag(start), e = dag(einde)
  if (!s || !e) return null
  return Math.round(((e.getTime() - s.getTime()) / 86_400_000 / 30.4375) * 10) / 10
}

export function totaalwaarde(c: Pick<Contract, 'facturatiemodel' | 'maandbedrag' | 'duur_maanden' | 'handmatige_totaalwaarde' | 'start_dienst' | 'einde_dienst'>): number | null {
  if (c.facturatiemodel === 'maandcontract') {
    const duur = c.duur_maanden ?? duurUitData(c.start_dienst, c.einde_dienst)
    if (c.maandbedrag === null || c.maandbedrag === undefined || duur === null) return null
    return n(c.maandbedrag) * duur
  }
  return c.handmatige_totaalwaarde === null || c.handmatige_totaalwaarde === undefined ? null : n(c.handmatige_totaalwaarde)
}

export function toerekeningsfactor(c: Pick<Contract, 'appointment_door_marco' | 'closed_door_marco'>): number {
  return Math.min(1, (c.appointment_door_marco ? 0.5 : 0) + (c.closed_door_marco ? 0.5 : 0))
}

/** Telt dit contract mee? Nee bij stop, niet-betaler, betalingen niet op schema of buiten de periode. */
export function isUitgesloten(c: Pick<Contract, 'status' | 'betalingen_op_schema'>, jaar: Contractjaar): boolean {
  return c.status === 'stopgezet' || c.status === 'niet_betaler' || !c.betalingen_op_schema || jaar === 'buiten'
}

export function erkenningVan(c: Pick<Contract, 'status' | 'betalingen_op_schema'>, jaar: Contractjaar): Erkenning {
  if (isUitgesloten(c, jaar)) return 'uitgesloten'
  if (c.status === 'voltooid') return 'definitief'
  if (c.status === 'actief') return 'voorlopig'
  return 'onvolledig'
}

/** Betaalde maanden bij een stop: van startmaand t.e.m. laatste betaalde maand. */
export function betaaldeMaanden(start: string | null, laatsteBetaald: string | null): number | null {
  const s = dag(start), l = dag(laatsteBetaald)
  if (!s || !l) return null
  return Math.max(0, (l.getFullYear() - s.getFullYear()) * 12 + l.getMonth() - s.getMonth() + 1)
}

// ── De WAM-portefeuille ──────────────────────────────────────────────────────

export type WamRijBerekend = WamRij & {
  meetellend: number
  erkenning: Erkenning
  termijnen: WamTermijn[]
  /** Historiek + alle geplande/gefactureerde/betaalde termijnen. */
  prognose: number
  /** Termijnen waarvoor een factuur bestaat (gefactureerd of betaald). */
  gefactureerd: number
  /** Betaalde termijnen. */
  betaald: number
  /** Historiek + betaald: wat er effectief binnen is. Dít telt voor de vesting. */
  ontvangen: number
  /** Gefactureerd maar nog niet betaald. */
  openstaand: number
}

export type WamBerekend = {
  rijen: WamRijBerekend[]
  /** Som van `ontvangen` over alle klanten (historiek + betaald). */
  nettoOntvangen: number
  prognose: number
  gefactureerd: number
  betaald: number
  openstaand: number
  kosten: number
  /** Netto ontvangen min kosten, nooit negatief. */
  nettoMeetellend: number
  /** Aandeel op basis van alles wat ontvangen is (fractie). */
  voorlopig: number
  /** Aandeel op basis van enkel voltooide klanten (fractie). */
  definitief: number
  /** Hoeveel € netto tot de volgende hele procent; null bij het maximum. */
  volgendeDrempel: number | null
}

export function berekenWam(rijen: WamRij[], kosten: WamKost[], i: VestingInstellingen, termijnen: WamTermijn[] = []): WamBerekend {
  const uitgewerkt: WamRijBerekend[] = rijen.map((r) => {
    const eigen = termijnen.filter((t) => t.wam_id === r.id).sort((a, b) => a.volgnr - b.volgnr)
    const som = (f: (t: WamTermijn) => boolean) => eigen.filter(f).reduce((s, t) => s + n(t.bedrag_excl), 0)
    const gefactureerd = som((t) => t.status === 'gefactureerd' || t.status === 'betaald')
    const betaald = som((t) => t.status === 'betaald')
    const historiek = n(r.netto_ontvangen)
    const prognose = historiek + som((t) => t.status !== 'geannuleerd')
    // Wat er effectief binnen is: de historiek van vóór de app, plus wat via
    // de termijnen als betaald is aangeduid. Alleen dít telt voor het aandeel.
    const ontvangen = historiek + betaald
    // Stopgezet of niet-betaler: €0, hoeveel er ook binnenkwam.
    const uit = r.status === 'stopgezet' || r.status === 'niet_betaler' || !r.betalingen_op_schema
    return {
      ...r, termijnen: eigen, prognose, gefactureerd, betaald, ontvangen,
      openstaand: Math.max(0, gefactureerd - betaald),
      meetellend: uit ? 0 : ontvangen, erkenning: erkenningVan(r, 'jaar1'),
    }
  })
  const nettoOntvangen = uitgewerkt.reduce((s, r) => s + r.ontvangen, 0)
  const kostenTotaal = kosten.reduce((s, k) => s + n(k.bedrag), 0)
  const nettoMeetellend = Math.max(0, uitgewerkt.reduce((s, r) => s + r.meetellend, 0) - kostenTotaal)
  const heel = (bedrag: number) => Math.min(i.wam_max_aandeel, Math.floor(bedrag / i.wam_bedrag_per_pct) / 100)
  const voorlopig = heel(nettoMeetellend)
  const voltooid = uitgewerkt.filter((r) => r.status === 'voltooid').reduce((s, r) => s + r.meetellend, 0)
  const definitief = heel(Math.max(0, voltooid - kostenTotaal))
  const volgendeDrempel = voorlopig >= i.wam_max_aandeel ? null : (Math.round(voorlopig * 100) + 1) * i.wam_bedrag_per_pct
  return {
    rijen: uitgewerkt, nettoOntvangen,
    prognose: uitgewerkt.reduce((s, r) => s + r.prognose, 0),
    gefactureerd: uitgewerkt.reduce((s, r) => s + r.gefactureerd, 0),
    betaald: uitgewerkt.reduce((s, r) => s + r.betaald, 0),
    openstaand: uitgewerkt.reduce((s, r) => s + r.openstaand, 0),
    kosten: kostenTotaal, nettoMeetellend, voorlopig, definitief, volgendeDrempel,
  }
}

// ── Alles samen ──────────────────────────────────────────────────────────────

export type JaarOverzicht = {
  jaar: Contractjaar
  label: string
  periode: { van: string; tot: string } | null
  tarief: number | null
  meetellend: number
  ruweVesting: number
  aantal: number
}

export type VestingOverzicht = {
  instellingen: VestingInstellingen
  contracten: ContractBerekend[]
  wam: WamBerekend
  /** WAM netto + alle meetellende contractwaarde. */
  meetellendeWaarde: number
  /** Marco's aandeel nu, als fractie, op hele procenten afgekapt. */
  marcoVoorlopig: number
  /** Marco's aandeel op basis van enkel definitieve contracten. */
  marcoDefinitief: number
  bram: number
  chiara: number
  /** Contractwaarde die wegviel door stop, niet-betaling of WAM-kosten. */
  uitgevallenWaarde: number
  perJaar: JaarOverzicht[]
  /** Hoeveel € meetellende waarde nog tot de volgende hele procent. */
  volgendeProcent: { nodig: number; tarief: number } | null
}

/**
 * Het hele model doorrekenen.
 *
 * De contracten worden hier CHRONOLOGISCH op ondertekeningsdatum verwerkt,
 * ongeacht de volgorde waarin ze zijn ingevoerd. Dat moet, want de goedkope
 * schijf wordt in volgorde opgebruikt: het eerste contract krijgt het
 * reguliere tarief, wat er daarna komt schuift op naar het jaartarief. In het
 * Excel hing dat af van de rijvolgorde — hier niet meer.
 */
export function berekenVesting(
  contractRijen: Contract[], wamRijen: WamRij[], wamKosten: WamKost[], i: VestingInstellingen,
  wamTermijnen: WamTermijn[] = [],
): VestingOverzicht {
  const wam = berekenWam(wamRijen, wamKosten, i, wamTermijnen)

  /**
   * De goedkope schijf loopt tot een TOTAAL aandeel van 10%, WAM inbegrepen.
   * Wat WAM al opleverde, gaat er dus af. (Het Excel verwees hier naar een
   * lege cel en rekende daardoor altijd met de volle 10%; de bedoeling staat
   * in de instellingen: "regulier tarief tot totaal 10%".)
   */
  const goedkoopBudget = Math.max(0, (i.einde_goedkope_schijf - wam.voorlopig) * 100 * i.regulier_tarief)

  const gesorteerd = [...contractRijen].sort((a, b) =>
    a.ondertekend_op.localeCompare(b.ondertekend_op) || a.nr.localeCompare(b.nr, 'nl', { numeric: true }))

  let cumulatief = 0
  const contracten: ContractBerekend[] = gesorteerd.map((c) => {
    const jaar = contractjaar(c.ondertekend_op, i)
    const tarief = jaartarief(jaar, i)
    const duur = c.duur_maanden ?? duurUitData(c.start_dienst, c.einde_dienst)
    const totaal = totaalwaarde(c)
    // Kostenaftrek: het handmatige veld óf de directe kosten uit de facturen van
    // het gekoppelde contract — het hoogste van de twee, nooit de som.
    const uitFacturen = c.directe_kosten_facturen ?? null
    const handmatig = n(c.uitgesloten_kosten)
    const kostenAftrek = Math.max(handmatig, uitFacturen ?? 0)
    const netto = totaal === null ? null : Math.max(0, totaal - kostenAftrek)
    const waarschuwingen: string[] = []
    if (uitFacturen !== null && handmatig > 0 && Math.abs(uitFacturen - handmatig) > 0.005) waarschuwingen.push(`handmatig ${Math.round(handmatig)} ≠ uit facturen ${Math.round(uitFacturen)}; het hoogste telt`)
    const ks = c.kostenstatus_facturen ?? null
    if (ks === 'voorlopig' || ks === 'controle_vereist' || ks === 'ongecontroleerd') {
      waarschuwingen.push(c.status === 'voltooid' ? `definitief met onvolledige kosten (${ks === 'voorlopig' ? 'voorlopig' : ks === 'controle_vereist' ? 'controle vereist' : 'nog niet gecontroleerd'})` : `kosten op facturen ${ks === 'voorlopig' ? 'voorlopig' : ks === 'controle_vereist' ? 'onder controle' : 'nog niet gecontroleerd'}`)
    }
    const kostenWaarschuwing = waarschuwingen.length ? waarschuwingen.join(' · ') : null
    const factor = toerekeningsfactor(c)
    const erkenning = erkenningVan(c, jaar)
    const meetellend = erkenning === 'uitgesloten' || netto === null ? 0 : netto * factor

    const goedkopeSchijf = Math.min(meetellend, Math.max(0, goedkoopBudget - cumulatief))
    const jaarschijf = Math.max(0, meetellend - goedkopeSchijf)
    const ruweVesting = goedkopeSchijf / i.regulier_tarief / 100 + (tarief ? jaarschijf / tarief / 100 : 0)

    const maanden = betaaldeMaanden(c.start_dienst, c.laatste_betaalde_maand)
    const ontvangenVoorStop = maanden === null || totaal === null ? null
      : c.facturatiemodel === 'maandcontract' && c.maandbedrag !== null ? Math.min(totaal, maanden * n(c.maandbedrag))
      : null
    // Uitgevallen = wat de klant nooit betaalde van een gestopt of niet-betaald
    // contract. Zonder stopinfo: de hele contractwaarde.
    const uitgevallen = (c.status === 'stopgezet' || c.status === 'niet_betaler') && totaal !== null
      ? Math.max(0, totaal - (ontvangenVoorStop ?? 0)) : 0

    const uit: ContractBerekend = {
      ...c, jaar, tarief, duur, totaal, netto, kostenAftrek, kostenWaarschuwing, factor, meetellend, erkenning,
      cumulatiefVoor: cumulatief, goedkopeSchijf, jaarschijf, ruweVesting,
      betaaldeMaanden: maanden, ontvangenVoorStop, uitgevallen,
    }
    cumulatief += meetellend
    return uit
  })

  // Hele procenten, afgekapt: 2,45% is 2%. Zo staat het in de overeenkomst.
  const afkap = (fractie: number) => Math.floor(fractie * 100 + 1e-9) / 100
  const somVesting = contracten.reduce((s, c) => s + c.ruweVesting, 0)
  const somDefinitief = contracten.filter((c) => c.erkenning === 'definitief').reduce((s, c) => s + c.ruweVesting, 0)
  const marcoVoorlopig = Math.min(i.max_aandeel_marco, wam.voorlopig + afkap(somVesting))
  const marcoDefinitief = Math.min(i.max_aandeel_marco, wam.definitief + afkap(somDefinitief))

  const meetellendeWaarde = wam.nettoMeetellend + contracten.reduce((s, c) => s + c.meetellend, 0)
  const uitgevallenWaarde = contracten.reduce((s, c) => s + c.uitgevallen, 0)
    + wam.kosten
    + wam.rijen.reduce((s, r) => s + Math.max(0, (r.prognose > 0 ? r.prognose : n(r.contractwaarde)) - r.ontvangen), 0)

  const perJaar: JaarOverzicht[] = (['jaar1', 'jaar2', 'jaar3'] as const).map((jaar) => {
    const van = contracten.filter((c) => c.jaar === jaar)
    const periode = jaar === 'jaar1' ? { van: i.jaar1_start, tot: i.jaar1_eind }
      : jaar === 'jaar2' ? { van: i.jaar2_start, tot: i.jaar2_eind }
      : { van: i.jaar3_start, tot: i.jaar3_eind }
    return {
      jaar, label: JAAR_LABEL[jaar], periode, tarief: jaartarief(jaar, i),
      meetellend: van.reduce((s, c) => s + c.meetellend, 0),
      ruweVesting: van.reduce((s, c) => s + c.ruweVesting, 0),
      aantal: van.length,
    }
  })

  // Hoeveel omzet nog tot de volgende hele procent, tegen het tarief dat NU
  // geldt: goedkoop zolang het budget niet op is, anders het tarief van het
  // huidige contractjaar.
  let volgendeProcent: VestingOverzicht['volgendeProcent'] = null
  if (marcoVoorlopig < i.max_aandeel_marco) {
    const resterendGoedkoop = Math.max(0, goedkoopBudget - cumulatief)
    const huidigJaar = contractjaar(new Date().toISOString().slice(0, 10), i)
    const tariefNu = resterendGoedkoop > 0 ? i.regulier_tarief : (jaartarief(huidigJaar, i) ?? i.jaar3_tarief)
    const fractieOver = somVesting - Math.floor(somVesting * 100 + 1e-9) / 100   // wat al richting de volgende % staat
    const nodig = Math.max(0, (0.01 - fractieOver) * 100 * tariefNu)
    volgendeProcent = { nodig, tarief: tariefNu }
  }

  const bram = i.startaandeel_bram - (marcoVoorlopig - i.startaandeel_marco)

  return {
    instellingen: i, contracten, wam, meetellendeWaarde,
    marcoVoorlopig, marcoDefinitief, bram, chiara: i.vast_aandeel_chiara,
    uitgevallenWaarde, perJaar, volgendeProcent,
  }
}

/** "C-007" — het eerstvolgende nummer in een reeks. */
export function volgendNr(bestaande: string[], voorvoegsel: 'C' | 'CW'): string {
  const hoogste = bestaande
    .map((s) => { const m = new RegExp(`^${voorvoegsel}-(\\d+)$`, 'i').exec(s.trim()); return m ? Number(m[1]) : 0 })
    .reduce((a, b) => Math.max(a, b), 0)
  const volgend = hoogste + 1
  return voorvoegsel === 'C' ? `C-${String(volgend).padStart(3, '0')}` : `CW-${volgend}`
}

export const pct = (fractie: number, cijfers = 0): string =>
  `${(fractie * 100).toLocaleString('nl-BE', { minimumFractionDigits: cijfers, maximumFractionDigits: cijfers })}%`

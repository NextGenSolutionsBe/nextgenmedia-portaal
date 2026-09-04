/**
 * Cijfers van het appointment setten: waar lekt de trechter, wie zet om, en
 * welke sector levert het meeste op.
 *
 * Pure module — geen database, geen server-only imports. Alles rekent op rijen
 * die je meegeeft. Zo is dit te testen zonder database, en dat is nodig ook:
 * een conversiepercentage dat er plausibel uitziet maar verkeerd gerekend is,
 * merk je nooit.
 *
 * NIET te verwarren met lib/sales/setters.ts. Dat gaat over geld — gewerkte
 * uren, commissie, uitbetalingen. Dit gaat over prestaties.
 */

export type AfspraakRij = {
  id: string
  lead_id: string | null
  setter_profile_id: string | null
  /**
   * De auth-gebruiker die boekte.
   *
   * NODIG ALS TERUGVAL. Bij het boeken wordt alleen dit veld gezet;
   * setter_profile_id wordt pas ingevuld zodra er een uitkomst geregistreerd
   * wordt. Zonder deze terugval hangt elke nog openstaande afspraak aan
   * niemand, en dan klopt geen enkel cijfer per setter.
   */
  setter_id: string | null
  /** scheduled | completed | no_show | cancelled */
  status: string
  /** won | lost | null */
  outcome: string | null
  outcome_reason: string | null
  deal_value_cents: number | null
  starts_at: string
}

export type GesprekRij = {
  lead_id: string
  /** auth-user van wie belde; kan ontbreken bij oude registraties. */
  actor_id: string | null
  created_at: string
}

export type LeadRij = {
  id: string
  company_id: string | null
  source: string | null
  lost_reason: string | null
}

export type BedrijfRij = { id: string; sector: string | null }

export type SetterRij = { id: string; naam: string; auth_user_id: string | null }

/**
 * De trechter. Elk getal is een aantal, geen percentage — percentages worden
 * pas op het scherm gerekend, zodat er nooit een afgerond percentage verder
 * gerekend wordt.
 */
export type Trechter = {
  gesprekken: number
  /** Leads waarmee minstens één gesprek is geregistreerd. */
  leadsGebeld: number
  /** Geboekte afspraken, exclusief geannuleerde. */
  afspraken: number
  /** Afspraak is doorgegaan. */
  doorgegaan: number
  noShows: number
  geannuleerd: number
  gewonnen: number
  verloren: number
  /** Afspraak geweest, uitkomst nog niet ingevuld. */
  open: number
  dealWaardeCent: number
}

export type Groep = Trechter & { sleutel: string; label: string }

export type Statistieken = {
  totaal: Trechter
  perSetter: Groep[]
  perSector: Groep[]
  perBron: Groep[]
  verliesredenen: { reden: string; aantal: number }[]
  perMaand: { maand: string; gesprekken: number; afspraken: number; gewonnen: number }[]
  perWeekdag: { dag: string; gesprekken: number; afspraken: number }[]
  perUur: { uur: number; gesprekken: number; afspraken: number }[]
}

// ── Interesse op leadniveau ─────────────────────────────────────────────────
// Beantwoordt "hoeveel procent van de bouwbedrijven is geïnteresseerd?" — dat
// is een andere vraag dan de afsprakentrechter hierboven: dit telt op wat er
// NU in de pipeline staat, over alle belpogingen heen.

export type LeadInteresseRij = {
  id: string
  company_id: string | null
  stage_key: string
  lost_reason: string | null
}

export type SectorInteresse = {
  sector: string
  totaal: number
  /** Interesse getoond: fase interesse, afspraak of gewonnen. */
  interesse: number
  /** Expliciet afgehaakt: geen interesse of verloren. */
  geenInteresse: number
  /** De rest: nog te bellen of nog in gesprek. */
  bezig: number
}

const INTERESSE_FASEN = new Set(['interested', 'appointment', 'won'])
const AFGEHAAKT_FASEN = new Set(['not_interested', 'lost'])

/**
 * Interesse per sector plus de redenen waarom mensen afhaken.
 * `redenGroep` haalt de vaste reden uit een opgeslagen lost_reason, zodat
 * "Anders — wil eerst een website" gewoon onder "Anders" telt.
 */
export function berekenLeadInteresse(
  leads: LeadInteresseRij[],
  bedrijven: BedrijfRij[],
  redenGroep: (v: string | null | undefined) => string | null,
): { perSector: SectorInteresse[]; redenen: { reden: string; aantal: number }[] } {
  const sectorVan = new Map(bedrijven.map((b) => [b.id, b.sector?.trim() || ONBEKEND]))
  const perSector = new Map<string, SectorInteresse>()
  const redenen = new Map<string, number>()

  for (const l of leads) {
    const sector = (l.company_id ? sectorVan.get(l.company_id) : null) ?? ONBEKEND
    let s = perSector.get(sector)
    if (!s) { s = { sector, totaal: 0, interesse: 0, geenInteresse: 0, bezig: 0 }; perSector.set(sector, s) }
    s.totaal++
    if (INTERESSE_FASEN.has(l.stage_key)) s.interesse++
    else if (AFGEHAAKT_FASEN.has(l.stage_key)) {
      s.geenInteresse++
      const reden = redenGroep(l.lost_reason) ?? 'Geen reden ingevuld'
      redenen.set(reden, (redenen.get(reden) ?? 0) + 1)
    } else s.bezig++
  }

  return {
    // Grootste sectoren bovenaan: daar is de statistiek het meest waard.
    perSector: [...perSector.values()].sort((a, b) => b.totaal - a.totaal || a.sector.localeCompare(b.sector)),
    redenen: [...redenen.entries()]
      .map(([reden, aantal]) => ({ reden, aantal }))
      .sort((a, b) => b.aantal - a.aantal),
  }
}

export const leegTrechter = (): Trechter => ({
  gesprekken: 0, leadsGebeld: 0, afspraken: 0, doorgegaan: 0, noShows: 0,
  geannuleerd: 0, gewonnen: 0, verloren: 0, open: 0, dealWaardeCent: 0,
})

/**
 * Een percentage, of null als er niets is om over te rekenen.
 *
 * NULL EN NIET NUL. "0% van 0 afspraken" leest als een slecht resultaat,
 * terwijl er gewoon niets gebeurd is. Het scherm toont daar een streepje.
 */
export function percentage(deel: number, geheel: number): number | null {
  if (!Number.isFinite(deel) || !Number.isFinite(geheel) || geheel <= 0) return null
  return (deel / geheel) * 100
}

export const toonPercentage = (p: number | null): string =>
  p === null ? '—' : `${p.toFixed(1).replace('.', ',')}%`

/**
 * De datumdelen zoals ze in Brussel zijn.
 *
 * NIET via toISOString(): dat rekent in UTC, en dan valt een gesprek van
 * 00u30 in de vorige dag en een avondafspraak in de verkeerde maand. Dat is in
 * dit project al eens misgegaan bij de verlengingsdatums.
 */
const DEEL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Brussels',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hour12: false,
})

export const WEEKDAGEN = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'] as const

export function brusselDelen(iso: string): { maand: string; uur: number; weekdag: number } | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const delen = Object.fromEntries(DEEL.formatToParts(d).map((p) => [p.type, p.value]))

  const jaar = Number(delen.year)
  const maandNr = Number(delen.month)
  const dag = Number(delen.day)
  const uur = Number(delen.hour)
  if (!Number.isFinite(jaar) || !Number.isFinite(maandNr) || !Number.isFinite(dag)) return null

  // De weekdag rekenen we UIT DE DATUM, niet uit een vertaalde naam. Sommige
  // omgevingen geven "Mon." met een punt terug; dan mislukt elke opzoeking en
  // valt alles stilletjes op maandag.
  const zondagEerst = new Date(Date.UTC(jaar, maandNr - 1, dag)).getUTCDay()

  return {
    maand: `${delen.year}-${delen.month}`,
    // Middernacht komt er in sommige omgevingen uit als 24; dat is uur 0.
    uur: Number.isFinite(uur) ? uur % 24 : 0,
    // getUTCDay begint op zondag; onze week begint op maandag.
    weekdag: (zondagEerst + 6) % 7,
  }
}

/** Telt één afspraak op bij een trechter. */
function tel(t: Trechter, a: AfspraakRij): void {
  if (a.status === 'cancelled') { t.geannuleerd++; return }
  t.afspraken++
  if (a.status === 'completed') t.doorgegaan++
  if (a.status === 'no_show') t.noShows++
  if (a.outcome === 'won') { t.gewonnen++; t.dealWaardeCent += a.deal_value_cents ?? 0 }
  else if (a.outcome === 'lost') t.verloren++
  else t.open++
}

/** Groepen op aantal gewonnen, dan afspraken. Wat het meeste oplevert bovenaan. */
const sorteer = (a: Groep, b: Groep) =>
  b.gewonnen - a.gewonnen || b.afspraken - a.afspraken || a.label.localeCompare(b.label)

const ONBEKEND = 'Onbekend'

export function bereken(bron: {
  afspraken: AfspraakRij[]
  gesprekken: GesprekRij[]
  leads: LeadRij[]
  bedrijven: BedrijfRij[]
  setters: SetterRij[]
}): Statistieken {
  const leadById = new Map(bron.leads.map((l) => [l.id, l]))
  const sectorVanBedrijf = new Map(bron.bedrijven.map((b) => [b.id, b.sector?.trim() || ONBEKEND]))
  const setterById = new Map(bron.setters.map((s) => [s.id, s]))
  // Een gesprek registreert de auth-gebruiker, een afspraak het setterprofiel.
  // Zonder deze brug kan je gesprekken en afspraken niet bij dezelfde persoon
  // optellen, en klopt elke conversie per setter niet.
  const setterVanAuth = new Map(
    bron.setters.filter((s) => s.auth_user_id).map((s) => [s.auth_user_id as string, s]),
  )

  const sectorVanLead = (leadId: string | null): string => {
    if (!leadId) return ONBEKEND
    const lead = leadById.get(leadId)
    if (!lead?.company_id) return ONBEKEND
    return sectorVanBedrijf.get(lead.company_id) ?? ONBEKEND
  }
  const bronVanLead = (leadId: string | null): string => {
    if (!leadId) return ONBEKEND
    return leadById.get(leadId)?.source?.trim() || ONBEKEND
  }

  const totaal = leegTrechter()
  const perSetter = new Map<string, Groep>()
  const perSector = new Map<string, Groep>()
  const perBron = new Map<string, Groep>()
  const maanden = new Map<string, { gesprekken: number; afspraken: number; gewonnen: number }>()
  const weekdagen = WEEKDAGEN.map(() => ({ gesprekken: 0, afspraken: 0 }))
  const uren = Array.from({ length: 24 }, () => ({ gesprekken: 0, afspraken: 0 }))
  const verlies = new Map<string, number>()

  const pak = (kaart: Map<string, Groep>, sleutel: string, label: string): Groep => {
    let g = kaart.get(sleutel)
    if (!g) { g = { sleutel, label, ...leegTrechter() }; kaart.set(sleutel, g) }
    return g
  }
  const maand = (sleutel: string) => {
    let m = maanden.get(sleutel)
    if (!m) { m = { gesprekken: 0, afspraken: 0, gewonnen: 0 }; maanden.set(sleutel, m) }
    return m
  }

  // ── Afspraken ────────────────────────────────────────────────────────────
  for (const a of bron.afspraken) {
    tel(totaal, a)

    // Eerst het profiel, anders wie er boekte. Zie AfspraakRij.setter_id.
    const setter = (a.setter_profile_id ? setterById.get(a.setter_profile_id) : undefined)
      ?? (a.setter_id ? setterVanAuth.get(a.setter_id) : undefined)
    tel(pak(perSetter, setter?.id ?? ONBEKEND, setter?.naam ?? ONBEKEND), a)

    const sector = sectorVanLead(a.lead_id)
    tel(pak(perSector, sector, sector), a)
    const bronNaam = bronVanLead(a.lead_id)
    tel(pak(perBron, bronNaam, bronNaam), a)

    if (a.status !== 'cancelled') {
      const d = brusselDelen(a.starts_at)
      if (d) {
        maand(d.maand).afspraken++
        if (a.outcome === 'won') maand(d.maand).gewonnen++
        weekdagen[d.weekdag].afspraken++
        uren[d.uur].afspraken++
      }
      if (a.outcome === 'lost') {
        // De reden van de afspraak wint; anders die van de lead.
        const reden = a.outcome_reason?.trim()
          || (a.lead_id ? leadById.get(a.lead_id)?.lost_reason?.trim() : null)
          || 'Geen reden ingevuld'
        verlies.set(reden, (verlies.get(reden) ?? 0) + 1)
      }
    }
  }

  // ── Gesprekken ───────────────────────────────────────────────────────────
  // Per setter/sector/bron bijhouden welke leads al geteld zijn, zodat
  // "leads gebeld" echt unieke leads telt en niet het aantal belpogingen.
  const gezien = { totaal: new Set<string>() }
  const gezienPer = new Map<string, Set<string>>()
  const uniek = (kaart: Map<string, Groep>, sleutel: string, leadId: string) => {
    const k = `${kaart === perSetter ? 's' : kaart === perSector ? 'c' : 'b'}|${sleutel}`
    let set = gezienPer.get(k)
    if (!set) { set = new Set(); gezienPer.set(k, set) }
    if (set.has(leadId)) return false
    set.add(leadId)
    return true
  }

  for (const g of bron.gesprekken) {
    totaal.gesprekken++
    if (!gezien.totaal.has(g.lead_id)) { gezien.totaal.add(g.lead_id); totaal.leadsGebeld++ }

    const setter = g.actor_id ? setterVanAuth.get(g.actor_id) : undefined
    const sSleutel = setter?.id ?? ONBEKEND
    const sGroep = pak(perSetter, sSleutel, setter?.naam ?? ONBEKEND)
    sGroep.gesprekken++
    if (uniek(perSetter, sSleutel, g.lead_id)) sGroep.leadsGebeld++

    const sector = sectorVanLead(g.lead_id)
    const secGroep = pak(perSector, sector, sector)
    secGroep.gesprekken++
    if (uniek(perSector, sector, g.lead_id)) secGroep.leadsGebeld++

    const bronNaam = bronVanLead(g.lead_id)
    const bGroep = pak(perBron, bronNaam, bronNaam)
    bGroep.gesprekken++
    if (uniek(perBron, bronNaam, g.lead_id)) bGroep.leadsGebeld++

    const d = brusselDelen(g.created_at)
    if (d) {
      maand(d.maand).gesprekken++
      weekdagen[d.weekdag].gesprekken++
      uren[d.uur].gesprekken++
    }
  }

  return {
    totaal,
    perSetter: [...perSetter.values()].sort(sorteer),
    perSector: [...perSector.values()].sort(sorteer),
    perBron: [...perBron.values()].sort(sorteer),
    verliesredenen: [...verlies.entries()]
      .map(([reden, aantal]) => ({ reden, aantal }))
      .sort((a, b) => b.aantal - a.aantal),
    perMaand: [...maanden.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([maand, v]) => ({ maand, ...v })),
    perWeekdag: weekdagen.map((v, i) => ({ dag: WEEKDAGEN[i], ...v })),
    perUur: uren.map((v, i) => ({ uur: i, ...v })),
  }
}

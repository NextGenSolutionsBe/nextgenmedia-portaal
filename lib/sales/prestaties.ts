/**
 * Salesprestaties per medewerker — pure module (geen database), getest in
 * tests/sales-prestaties.test.ts.
 *
 * TELREGELS
 *  · Cold calls = telefoongesprekken geregistreerd in Focus Mode (bron 'focus'),
 *    toegeschreven aan wie belde. Gesprekken van vóór de bronregistratie tellen
 *    apart ("zonder bron") — nooit stil bij de cold calls en nooit als 0.
 *  · Bereikte leads = unieke leads met een gesprek waarin iemand bereikt werd
 *    (contact gehad, geen interesse of afspraak gepland).
 *  · Gespreksduur = enkel uit een GEMETEN start en einde (timer). Een gesprek
 *    zonder die twee heeft geen duur; er wordt niets geschat.
 *  · Afspraken ingepland = unieke leads met een (niet geannuleerde) afspraak die
 *    in de periode geboekt werd, toegeschreven aan wie boekte.
 *  · Afspraken gehouden = expliciet als gehouden bevestigd (of met een uitkomst
 *    gewonnen/verloren), toegeschreven aan de VERANTWOORDELIJKE van de afspraak,
 *    geteld op de datum van de afspraak. Voorbij en nog niet bevestigd = apart.
 *  · Gewonnen / verloren = leads die in de periode op die fase gesloten werden,
 *    toegeschreven aan de verantwoordelijke van hun laatste gehouden afspraak
 *    (anders de verantwoordelijke van de lead). Wie de kaart versleept, speelt
 *    hier geen rol.
 *  · Closing rate = gewonnen ÷ (gewonnen + verloren) × 100, ENKEL over leads met
 *    een gehouden afspraak. Geen afgeronde uitkomsten → null (geen percentage).
 *  · Geen interesse = unieke leads naar die fase gezet, toegeschreven aan wie het
 *    deed (de laatste keer per lead).
 *  · Faseverplaatsingen = elke verplaatsing naar een ANDERE fase, door wie ze
 *    uitvoerde. Heen en terug = 2; zonder faseverschil = 0.
 */

export type PActiviteit = {
  id: string
  lead_id: string
  medewerker_id: string | null
  type: string
  uitkomst?: string | null
  bron?: string | null
  van_fase?: string | null
  naar_fase?: string | null
  gesprek_start?: string | null
  gesprek_eind?: string | null
  created_at: string
}

export type PAfspraak = {
  id: string
  lead_id: string | null
  setter_id: string | null
  verantwoordelijke_id: string | null
  starts_at: string
  status: string | null
  aanwezigheid: string | null
  outcome: string | null
  created_at: string
}

export type PLead = { id: string; stage_key: string; assigned_to: string | null; gesloten_op: string | null }

export type PInvoer = {
  activiteiten: PActiviteit[]
  afspraken: PAfspraak[]
  leads: PLead[]
  /** Periode [van, tot) als ISO-tijdstippen. */
  van: string
  tot: string
  /** Nu (ISO) — om voorbije, nog niet bevestigde afspraken te herkennen. */
  nu: string
}

export type PRij = {
  sleutel: string
  coldCalls: number
  gesprekkenZonderBron: number
  bereikteLeads: number
  gesprekkenMetDuur: number
  gesprekkenZonderDuur: number
  gespreksduurSec: number
  afsprakenIngepland: number
  afsprakenGehouden: number
  afsprakenNietGehouden: number
  afsprakenOnbevestigd: number
  gewonnen: number
  verloren: number
  geenInteresse: number
  faseverplaatsingen: number
  closingGewonnen: number
  closingAfgerond: number
  /** gewonnen ÷ afgerond × 100 (leads met gehouden afspraak); null zonder afgeronde uitkomsten. */
  closingRate: number | null
}

export type PodiumPlek = { plaats: number; sleutel: string; waarde: number; detail?: string }

export type PUitkomst = {
  perMedewerker: PRij[]
  team: PRij
  podium: { coldCaller: PodiumPlek[]; closer: PodiumPlek[] }
  /** Gesloten leads zonder sluitdatum: niet in een periode te plaatsen. */
  geslotenZonderDatum: number
}

export const ONBEKEND = 'onbekend'
const BEREIKT = new Set(['contact_gehad', 'geen_interesse', 'afspraak_gepland'])

const leeg = (sleutel: string): PRij => ({
  sleutel, coldCalls: 0, gesprekkenZonderBron: 0, bereikteLeads: 0, gesprekkenMetDuur: 0, gesprekkenZonderDuur: 0, gespreksduurSec: 0,
  afsprakenIngepland: 0, afsprakenGehouden: 0, afsprakenNietGehouden: 0, afsprakenOnbevestigd: 0,
  gewonnen: 0, verloren: 0, geenInteresse: 0, faseverplaatsingen: 0, closingGewonnen: 0, closingAfgerond: 0, closingRate: null,
})

export const isGehouden = (a: Pick<PAfspraak, 'aanwezigheid' | 'outcome'>): boolean =>
  a.aanwezigheid === 'gehouden' || (a.aanwezigheid == null && (a.outcome === 'won' || a.outcome === 'lost'))

/** Gemeten gespreksduur in seconden, of null als start of einde ontbreekt/onmogelijk is. */
export function gemetenDuur(a: Pick<PActiviteit, 'gesprek_start' | 'gesprek_eind'>): number | null {
  if (!a.gesprek_start || !a.gesprek_eind) return null
  const s = Date.parse(a.gesprek_start), e = Date.parse(a.gesprek_eind)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null
  return Math.round((e - s) / 1000)
}

export const percentage = (teller: number, noemer: number): number | null =>
  noemer > 0 ? Math.round((teller / noemer) * 1000) / 10 : null

/** Plaatsen met gedeelde rang bij gelijke stand (1, 1, 3 …). */
function rangschik<T>(lijst: T[], waarde: (x: T) => number, tweede?: (x: T) => number): (T & { plaats: number })[] {
  const gesorteerd = [...lijst].sort((a, b) => waarde(b) - waarde(a) || (tweede ? tweede(b) - tweede(a) : 0))
  let plaats = 0, vorige: number | null = null
  return gesorteerd.map((x, i) => {
    const w = waarde(x)
    if (vorige === null || w !== vorige) { plaats = i + 1; vorige = w }
    return { ...x, plaats }
  })
}

export function berekenPrestaties(inv: PInvoer): PUitkomst {
  const inPeriode = (iso: string | null | undefined) => !!iso && iso >= inv.van && iso < inv.tot
  const rijen = new Map<string, PRij>()
  const rij = (id: string | null | undefined) => {
    const k = id || ONBEKEND
    if (!rijen.has(k)) rijen.set(k, leeg(k))
    return rijen.get(k)!
  }
  // Unieke tellingen per medewerker (en voor het team).
  const uniek = new Map<string, Set<string>>()
  const voegUniek = (soort: string, wie: string, lead: string) => {
    for (const k of [`${soort}|${wie}`, `${soort}|__team__`]) {
      if (!uniek.has(k)) uniek.set(k, new Set())
      uniek.get(k)!.add(lead)
    }
  }
  const aantalUniek = (soort: string, wie: string) => uniek.get(`${soort}|${wie}`)?.size ?? 0

  // ── Activiteiten ──
  const laatsteGeenInteresse = new Map<string, { wie: string; op: string }>()
  for (const a of inv.activiteiten) {
    if (!inPeriode(a.created_at)) continue
    const wie = a.medewerker_id || ONBEKEND
    if (a.type === 'telefoongesprek') {
      const r = rij(wie)
      if (a.bron === 'focus') {
        r.coldCalls++
        const d = gemetenDuur(a)
        if (d === null) r.gesprekkenZonderDuur++
        else { r.gesprekkenMetDuur++; r.gespreksduurSec += d }
      } else if (!a.bron) {
        r.gesprekkenZonderBron++
      } else {
        // Gesprek vanuit de pipeline (geen cold call): enkel de gemeten duur telt mee.
        const d = gemetenDuur(a)
        if (d !== null) { r.gesprekkenMetDuur++; r.gespreksduurSec += d }
      }
      if (a.uitkomst && BEREIKT.has(a.uitkomst)) voegUniek('bereikt', wie, a.lead_id)
    } else if (a.type === 'fase_gewijzigd') {
      if (a.naar_fase && a.van_fase && a.van_fase === a.naar_fase) continue // geen faseverschil
      rij(wie).faseverplaatsingen++
      if (a.naar_fase === 'geen_interesse') {
        const vorig = laatsteGeenInteresse.get(a.lead_id)
        if (!vorig || a.created_at >= vorig.op) laatsteGeenInteresse.set(a.lead_id, { wie, op: a.created_at })
      }
    }
  }
  for (const [lead, { wie }] of laatsteGeenInteresse) voegUniek('geen_interesse', wie, lead)

  // ── Afspraken ──
  for (const a of inv.afspraken) {
    if (a.lead_id && a.status !== 'cancelled' && inPeriode(a.created_at)) {
      rij(a.setter_id)
      voegUniek('ingepland', a.setter_id || ONBEKEND, a.lead_id)
    }
    if (a.status === 'cancelled' || !inPeriode(a.starts_at)) continue
    const r = rij(a.verantwoordelijke_id)
    if (isGehouden(a)) r.afsprakenGehouden++
    else if (a.aanwezigheid === 'niet_gehouden') r.afsprakenNietGehouden++
    else if (a.starts_at < inv.nu) r.afsprakenOnbevestigd++
  }

  // ── Gewonnen / verloren (op sluitdatum) ──
  const gehoudenPerLead = new Map<string, PAfspraak>()
  for (const a of inv.afspraken) {
    if (!a.lead_id || a.status === 'cancelled' || !isGehouden(a)) continue
    const vorig = gehoudenPerLead.get(a.lead_id)
    if (!vorig || a.starts_at > vorig.starts_at) gehoudenPerLead.set(a.lead_id, a)
  }
  let geslotenZonderDatum = 0
  let teamGewonnenGehouden = 0, teamAfgerondGehouden = 0
  for (const l of inv.leads) {
    if (l.stage_key !== 'gewonnen' && l.stage_key !== 'verloren') continue
    if (!l.gesloten_op) { geslotenZonderDatum++; continue }
    if (!inPeriode(l.gesloten_op)) continue
    const afspraak = gehoudenPerLead.get(l.id)
    const r = rij(afspraak?.verantwoordelijke_id || l.assigned_to)
    const won = l.stage_key === 'gewonnen'
    if (won) r.gewonnen++; else r.verloren++
    if (afspraak) {
      r.closingAfgerond++; teamAfgerondGehouden++
      if (won) { r.closingGewonnen++; teamGewonnenGehouden++ }
    }
  }

  // ── Samenstellen ──
  for (const r of rijen.values()) {
    r.bereikteLeads = aantalUniek('bereikt', r.sleutel)
    r.afsprakenIngepland = aantalUniek('ingepland', r.sleutel)
    r.geenInteresse = aantalUniek('geen_interesse', r.sleutel)
    r.closingRate = percentage(r.closingGewonnen, r.closingAfgerond)
  }
  const perMedewerker = [...rijen.values()].sort((a, b) => (a.sleutel === ONBEKEND ? 1 : 0) - (b.sleutel === ONBEKEND ? 1 : 0))

  const team = leeg('team')
  for (const r of perMedewerker) {
    for (const k of ['coldCalls', 'gesprekkenZonderBron', 'gesprekkenMetDuur', 'gesprekkenZonderDuur', 'gespreksduurSec', 'afsprakenGehouden', 'afsprakenNietGehouden', 'afsprakenOnbevestigd', 'gewonnen', 'verloren', 'faseverplaatsingen'] as const) team[k] += r[k]
  }
  team.bereikteLeads = aantalUniek('bereikt', '__team__')
  team.afsprakenIngepland = aantalUniek('ingepland', '__team__')
  team.geenInteresse = aantalUniek('geen_interesse', '__team__')
  team.closingGewonnen = teamGewonnenGehouden
  team.closingAfgerond = teamAfgerondGehouden
  team.closingRate = percentage(teamGewonnenGehouden, teamAfgerondGehouden)

  // ── Podium ──
  const personen = perMedewerker.filter((r) => r.sleutel !== ONBEKEND)
  const coldCaller = rangschik(personen.filter((r) => r.afsprakenIngepland > 0), (r) => r.afsprakenIngepland)
    .filter((r) => r.plaats <= 3)
    .map((r) => ({ plaats: r.plaats, sleutel: r.sleutel, waarde: r.afsprakenIngepland }))
  const closer = rangschik(personen.filter((r) => r.closingRate !== null), (r) => r.closingRate ?? -1)
    .filter((r) => r.plaats <= 3)
    .map((r) => ({ plaats: r.plaats, sleutel: r.sleutel, waarde: r.closingRate ?? 0, detail: `${r.closingGewonnen} / ${r.closingAfgerond}` }))

  return { perMedewerker, team, podium: { coldCaller, closer }, geslotenZonderDatum }
}

/** Duur als "1 u 05 min" of "12 min 30 s". */
export function duurTekst(sec: number): string {
  const u = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  if (u > 0) return `${u} u ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min${s ? ` ${s} s` : ''}`
  return `${s} s`
}

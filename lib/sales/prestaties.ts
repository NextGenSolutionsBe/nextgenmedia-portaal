/**
 * Salesprestaties per medewerker — pure module (geen database), getest in
 * tests/sales-prestaties.test.ts.
 *
 * TWEE SOORTEN CIJFERS
 *
 * 1) PIPELINECIJFERS — de actuele pipeline is de enige bron. Elke lead telt voor
 *    de VERANTWOORDELIJKE die nu op de lead staat (sales_leads.assigned_to),
 *    ongeacht wie de kaart versleepte of aanpaste, en ongeacht de gekozen
 *    periode (het is de stand van de pipeline op dit moment).
 *  · Ingepland  = lead in Afspraak gepland, Voorstel, Gewonnen of Verloren, of
 *                 met een (niet geannuleerde) afspraak in de agenda.
 *  · Gehouden   = lead in Voorstel, Gewonnen of Verloren (daar ga je pas heen na
 *                 de meeting), of met een afspraak die als gehouden bevestigd is.
 *  · Gewonnen / Verloren / Geen interesse = lead staat nu in die fase.
 *  · Closing rate = gewonnen ÷ (gewonnen + verloren) × 100; geen afgeronde
 *                 leads → null (geen percentage).
 *
 * 2) ACTIVITEITEN — per periode, voor wie de actie UITVOERDE.
 *  · Cold calls   = alle geregistreerde belpogingen (één totaal).
 *  · Bereikt      = unieke leads met een gesprek waarin iemand bereikt werd.
 *  · Gespreksduur = enkel uit een GEMETEN start en einde (timer); nooit geschat.
 *  · Faseverplaatsingen = elke verplaatsing naar een ANDERE fase, door wie ze
 *                 uitvoerde. Heen en terug = 2; zonder faseverschil = 0.
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

/** Een lead zoals hij NU in de pipeline staat (niet gearchiveerd). */
export type PLead = { id: string; stage_key: string; assigned_to: string | null }

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
  /** gewonnen ÷ (gewonnen + verloren) × 100; null zonder afgeronde leads. */
  closingRate: number | null
}

export type PodiumPlek = { plaats: number; sleutel: string; waarde: number; detail?: string }

export type PUitkomst = {
  perMedewerker: PRij[]
  team: PRij
  podium: { coldCaller: PodiumPlek[]; closer: PodiumPlek[] }
}

export const ONBEKEND = 'onbekend'
const BEREIKT = new Set(['contact_gehad', 'geen_interesse', 'afspraak_gepland'])

const leeg = (sleutel: string): PRij => ({
  sleutel, coldCalls: 0, bereikteLeads: 0, gesprekkenMetDuur: 0, gesprekkenZonderDuur: 0, gespreksduurSec: 0,
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

/** Fases die betekenen dat er een afspraak ingepland werd / de meeting plaatsvond. */
export const INGEPLAND_FASES = new Set(['afspraak', 'voorstel', 'gewonnen', 'verloren'])
export const GEHOUDEN_FASES = new Set(['voorstel', 'gewonnen', 'verloren'])

export function berekenPrestaties(inv: PInvoer): PUitkomst {
  const inPeriode = (iso: string | null | undefined) => !!iso && iso >= inv.van && iso < inv.tot
  const rijen = new Map<string, PRij>()
  const rij = (id: string | null | undefined) => {
    const k = id || ONBEKEND
    if (!rijen.has(k)) rijen.set(k, leeg(k))
    return rijen.get(k)!
  }
  const bereikt = new Map<string, Set<string>>()
  const voegBereikt = (wie: string, lead: string) => {
    for (const k of [wie, '__team__']) {
      if (!bereikt.has(k)) bereikt.set(k, new Set())
      bereikt.get(k)!.add(lead)
    }
  }

  // ── Activiteiten (periode, uitvoerder) ──
  for (const a of inv.activiteiten) {
    if (!inPeriode(a.created_at)) continue
    const wie = a.medewerker_id || ONBEKEND
    if (a.type === 'telefoongesprek') {
      const r = rij(wie)
      r.coldCalls++
      const d = gemetenDuur(a)
      if (d === null) r.gesprekkenZonderDuur++
      else { r.gesprekkenMetDuur++; r.gespreksduurSec += d }
      if (a.uitkomst && BEREIKT.has(a.uitkomst)) voegBereikt(wie, a.lead_id)
    } else if (a.type === 'fase_gewijzigd') {
      if (a.naar_fase && a.van_fase && a.van_fase === a.naar_fase) continue // geen faseverschil
      rij(wie).faseverplaatsingen++
    }
  }

  // ── Pipeline (actuele stand, verantwoordelijke van de lead) ──
  const afsprakenPerLead = new Map<string, PAfspraak[]>()
  for (const a of inv.afspraken) {
    if (!a.lead_id || a.status === 'cancelled') continue
    const l = afsprakenPerLead.get(a.lead_id) ?? []
    l.push(a); afsprakenPerLead.set(a.lead_id, l)
  }
  for (const l of inv.leads) {
    const afs = afsprakenPerLead.get(l.id) ?? []
    const ingepland = INGEPLAND_FASES.has(l.stage_key) || afs.length > 0
    const gehouden = GEHOUDEN_FASES.has(l.stage_key) || afs.some(isGehouden)
    const telt = ingepland || l.stage_key === 'geen_interesse'
    if (!telt) continue
    const r = rij(l.assigned_to)
    if (ingepland) r.afsprakenIngepland++
    if (gehouden) r.afsprakenGehouden++
    else if (ingepland) {
      if (afs.some((a) => a.aanwezigheid === 'niet_gehouden')) r.afsprakenNietGehouden++
      else if (afs.some((a) => a.aanwezigheid == null && a.starts_at < inv.nu)) r.afsprakenOnbevestigd++
    }
    if (l.stage_key === 'gewonnen') r.gewonnen++
    else if (l.stage_key === 'verloren') r.verloren++
    else if (l.stage_key === 'geen_interesse') r.geenInteresse++
  }

  // ── Samenstellen ──
  for (const r of rijen.values()) {
    r.bereikteLeads = bereikt.get(r.sleutel)?.size ?? 0
    r.closingGewonnen = r.gewonnen
    r.closingAfgerond = r.gewonnen + r.verloren
    r.closingRate = percentage(r.closingGewonnen, r.closingAfgerond)
  }
  const perMedewerker = [...rijen.values()].sort((a, b) => (a.sleutel === ONBEKEND ? 1 : 0) - (b.sleutel === ONBEKEND ? 1 : 0))

  const team = leeg('team')
  for (const r of perMedewerker) {
    for (const k of ['coldCalls', 'gesprekkenMetDuur', 'gesprekkenZonderDuur', 'gespreksduurSec', 'afsprakenIngepland', 'afsprakenGehouden', 'afsprakenNietGehouden', 'afsprakenOnbevestigd', 'gewonnen', 'verloren', 'geenInteresse', 'faseverplaatsingen'] as const) team[k] += r[k]
  }
  team.bereikteLeads = bereikt.get('__team__')?.size ?? 0
  team.closingGewonnen = team.gewonnen
  team.closingAfgerond = team.gewonnen + team.verloren
  team.closingRate = percentage(team.closingGewonnen, team.closingAfgerond)

  // ── Podium ──
  const personen = perMedewerker.filter((r) => r.sleutel !== ONBEKEND)
  const coldCaller = rangschik(personen.filter((r) => r.coldCalls > 0), (r) => r.coldCalls)
    .filter((r) => r.plaats <= 3)
    .map((r) => ({ plaats: r.plaats, sleutel: r.sleutel, waarde: r.coldCalls }))
  const closer = rangschik(personen.filter((r) => r.closingRate !== null), (r) => r.closingRate ?? -1, (r) => r.closingAfgerond)
    .filter((r) => r.plaats <= 3)
    .map((r) => ({ plaats: r.plaats, sleutel: r.sleutel, waarde: r.closingRate ?? 0, detail: `${r.closingGewonnen} / ${r.closingAfgerond}` }))

  return { perMedewerker, team, podium: { coldCaller, closer } }
}

/**
 * Uitkomst van een oude belregistratie (tijdlijntekst van vóór de
 * activiteitentabel), zodat 'bereikt' ook voor die gesprekken klopt.
 */
export function uitkomstUitOudeTekst(body: string | null): string | null {
  const t = (body ?? '').trim().toLowerCase()
  if (!t) return null
  if (t.startsWith('geen antwoord') || t.includes('niet opgenomen')) return 'niet_opgenomen'
  if (t.includes('geen interesse')) return 'geen_interesse'
  if (t.includes('afspraak gepland') || t.startsWith('afspraak')) return 'afspraak_gepland'
  if (t.startsWith('terugbelafspraak') || t.startsWith('interesse') || t.startsWith('gesproken') || t.startsWith('e-mail versturen') || t.includes('contact gehad')) return 'contact_gehad'
  return null
}

/** Duur als "1 u 05 min" of "12 min 30 s". */
export function duurTekst(sec: number): string {
  const u = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  if (u > 0) return `${u} u ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min${s ? ` ${s} s` : ''}`
  return `${s} s`
}

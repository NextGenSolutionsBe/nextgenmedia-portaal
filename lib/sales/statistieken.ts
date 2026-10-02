/**
 * Salesstatistieken — wat het team DEED: gebeld, gemaild, opgevolgd, afspraken
 * gezet, voorstellen verstuurd, deals gewonnen of verloren.
 *
 * Pure module — geen database, geen server-only imports. Alles rekent op rijen
 * die je meegeeft (sales_activiteiten, aangevuld met oude belregistraties), zo
 * is elke ratio los te testen (tests/sales-statistieken.test.ts).
 *
 * TELREGELS
 *  · Zacht verwijderde activiteiten tellen niet.
 *  · Een lead drie keer gebeld = 3 telefoongesprekken, 1 unieke lead.
 *  · Een afspraak telt één keer, ook als ze verplaatst werd (ontdubbeld op
 *    afspraak_id); een geannuleerde afspraak telt niet.
 *  · Een deal telt hoogstens één keer per lead: de LAATSTE sluiting (gewonnen
 *    of verloren) in de periode is de uitkomst.
 *  · Een ratio zonder noemer is null ("—"), nooit NaN of 0%.
 *  · "Totale gespreksduur" = som van de duur per geregistreerd gesprek;
 *    "Gelogde beltijd" = som van de belsessies (lib/sales/beltijd.ts). Twee
 *    verschillende metingen, apart getoond en NOOIT bij elkaar opgeteld.
 *
 * NIET te verwarren met lib/sales/setters.ts (geld: uren, commissie,
 * uitbetalingen — het scherm "Resultaten").
 */

import { GESLAAGD_CONTACT, formatDuur } from '@/lib/sales/activiteiten-model'
import { isInboundBron, leadbronLabel, normaliseerLeadbron } from '@/lib/sales/leadbron'
import { beltijdPerMedewerker, beltijdSeconden, type BeltijdSessie } from '@/lib/sales/beltijd'

export type StatActiviteit = {
  id: string
  lead_id: string
  medewerker_id: string | null
  medewerker_email?: string | null
  type: string
  duur_seconden: number | null
  uitkomst: string | null
  afspraak_id?: string | null
  created_at: string
  verwijderd_op?: string | null
}

export type StatLead = {
  id: string
  leadbron: string | null
  dienst: string | null
  deal_waarde_cents: number | null
}

export type StatMedewerker = { id: string; naam: string }

export type StatFilter = {
  /** Auth-gebruiker. */
  medewerkerId?: string
  richting?: 'inbound' | 'outbound'
  dienst?: string
  leadbron?: string
}

export type TrendPer = 'dag' | 'week' | 'maand'

export type Cijfers = {
  telefoongesprekken: number
  /** TOTALE GESPREKSDUUR: som van de duur die bij de gesprekken werd ingevuld. */
  beltijdSeconden: number
  /** Gesprekken MET een geregistreerde duur (noemer van het gemiddelde). */
  gesprekkenMetDuur: number
  emails: number
  /** Unieke leads waarop iets gedaan is (alles behalve een fasewissel). */
  uniekeLeads: number
  opvolgingen: number
  afspraken: number
  voorstellen: number
  gewonnen: number
  verloren: number
  waardeGewonnenCent: number
  /** Unieke leads met geslaagd contact (gesprek met contact, e-mail, of afspraak). */
  leadsMetContact: number
  /** Unieke leads met minstens één (niet-geannuleerde) afspraak. */
  leadsMetAfspraak: number
  gemiddeldeDuurSeconden: number | null
  /** gewonnen ÷ (gewonnen + verloren) × 100 */
  closingRate: number | null
  /** leads met afspraak ÷ leads met geslaagd contact × 100 */
  appointmentRate: number | null
  /** leads met geslaagd contact ÷ unieke behandelde leads × 100 */
  contactRate: number | null
  /**
   * GELOGDE BELTIJD: som van de belsessies (start/stop of handmatig). null =
   * niet van toepassing (bv. per leadbron: een sessie hangt niet aan een lead)
   * of niet beschikbaar (tabel nog niet gemigreerd).
   */
  gelogdeBeltijdSeconden: number | null
}

export type Rij = Cijfers & { sleutel: string; label: string }

export type TrendPunt = {
  sleutel: string
  telefoongesprekken: number
  emails: number
  afspraken: number
  gewonnen: number
}

export type Uitblinker = { titel: string; naam: string; waarde: string }

export type Statistieken = {
  team: Cijfers
  perMedewerker: Rij[]
  perLeadbron: Rij[]
  trend: TrendPunt[]
  trendPer: TrendPer
  vergelijking: Uitblinker[]
}

// ── Kleine rekenhulpen ───────────────────────────────────────────────────────

/**
 * Een percentage, of null als er niets is om over te rekenen.
 * NULL EN NIET NUL: "0% van 0" leest als een slecht resultaat, terwijl er
 * gewoon niets gebeurd is. Het scherm toont daar een streepje.
 */
export function percentage(deel: number, geheel: number): number | null {
  if (!Number.isFinite(deel) || !Number.isFinite(geheel) || geheel <= 0) return null
  const p = (deel / geheel) * 100
  return Number.isFinite(p) ? p : null
}

export const toonPercentage = (p: number | null | undefined): string =>
  p === null || p === undefined || !Number.isFinite(p) ? '—' : `${p.toFixed(1).replace('.', ',')}%`

/** Gemiddelde, of null zonder noemer. */
export function gemiddelde(som: number, n: number): number | null {
  if (!Number.isFinite(som) || !Number.isFinite(n) || n <= 0) return null
  return som / n
}

const DEEL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** JJJJ-MM-DD zoals het in Brussel is (niet via toISOString: dat is UTC). */
export function brusselDag(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return DEEL.format(d)
}

/** De sleutel van het trendvak waarin een moment valt. Week = maandag. */
export function trendSleutel(iso: string, per: TrendPer): string | null {
  const dag = brusselDag(iso)
  if (!dag) return null
  if (per === 'dag') return dag
  if (per === 'maand') return dag.slice(0, 7)
  const [j, m, d] = dag.split('-').map(Number)
  const t = new Date(Date.UTC(j, m - 1, d, 12))
  const naarMaandag = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - naarMaandag)
  return t.toISOString().slice(0, 10)
}

/** Automatische trendgranulariteit voor een periode (in dagen). */
export function kiesTrendPer(dagen: number): TrendPer {
  if (dagen <= 31) return 'dag'
  if (dagen <= 120) return 'week'
  return 'maand'
}

// ── Oude belregistraties ─────────────────────────────────────────────────────

export type LegacyGesprek = { id?: string; lead_id: string; actor_id: string | null; actor_email?: string | null; created_at: string }

/**
 * Oude belregistraties (sales_lead_events kind='call') van VÓÓR de eerste
 * activiteitenrij tellen mee als telefoongesprek zonder duur en zonder
 * uitkomst. Daarna schrijft elk gesprek zowel een activiteit als een
 * tijdlijnregel — die tijdlijnregels mogen dus niet nog eens meetellen.
 */
export function legacyGesprekken(events: LegacyGesprek[], eersteActiviteitOp: string | null): StatActiviteit[] {
  const grens = eersteActiviteitOp ? new Date(eersteActiviteitOp).getTime() : Infinity
  return events
    .filter((e) => new Date(e.created_at).getTime() < grens)
    .map((e, i) => ({
      id: e.id ? `legacy-${e.id}` : `legacy-${i}`,
      lead_id: e.lead_id,
      medewerker_id: e.actor_id,
      medewerker_email: e.actor_email ?? null,
      type: 'telefoongesprek',
      duur_seconden: null,
      uitkomst: null,
      afspraak_id: null,
      created_at: e.created_at,
      verwijderd_op: null,
    }))
}

// ── Ontdubbelen ──────────────────────────────────────────────────────────────

/**
 * Welke afspraak- en sluitingsactiviteiten tellen? Globaal bepaald, zodat
 * teamtotaal en de som per medewerker nooit uit elkaar lopen.
 */
export function getelde(acts: StatActiviteit[], geannuleerd: Set<string>): { afspraken: Set<string>; sluitingen: Set<string> } {
  const afspraken = new Set<string>()
  const perAfspraak = new Set<string>()
  const laatsteSluiting = new Map<string, StatActiviteit>()
  const opTijd = [...acts].sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const a of opTijd) {
    if (a.type === 'afspraak_gepland') {
      if (a.afspraak_id && geannuleerd.has(a.afspraak_id)) continue
      const sleutel = a.afspraak_id ? `a:${a.afspraak_id}` : `x:${a.id}`
      if (perAfspraak.has(sleutel)) continue
      perAfspraak.add(sleutel)
      afspraken.add(a.id)
    } else if (a.type === 'deal_gewonnen' || a.type === 'deal_verloren') {
      laatsteSluiting.set(a.lead_id, a)
    }
  }
  return { afspraken, sluitingen: new Set([...laatsteSluiting.values()].map((a) => a.id)) }
}

// ── Tellen ───────────────────────────────────────────────────────────────────

export function telCijfers(
  acts: StatActiviteit[],
  leadById: Map<string, StatLead>,
  geteld: { afspraken: Set<string>; sluitingen: Set<string> },
): Cijfers {
  let telefoongesprekken = 0, beltijdSeconden = 0, gesprekkenMetDuur = 0
  let emails = 0, opvolgingen = 0, afspraken = 0, voorstellen = 0, gewonnen = 0, verloren = 0
  let waardeGewonnenCent = 0
  const behandeld = new Set<string>()
  const contact = new Set<string>()
  const metAfspraak = new Set<string>()

  for (const a of acts) {
    if (a.type !== 'fase_gewijzigd') behandeld.add(a.lead_id)
    switch (a.type) {
      case 'telefoongesprek': {
        telefoongesprekken++
        const d = a.duur_seconden
        if (typeof d === 'number' && Number.isFinite(d) && d >= 0) { beltijdSeconden += d; gesprekkenMetDuur++ }
        if (a.uitkomst && GESLAAGD_CONTACT.has(a.uitkomst)) contact.add(a.lead_id)
        break
      }
      case 'email_verstuurd': emails++; contact.add(a.lead_id); break
      case 'opvolging': opvolgingen++; break
      case 'voorstel_verstuurd': voorstellen++; break
      case 'afspraak_gepland':
        if (geteld.afspraken.has(a.id)) {
          afspraken++
          metAfspraak.add(a.lead_id)
          // Een geboekte afspraak veronderstelt contact.
          contact.add(a.lead_id)
        }
        break
      case 'deal_gewonnen':
        if (geteld.sluitingen.has(a.id)) {
          gewonnen++
          const w = leadById.get(a.lead_id)?.deal_waarde_cents
          if (typeof w === 'number' && Number.isFinite(w) && w > 0) waardeGewonnenCent += w
        }
        break
      case 'deal_verloren':
        if (geteld.sluitingen.has(a.id)) verloren++
        break
    }
  }

  const uniekeLeads = behandeld.size
  const leadsMetContact = contact.size
  const leadsMetAfspraak = metAfspraak.size
  return {
    telefoongesprekken, beltijdSeconden, gesprekkenMetDuur, emails, uniekeLeads, opvolgingen,
    afspraken, voorstellen, gewonnen, verloren, waardeGewonnenCent, leadsMetContact, leadsMetAfspraak,
    gemiddeldeDuurSeconden: gemiddelde(beltijdSeconden, gesprekkenMetDuur),
    closingRate: percentage(gewonnen, gewonnen + verloren),
    appointmentRate: percentage(leadsMetAfspraak, leadsMetContact),
    contactRate: percentage(leadsMetContact, uniekeLeads),
    gelogdeBeltijdSeconden: null,
  }
}

export const legeCijfers = (): Cijfers => telCijfers([], new Map(), { afspraken: new Set(), sluitingen: new Set() })

/** Past de filters toe (medewerker, inbound/outbound, dienst, leadbron) en gooit verwijderde rijen weg. */
export function filterActiviteiten(acts: StatActiviteit[], leadById: Map<string, StatLead>, f: StatFilter = {}): StatActiviteit[] {
  return acts.filter((a) => {
    if (a.verwijderd_op) return false
    if (f.medewerkerId && a.medewerker_id !== f.medewerkerId) return false
    if (f.richting || f.dienst || f.leadbron) {
      const lead = leadById.get(a.lead_id)
      if (!lead) return false
      const bron = normaliseerLeadbron(lead.leadbron)
      if (f.richting === 'inbound' && !isInboundBron(bron)) return false
      if (f.richting === 'outbound' && isInboundBron(bron)) return false
      if (f.leadbron && bron !== f.leadbron) return false
      if (f.dienst && (lead.dienst ?? '').trim().toLowerCase() !== f.dienst.trim().toLowerCase()) return false
    }
    return true
  })
}

const ONBEKEND = 'onbekend'

export function bereken(bron: {
  activiteiten: StatActiviteit[]
  leads: StatLead[]
  medewerkers: StatMedewerker[]
  geannuleerdeAfspraken?: Iterable<string>
  trendPer?: TrendPer
  /** Belsessies in de periode (al op periode gefilterd). Weglaten = niet beschikbaar. */
  beltijd?: BeltijdSessie[]
  /** "Nu" voor lopende sessies (ms). Standaard Date.now(). */
  nu?: number
}, filter: StatFilter = {}): Statistieken {
  const leadById = new Map(bron.leads.map((l) => [l.id, l]))
  const acts = filterActiviteiten(bron.activiteiten, leadById, filter)
  const geteld = getelde(acts, new Set(bron.geannuleerdeAfspraken ?? []))
  const trendPer = bron.trendPer ?? 'dag'

  const team = telCijfers(acts, leadById, geteld)
  // Gelogde beltijd hangt aan een medewerker, niet aan een lead: enkel de
  // medewerkerfilter geldt (richting/dienst/leadbron niet).
  const beltijdPer = bron.beltijd ? beltijdPerMedewerker(bron.beltijd, { medewerkerId: filter.medewerkerId, nu: bron.nu }) : null
  if (bron.beltijd) team.gelogdeBeltijdSeconden = beltijdSeconden(bron.beltijd, { medewerkerId: filter.medewerkerId, nu: bron.nu })

  // Per medewerker
  const naamVan = new Map(bron.medewerkers.map((m) => [m.id, m.naam]))
  const groepen = new Map<string, { label: string; acts: StatActiviteit[] }>()
  for (const a of acts) {
    const sleutel = a.medewerker_id ?? ONBEKEND
    let g = groepen.get(sleutel)
    if (!g) {
      const label = (a.medewerker_id && naamVan.get(a.medewerker_id))
        || a.medewerker_email?.split('@')[0]
        || (a.medewerker_id ? 'Onbekende medewerker' : 'Onbekend')
      g = { label, acts: [] }
      groepen.set(sleutel, g)
    }
    g.acts.push(a)
  }
  // Wie enkel beltijd logde (nog geen activiteit) hoort er ook bij.
  for (const [id, sec] of beltijdPer ?? []) {
    if (sec > 0 && !groepen.has(id)) groepen.set(id, { label: naamVan.get(id) ?? bron.beltijd?.find((b) => b.medewerker_id === id)?.medewerker_email?.split('@')[0] ?? 'Onbekende medewerker', acts: [] })
  }
  const perMedewerker: Rij[] = [...groepen.entries()]
    .map(([sleutel, g]) => {
      const c = telCijfers(g.acts, leadById, geteld)
      if (beltijdPer) c.gelogdeBeltijdSeconden = sleutel === ONBEKEND ? null : (beltijdPer.get(sleutel) ?? 0)
      return { sleutel, label: g.label, ...c }
    })
    .sort((a, b) => b.telefoongesprekken - a.telefoongesprekken || b.afspraken - a.afspraken || a.label.localeCompare(b.label))

  // Per leadbron
  const perBron = new Map<string, StatActiviteit[]>()
  for (const a of acts) {
    const b = normaliseerLeadbron(leadById.get(a.lead_id)?.leadbron)
    const lijst = perBron.get(b) ?? []
    lijst.push(a)
    perBron.set(b, lijst)
  }
  const perLeadbron: Rij[] = [...perBron.entries()]
    .map(([sleutel, lijst]) => ({ sleutel, label: leadbronLabel(sleutel), ...telCijfers(lijst, leadById, geteld) }))
    .sort((a, b) => b.uniekeLeads - a.uniekeLeads || a.label.localeCompare(b.label))

  // Trend
  const vakken = new Map<string, TrendPunt>()
  for (const a of acts) {
    const sleutel = trendSleutel(a.created_at, trendPer)
    if (!sleutel) continue
    let v = vakken.get(sleutel)
    if (!v) { v = { sleutel, telefoongesprekken: 0, emails: 0, afspraken: 0, gewonnen: 0 }; vakken.set(sleutel, v) }
    if (a.type === 'telefoongesprek') v.telefoongesprekken++
    else if (a.type === 'email_verstuurd') v.emails++
    else if (a.type === 'afspraak_gepland' && geteld.afspraken.has(a.id)) v.afspraken++
    else if (a.type === 'deal_gewonnen' && geteld.sluitingen.has(a.id)) v.gewonnen++
  }
  const trend = [...vakken.values()].sort((a, b) => a.sleutel.localeCompare(b.sleutel))

  return { team, perMedewerker, perLeadbron, trend, trendPer, vergelijking: vergelijk(perMedewerker) }
}

/** Wie deed het meest? Enkel echte medewerkers, en enkel als er iets te winnen viel. */
export function vergelijk(rijen: Rij[]): Uitblinker[] {
  const echt = rijen.filter((r) => r.sleutel !== ONBEKEND)
  const beste = (titel: string, waarde: (r: Rij) => number | null, toon: (v: number) => string): Uitblinker | null => {
    let top: { r: Rij; v: number } | null = null
    for (const r of echt) {
      const v = waarde(r)
      if (v === null || !Number.isFinite(v) || v <= 0) continue
      if (!top || v > top.v) top = { r, v }
    }
    return top ? { titel, naam: top.r.label, waarde: toon(top.v) } : null
  }
  return [
    beste('Meeste telefoongesprekken', (r) => r.telefoongesprekken, (v) => String(v)),
    beste('Meeste gespreksduur', (r) => r.beltijdSeconden, (v) => formatDuur(v)),
    beste('Meeste gelogde beltijd', (r) => r.gelogdeBeltijdSeconden, (v) => formatDuur(v)),
    beste('Meeste afspraken', (r) => r.afspraken, (v) => String(v)),
    beste('Meeste deals', (r) => r.gewonnen, (v) => String(v)),
    beste('Beste closing rate', (r) => (r.gewonnen + r.verloren > 0 ? r.closingRate : null), (v) => toonPercentage(v)),
  ].filter((x): x is Uitblinker => x !== null)
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export type AccountRij = Rij & { beltijdLoopt: boolean }

/**
 * Eén kaart per account voor het overzicht bovenaan de statistieken: iedereen
 * uit de medewerkerslijst (ook zonder activiteit, zodat elk account te kiezen
 * is) plus wie activiteit had maar niet (meer) in de lijst staat. "Onbekend"
 * (activiteit zonder medewerker) is geen account en valt weg.
 */
export function bouwAccounts(perMedewerker: Rij[], medewerkers: StatMedewerker[], lopend: Iterable<string> = [], metBeltijd = false): AccountRij[] {
  const loopt = new Set(lopend)
  const perId = new Map(perMedewerker.map((r) => [r.sleutel, r]))
  const uit: AccountRij[] = []
  for (const m of medewerkers) {
    const r = perId.get(m.id)
    const basis: Rij = r ? { ...r, label: m.naam } : { sleutel: m.id, label: m.naam, ...legeCijfers(), gelogdeBeltijdSeconden: metBeltijd ? 0 : null }
    uit.push({ ...basis, beltijdLoopt: loopt.has(m.id) })
  }
  for (const r of perMedewerker) {
    if (r.sleutel === ONBEKEND || medewerkers.some((m) => m.id === r.sleutel)) continue
    uit.push({ ...r, beltijdLoopt: loopt.has(r.sleutel) })
  }
  return uit.sort((a, b) =>
    b.telefoongesprekken - a.telefoongesprekken
    || (b.gelogdeBeltijdSeconden ?? 0) - (a.gelogdeBeltijdSeconden ?? 0)
    || b.afspraken - a.afspraken
    || a.label.localeCompare(b.label))
}

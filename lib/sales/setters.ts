import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import {
  totalSeconds, earnedCents, monthKey, type Interval,
} from '@/lib/sales/earnings'

/**
 * Appointment setters: wie ze zijn, hoeveel ze werkten en wat ze verdienden.
 *
 * Een setter werkt op uurbasis plus commissie op het eerste contract. Beide
 * lopen per maand en worden apart afgerekend — dat zijn de twee afrekeningen
 * die het scherm toont.
 */

export type Setter = {
  id: string
  auth_user_id: string | null
  name: string
  email: string | null
  hourly_rate_cents: number
  commission_pct: number
  active: boolean
  /** Zaakvoerder die zelf belt: geen uurloon, geen commissie. */
  onbezoldigd?: boolean
}

/**
 * Het uurtarief dat voor de BEREKENING geldt.
 *
 * Bij een onbezoldigde setter is dat nul, ongeacht wat er in het veld staat.
 * Zo kan een oud tarief nooit blijven meetellen nadat iemand op onbezoldigd
 * gezet is — en dat zou stil gebeuren, want die kost duikt enkel op in het
 * financiële dashboard.
 */
export const effectiefUurtarief = (s: Pick<Setter, 'hourly_rate_cents' | 'onbezoldigd'>): number =>
  s.onbezoldigd ? 0 : (s.hourly_rate_cents ?? 0)

export type SetterStats = {
  setter: Setter
  /** Gewerkte tijd in seconden, inclusief een timer die nu loopt. */
  seconds: number
  earnedCents: number
  /**
   * Hetzelfde, maar ZONDER de sessie die op dit moment loopt.
   *
   * Nodig voor de teller op het scherm: die telt de lopende sessie er zelf per
   * seconde bij. Zou hij vertrekken van het totaal hierboven, dan telde die
   * sessie dubbel — en dat is precies wat er misging.
   */
  closedSeconds: number
  closedEarnedCents: number
  /** Loopt er op dit moment een timer, en sinds wanneer? */
  runningSince: string | null
  appointments: number
  won: number
  lost: number
  open: number
  /** Totale waarde van de gewonnen eerste contracten. */
  dealValueCents: number
  commissionCents: number
  totalCents: number
}

/**
 * Het setterprofiel van een ingelogde gebruiker; wordt aangemaakt zodra iemand
 * met de Verkoop-module voor het eerst zijn timer gebruikt. Zo hoeft niemand
 * eerst handmatig een profiel aan te maken voor er gewerkt kan worden.
 */
export async function getOrCreateSetter(
  authUserId: string, name: string, email: string | null,
): Promise<Setter | null> {
  const admin = createAdminSupabaseClient()
  const org = await getOrCreateSalesOrg()

  const { data: existing } = await admin.from('sales_setters')
    .select('*').eq('auth_user_id', authUserId).maybeSingle()
  if (existing) return existing as Setter

  const { data: created, error } = await admin.from('sales_setters').insert({
    sales_client_id: org.id,
    auth_user_id: authUserId,
    name: name || email || 'Appointment setter',
    email,
  }).select('*').single()
  if (error) {
    // Race: twee gelijktijdige verzoeken van dezelfde persoon. De unieke index
    // vangt dat af; we halen dan gewoon het bestaande profiel op.
    const { data: again } = await admin.from('sales_setters')
      .select('*').eq('auth_user_id', authUserId).maybeSingle()
    return (again as Setter) ?? null
  }
  return created as Setter
}

export async function listSetters(): Promise<Setter[]> {
  const admin = createAdminSupabaseClient()
  const org = await getOrCreateSalesOrg()
  const { data } = await admin.from('sales_setters')
    .select('*').eq('sales_client_id', org.id).order('name')
  return (data ?? []) as Setter[]
}

export type Period = { from: Date; to: Date }

/** De maand waarin `d` valt, van de eerste dag tot en met de laatste. */
export function monthPeriod(d = new Date()): Period {
  const from = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0)
  return { from, to }
}

/**
 * Cijfers van één of alle setters over een periode.
 *
 * TWEE VERSCHILLENDE VENSTERS, en dat is bewust:
 *  • afspraken tellen mee in de maand waarin ze PLAATSVINDEN;
 *  • gewonnen/verloren en de commissie tellen in de maand waarin het contract
 *    is AFGESLOTEN. Een afspraak van augustus die in oktober getekend wordt,
 *    levert commissie in oktober — dat is wanneer de verplichting ontstaat, en
 *    wanneer de setter ervoor factureert.
 *
 * De commissie wordt NIET hier berekend maar overgenomen zoals ze bij het
 * afsluiten is vastgelegd — anders zou een latere wijziging van het percentage
 * met terugwerkende kracht doorwerken in wat iemand al had verdiend.
 */
export async function statsFor(period: Period, setterId?: string): Promise<SetterStats[]> {
  const admin = createAdminSupabaseClient()
  const setters = await listSetters()
  const wanted = setterId ? setters.filter((s) => s.id === setterId) : setters
  if (wanted.length === 0) return []

  const ids = wanted.map((s) => s.id)
  const fromIso = period.from.toISOString()
  const toIso = period.to.toISOString()

  /**
   * Afspraken hangen aan een setter via twee velden, en je moet ze allebei
   * gebruiken.
   *
   * `setter_profile_id` wordt sinds kort al bij het boeken gezet, maar oudere
   * afspraken hebben enkel `setter_id` (de auth-gebruiker) — dat veld werd
   * vroeger pas ingevuld bij het registreren van de afloop. Kijk je alleen naar
   * het profiel, dan verdwijnt elke afspraak die nog opgevolgd moet worden uit
   * de cijfers. Vandaar deze filter op beide velden, plus de brug hieronder.
   */
  const authIds = wanted.map((s) => s.auth_user_id).filter((x): x is string => !!x)
  const profielVanAuth = new Map(
    wanted.filter((s) => s.auth_user_id).map((s) => [s.auth_user_id as string, s.id]),
  )
  const opSetter = authIds.length > 0
    ? `setter_profile_id.in.(${ids.join(',')}),setter_id.in.(${authIds.join(',')})`
    : null

  /** Bij welke setter hoort deze afspraak? Profiel wint; anders wie boekte. */
  const hoortBij = (a: { setter_profile_id: string | null; setter_id: string | null }): string | null =>
    a.setter_profile_id ?? (a.setter_id ? profielVanAuth.get(a.setter_id) ?? null : null)

  const KOLOMMEN = 'setter_profile_id, setter_id, status, outcome, deal_value_cents, commission_cents'

  const [{ data: times }, { data: appts }] = await Promise.all([
    // Ook blokken die vóór de periode begonnen maar er nog in doorlopen.
    admin.from('sales_time_entries')
      .select('setter_id, started_at, ended_at')
      .in('setter_id', ids)
      .lt('started_at', toIso)
      .or(`ended_at.is.null,ended_at.gte.${fromIso}`),
    (() => {
      const q = admin.from('sales_appointments')
        .select(`${KOLOMMEN}, starts_at`)
        .gte('starts_at', fromIso)
        .lt('starts_at', toIso)
      return opSetter ? q.or(opSetter) : q.in('setter_profile_id', ids)
    })(),
  ])

  // Afgesloten contracten van DEZE maand, ongeacht wanneer de afspraak stond.
  const { data: closed } = await (() => {
    const q = admin.from('sales_appointments')
      .select(`${KOLOMMEN}, outcome_at`)
      .not('outcome', 'is', null)
      .gte('outcome_at', fromIso)
      .lt('outcome_at', toIso)
    return opSetter ? q.or(opSetter) : q.in('setter_profile_id', ids)
  })()

  const timeBySetter = new Map<string, Interval[]>()
  for (const t of (times ?? []) as { setter_id: string; started_at: string; ended_at: string | null }[]) {
    const list = timeBySetter.get(t.setter_id) ?? []
    // Buiten de periode geknipt, zodat een blok dat over middernacht van de
    // maand loopt niet volledig in één maand terechtkomt.
    const start = new Date(t.started_at) < period.from ? fromIso : t.started_at
    const end = t.ended_at && new Date(t.ended_at) > period.to ? toIso : t.ended_at
    list.push({ started_at: start, ended_at: end })
    timeBySetter.set(t.setter_id, list)
  }

  const now = Date.now()
  return wanted.map((setter) => {
    const entries = timeBySetter.get(setter.id) ?? []
    const seconds = totalSeconds(entries, now)
    const running = entries.find((e) => e.ended_at === null)
    const closedSeconds = totalSeconds(entries.filter((e) => e.ended_at !== null), now)

    type ApptRij = {
      setter_profile_id: string | null; setter_id: string | null
      status: string; outcome: string | null
      deal_value_cents: number | null; commission_cents: number | null
    }

    const mine = ((appts ?? []) as unknown as ApptRij[])
      .filter((a) => hoortBij(a) === setter.id && a.status !== 'cancelled')

    const closedMine = ((closed ?? []) as unknown as ApptRij[])
      .filter((a) => hoortBij(a) === setter.id && a.status !== 'cancelled')

    const won = closedMine.filter((a) => a.outcome === 'won')
    const lost = closedMine.filter((a) => a.outcome === 'lost')
    const commission = won.reduce((sum, a) => sum + (a.commission_cents ?? 0), 0)
    const hours = earnedCents(seconds, effectiefUurtarief(setter))

    return {
      setter,
      seconds,
      earnedCents: hours,
      closedSeconds,
      closedEarnedCents: earnedCents(closedSeconds, effectiefUurtarief(setter)),
      runningSince: running?.started_at ?? null,
      appointments: mine.length,
      won: won.length,
      lost: lost.length,
      // Afspraken van deze maand waar nog geen uitkomst op staat.
      open: mine.filter((a) => !a.outcome).length,
      dealValueCents: won.reduce((sum, a) => sum + (a.deal_value_cents ?? 0), 0),
      commissionCents: commission,
      totalCents: hours + commission,
    }
  })
}

export type Payout = {
  setterId: string
  setterName: string
  month: string
  kind: 'hours' | 'commission'
  amountCents: number
  status: 'open' | 'paid'
  paidAt: string | null
}

/**
 * De twee afrekeningen per setter voor een maand: uren en commissie.
 *
 * Het bedrag wordt telkens opnieuw uit de bron berekend zolang er niet betaald
 * is. Zodra er "betaald" op staat, blijft het bedrag staan zoals het toen was —
 * anders zou een late tijdregistratie een al betaalde afrekening veranderen.
 */
export async function payoutsFor(month: Date): Promise<Payout[]> {
  const admin = createAdminSupabaseClient()
  const period = monthPeriod(month)
  const key = monthKey(period.from)
  const stats = await statsFor(period)

  const { data: saved } = await admin.from('sales_payouts')
    .select('setter_id, kind, amount_cents, status, paid_at').eq('month', key)
  const savedByKey = new Map(
    ((saved ?? []) as { setter_id: string; kind: string; amount_cents: number; status: string; paid_at: string | null }[])
      .map((r) => [`${r.setter_id}|${r.kind}`, r]),
  )

  const out: Payout[] = []
  for (const s of stats) {
    /**
     * Onbezoldigde setters (zaakvoerders die zelf bellen) horen hier NIET.
     * Een regel van € 0,00 met een knop "op betaald zetten" is geen nul —
     * het is ruis die elke maand om aandacht vraagt en de indruk wekt dat er
     * nog iets moet gebeuren.
     *
     * Reeds UITBETAALDE regels blijven wel staan: is er ooit iets betaald
     * voordat iemand op onbezoldigd ging, dan hoort die betaling in de
     * historie te blijven en niet uit beeld te verdwijnen.
     */
    const heeftBetaling = ['hours', 'commission'].some(
      (k) => savedByKey.get(`${s.setter.id}|${k}`)?.status === 'paid',
    )
    if (s.setter.onbezoldigd && !heeftBetaling) continue

    for (const kind of ['hours', 'commission'] as const) {
      const live = kind === 'hours' ? s.earnedCents : s.commissionCents
      const row = savedByKey.get(`${s.setter.id}|${kind}`)
      const paid = row?.status === 'paid'
      out.push({
        setterId: s.setter.id,
        setterName: s.setter.name,
        month: key,
        kind,
        amountCents: paid ? row!.amount_cents : live,
        status: paid ? 'paid' : 'open',
        paidAt: row?.paid_at ?? null,
      })
    }
  }
  return out
}

/**
 * Kost van de appointment setters per maand van een boekjaar, in EURO.
 *
 * Voor Financiën, dat in euro's rekent. De kost van een maand is wat er die
 * maand verdiend is: gewerkte uren plus commissie op de deals die toen gewonnen
 * zijn. Een lopende timer telt mee tot nu — daardoor zie je de kost van vandaag
 * meegroeien terwijl er gebeld wordt.
 *
 * Eén query over het hele jaar in plaats van twaalf losse: dit draait op elke
 * weergave van het financiële dashboard.
 */
export async function setterCostByMonth(year: number): Promise<number[]> {
  const admin = createAdminSupabaseClient()
  const months = Array.from({ length: 12 }, () => 0)

  const setters = await listSetters()
  if (setters.length === 0) return months
  // Onbezoldigde setters tellen als kost NIET mee in de financiën.
  const rateById = new Map(setters.map((s) => [s.id, effectiefUurtarief(s)]))
  const ids = setters.map((s) => s.id)

  const from = new Date(year, 0, 1)
  const to = new Date(year + 1, 0, 1)
  const now = Date.now()

  const [{ data: times }, { data: appts }] = await Promise.all([
    admin.from('sales_time_entries')
      .select('setter_id, started_at, ended_at')
      .in('setter_id', ids)
      .lt('started_at', to.toISOString())
      .or(`ended_at.is.null,ended_at.gte.${from.toISOString()}`),
    admin.from('sales_appointments')
      .select('setter_profile_id, outcome, commission_cents, outcome_at, starts_at, status')
      .in('setter_profile_id', ids)
      .eq('outcome', 'won'),
  ])

  const centsPerMonth = Array.from({ length: 12 }, () => 0)

  for (const t of (times ?? []) as { setter_id: string; started_at: string; ended_at: string | null }[]) {
    const rate = rateById.get(t.setter_id)
    if (!rate) continue
    // Per maand knippen: een blok dat over de maandgrens loopt hoort niet
    // volledig in één maand terecht te komen.
    for (let mi = 0; mi < 12; mi++) {
      const mStart = new Date(year, mi, 1).getTime()
      const mEnd = new Date(year, mi + 1, 1).getTime()
      const s = Math.max(new Date(t.started_at).getTime(), mStart)
      const e = Math.min(t.ended_at ? new Date(t.ended_at).getTime() : now, mEnd)
      if (e > s) centsPerMonth[mi] += earnedCents(Math.floor((e - s) / 1000), rate)
    }
  }

  for (const a of (appts ?? []) as {
    outcome: string | null; commission_cents: number | null
    outcome_at: string | null; starts_at: string; status: string
  }[]) {
    if (a.status === 'cancelled' || !a.commission_cents) continue
    // De commissie valt in de maand waarin de deal is afgesloten; is dat niet
    // bekend, dan in de maand van de afspraak.
    const when = new Date(a.outcome_at ?? a.starts_at)
    if (when.getFullYear() !== year) continue
    centsPerMonth[when.getMonth()] += a.commission_cents
  }

  return centsPerMonth.map((c) => c / 100)
}

// Statistieken uit Metricool voor de klantapp — pure regels (client-safe,
// getest in tests/metricool-stats.test.ts).
//
// De sync (lib/metricool-stats-server.ts) haalt per merk en per netwerk een
// paar dagreeksen op (volgers, bereik, weergaven, interacties, posts) en de
// recente posts met hun cijfers, en bewaart ze in onze databank. De klantapp
// leest enkel uit de databank: snel, en Metricool hoeft niet bereikbaar te zijn.

export type Netwerk = 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'pinterest' | 'youtube' | 'twitter'
export const NETWERKEN: { key: Netwerk; label: string }[] = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'pinterest', label: 'Pinterest' },
  { key: 'twitter', label: 'X' },
]
export const netwerkLabel = (n: string) => NETWERKEN.find((x) => x.key === n)?.label ?? n
export const isNetwerk = (v: unknown): v is Netwerk => NETWERKEN.some((x) => x.key === v)

export type Kpi = 'volgers' | 'nieuwe_volgers' | 'bereik' | 'weergaven' | 'interacties' | 'posts'
/** `stand` = een stand op een dag (de laatste telt); `som` = optellen over de periode. */
export const KPIS: { key: Kpi; label: string; soort: 'stand' | 'som'; uitleg: string }[] = [
  { key: 'volgers', label: 'Volgers', soort: 'stand', uitleg: 'Aantal volgers op het einde van de periode.' },
  { key: 'nieuwe_volgers', label: 'Nieuwe volgers', soort: 'som', uitleg: 'Volgers bij min volgers weg in de periode.' },
  { key: 'bereik', label: 'Bereik', soort: 'som', uitleg: 'Hoeveel mensen je content zagen (per dag opgeteld).' },
  { key: 'weergaven', label: 'Weergaven', soort: 'som', uitleg: 'Hoe vaak je content getoond werd.' },
  { key: 'interacties', label: 'Interacties', soort: 'som', uitleg: 'Likes, reacties, opslaan en delen samen.' },
  { key: 'posts', label: 'Posts', soort: 'som', uitleg: 'Aantal berichten en reels dat online kwam.' },
]
export const kpiInfo = (k: Kpi) => KPIS.find((x) => x.key === k)!

/**
 * Waar een cijfer bij Metricool vandaan komt: /v2/analytics/timelines met dit
 * netwerk, deze metric en (soms) een subject. Per cijfer staan er soms twee
 * kandidaten: de eerste die een reeks met waarden geeft, wint en wordt
 * onthouden (metricool_sync.bronnen), zodat de volgende keren enkel die
 * gevraagd wordt.
 */
export type Bron = { metric: string; subject?: string; scope?: string }
export const BRONNEN: Record<Netwerk, Partial<Record<Kpi, Bron[]>>> = {
  instagram: {
    volgers: [{ metric: 'followers', subject: 'account' }, { metric: 'followers_count', subject: 'account' }],
    nieuwe_volgers: [{ metric: 'delta_followers', subject: 'account' }],
    bereik: [{ metric: 'reach', subject: 'account' }, { metric: 'reach', subject: 'posts' }],
    weergaven: [{ metric: 'views', subject: 'account' }, { metric: 'impressions', subject: 'posts' }],
    interacties: [{ metric: 'postsInteractions', subject: 'account' }, { metric: 'interactions', subject: 'posts' }],
    posts: [{ metric: 'postsCount', subject: 'account' }, { metric: 'count', subject: 'posts' }],
  },
  facebook: {
    volgers: [{ metric: 'pageFollows', subject: 'account' }, { metric: 'likes', subject: 'account' }],
    nieuwe_volgers: [{ metric: 'page_daily_follows_unique', subject: 'account' }],
    bereik: [{ metric: 'impressionsunique', subject: 'posts' }],
    weergaven: [{ metric: 'pageImpressions', subject: 'account' }, { metric: 'impressions', subject: 'posts' }],
    interacties: [{ metric: 'postsInteractions', subject: 'account' }, { metric: 'interactions', subject: 'posts' }],
    posts: [{ metric: 'postsCount', subject: 'account' }, { metric: 'count', subject: 'posts' }],
  },
  linkedin: {
    volgers: [{ metric: 'followers', subject: 'account' }],
    nieuwe_volgers: [{ metric: 'deltaFollowers', subject: 'account' }],
    weergaven: [{ metric: 'impressionCount', subject: 'account' }, { metric: 'impressions', subject: 'posts' }],
    interacties: [{ metric: 'interactions', subject: 'posts' }],
    posts: [{ metric: 'postsCount', subject: 'account' }, { metric: 'posts', subject: 'posts' }],
  },
  tiktok: {
    volgers: [{ metric: 'followers_count', subject: 'account' }],
    nieuwe_volgers: [{ metric: 'followers_delta_count', subject: 'account' }],
    bereik: [{ metric: 'reach', subject: 'videos' }],
    weergaven: [{ metric: 'video_views', subject: 'account' }, { metric: 'views', subject: 'videos' }],
    interacties: [{ metric: 'interactions', subject: 'videos' }],
    posts: [{ metric: 'videos', subject: 'videos' }],
  },
  pinterest: {
    volgers: [{ metric: 'followers', subject: 'account' }],
    weergaven: [{ metric: 'impression' }],
    posts: [{ metric: 'pins' }],
  },
  youtube: {
    weergaven: [{ metric: 'views', scope: 'viewed' }],
    interacties: [{ metric: 'interactions', scope: 'viewed' }],
  },
  twitter: {
    volgers: [{ metric: 'followers', subject: 'account' }],
    posts: [{ metric: 'postsCount', subject: 'account' }],
  },
}
export const bronSleutel = (b: Bron) => [b.metric, b.subject ?? '', b.scope ?? ''].join('|')

export type Punt = { datum: string; waarde: number }
const DAG = /^\d{4}-\d{2}-\d{2}$/

/**
 * Een antwoord van /v2/analytics/timelines lezen: { data: [{ metric, values:
 * [{ dateTime, value }] }] }. Ook een kale lijst wordt aanvaard. Per dag één
 * waarde (dubbele dagen: de laatste); onzin valt weg.
 */
export function reeksUit(raw: unknown): Punt[] {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { data?: unknown }
  const series = Array.isArray(o.data) ? o.data : Array.isArray(raw) ? raw : []
  const eerste = series.find((s) => s && typeof s === 'object' && Array.isArray((s as { values?: unknown }).values)) as { values: unknown[] } | undefined
  const waarden = eerste ? eerste.values : series
  const per = new Map<string, number>()
  for (const v of waarden) {
    if (!v || typeof v !== 'object') continue
    const r = v as { dateTime?: unknown; date?: unknown; value?: unknown }
    const datum = String(r.dateTime ?? r.date ?? '').slice(0, 10)
    const waarde = typeof r.value === 'number' ? r.value : r.value === null || r.value === undefined || r.value === '' ? NaN : Number(r.value)
    if (!DAG.test(datum) || !Number.isFinite(waarde)) continue
    per.set(datum, waarde)
  }
  return Array.from(per.entries()).map(([datum, waarde]) => ({ datum, waarde })).sort((a, b) => a.datum.localeCompare(b.datum))
}

// ── Periodes ────────────────────────────────────────────────────────────────

export type PeriodeSoort = '30d' | 'maand' | '90d'
export const PERIODES: { key: PeriodeSoort; label: string }[] = [
  { key: '30d', label: 'Laatste 30 dagen' },
  { key: 'maand', label: 'Vorige maand' },
  { key: '90d', label: 'Laatste 90 dagen' },
]
export type Periode = { soort: PeriodeSoort; van: string; tot: string; vorigeVan: string; vorigeTot: string; label: string }

const plusDagen = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10)
}
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

/**
 * De gekozen periode en de periode ervoor (even lang), voor de vergelijking.
 * "Laatste 30 dagen" eindigt gisteren: vandaag is nog niet volledig.
 */
export function periodeVan(soort: PeriodeSoort, vandaag: string): Periode {
  if (soort === 'maand') {
    const [j, m] = [Number(vandaag.slice(0, 4)), Number(vandaag.slice(5, 7))]
    const vj = m === 1 ? j - 1 : j, vm = m === 1 ? 12 : m - 1
    const van = `${vj}-${String(vm).padStart(2, '0')}-01`
    const tot = plusDagen(`${j}-${String(m).padStart(2, '0')}-01`, -1)
    const pj = vm === 1 ? vj - 1 : vj, pm = vm === 1 ? 12 : vm - 1
    const vorigeVan = `${pj}-${String(pm).padStart(2, '0')}-01`
    return { soort, van, tot, vorigeVan, vorigeTot: plusDagen(van, -1), label: `${MAANDEN[vm - 1]} ${vj}` }
  }
  const dagen = soort === '90d' ? 90 : 30
  const tot = plusDagen(vandaag, -1)
  const van = plusDagen(tot, -(dagen - 1))
  return { soort, van, tot, vorigeVan: plusDagen(van, -dagen), vorigeTot: plusDagen(van, -1), label: `laatste ${dagen} dagen` }
}

// ── Samenvatting ────────────────────────────────────────────────────────────

export type Rij = { netwerk: string; kpi: string; datum: string; waarde: number }
export type KpiCijfer = {
  kpi: Kpi
  waarde: number | null
  vorige: number | null
  /** Verschil in procent tegenover de vorige periode (null als er niets te vergelijken valt). */
  procent: number | null
  /** Enkel bij volgers: hoeveel er bij kwamen in de periode (eind − begin). */
  groei?: number | null
}

/** Laatste gekende stand op of vóór een dag (per netwerk), opgeteld over de netwerken. */
function standOp(rijen: Rij[], tot: string, van?: string): number | null {
  const per = new Map<string, Punt>()
  for (const r of rijen) {
    if (r.datum > tot || (van && r.datum < van)) continue
    const al = per.get(r.netwerk)
    if (!al || r.datum > al.datum) per.set(r.netwerk, { datum: r.datum, waarde: r.waarde })
  }
  if (!per.size) return null
  return Array.from(per.values()).reduce((s, p) => s + p.waarde, 0)
}
function somTussen(rijen: Rij[], van: string, tot: string): number | null {
  const binnen = rijen.filter((r) => r.datum >= van && r.datum <= tot)
  return binnen.length ? binnen.reduce((s, r) => s + r.waarde, 0) : null
}
const procentVan = (nu: number | null, vorige: number | null) =>
  nu === null || vorige === null || vorige === 0 ? null : Math.round(((nu - vorige) / Math.abs(vorige)) * 1000) / 10

/** De cijfers van één periode voor één netwerk (of alle samen), met de vorige periode ernaast. */
export function samenvatting(rijen: Rij[], p: Periode, netwerk: Netwerk | 'alle'): KpiCijfer[] {
  const eigen = netwerk === 'alle' ? rijen : rijen.filter((r) => r.netwerk === netwerk)
  return KPIS.map(({ key, soort }) => {
    const r = eigen.filter((x) => x.kpi === key)
    if (!r.length) return { kpi: key, waarde: null, vorige: null, procent: null }
    if (soort === 'stand') {
      // Enkel netwerken die in de periode een stand hebben, anders telt een verouderd getal mee.
      const waarde = standOp(r, p.tot, p.van)
      const begin = standOp(r, plusDagen(p.van, -1)) ?? standOp(r.filter((x) => x.datum >= p.van), p.van)
      const vorige = standOp(r, p.vorigeTot, p.vorigeVan)
      return { kpi: key, waarde, vorige, procent: procentVan(waarde, vorige), groei: waarde !== null && begin !== null ? waarde - begin : null }
    }
    const waarde = somTussen(r, p.van, p.tot)
    const vorige = somTussen(r, p.vorigeVan, p.vorigeTot)
    return { kpi: key, waarde, vorige, procent: procentVan(waarde, vorige) }
  })
}

/** Dag per dag voor de grafiek (stand: laatst gekende per netwerk, opgeteld; som: optellen per dag). */
export function grafiekReeks(rijen: Rij[], p: Periode, netwerk: Netwerk | 'alle', kpi: Kpi): Punt[] {
  const r = (netwerk === 'alle' ? rijen : rijen.filter((x) => x.netwerk === netwerk)).filter((x) => x.kpi === kpi)
  if (!r.length) return []
  const uit: Punt[] = []
  const stand = kpiInfo(kpi).soort === 'stand'
  for (let d = p.van; d <= p.tot; d = plusDagen(d, 1)) {
    if (stand) {
      const w = standOp(r, d)
      if (w !== null) uit.push({ datum: d, waarde: w })
    } else {
      uit.push({ datum: d, waarde: r.filter((x) => x.datum === d).reduce((s, x) => s + x.waarde, 0) })
    }
  }
  return uit
}

/** Welke netwerken hebben in deze rijen enig cijfer (in de volgorde van NETWERKEN)? */
export const netwerkenMetData = (rijen: Pick<Rij, 'netwerk'>[]): Netwerk[] =>
  NETWERKEN.map((n) => n.key).filter((k) => rijen.some((r) => r.netwerk === k))

// ── Posts ───────────────────────────────────────────────────────────────────

export type PostCijfers = { interacties: number | null; bereik: number | null; weergaven: number | null; likes: number | null; reacties: number | null; delen: number | null; opgeslagen: number | null }
export type StatPost = { netwerk: string; post_id: string; gepubliceerd_op: string | null; soort: string | null; tekst: string | null; link: string | null; beeld: string | null; metrics: Record<string, unknown> }

const getal = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(x) ? x : null
}
/** Het eerste veld dat een getal is, ongeacht hoofdletters (Metricool gebruikt per netwerk andere namen). */
function veld(m: Record<string, unknown>, ...namen: string[]): number | null {
  const lager = new Map(Object.entries(m).map(([k, v]) => [k.toLowerCase(), v]))
  for (const n of namen) {
    const v = getal(lager.get(n.toLowerCase()))
    if (v !== null) return v
  }
  return null
}

/** De cijfers van één post, uit de velden die Metricool per netwerk geeft. */
export function postCijfers(m: Record<string, unknown>): PostCijfers {
  const likes = veld(m, 'likes', 'like', 'reactions', 'likeCount', 'reaction', 'favorites')
  const reacties = veld(m, 'comments', 'comment', 'commentCount', 'replies')
  const delen = veld(m, 'shares', 'share', 'shareCount', 'reshare', 'retweets', 'reposts')
  const opgeslagen = veld(m, 'saved', 'saves')
  const som = [likes, reacties, delen, opgeslagen].filter((x): x is number => x !== null)
  return {
    interacties: veld(m, 'interactions', 'totalInteractions', 'engagements') ?? (som.length ? som.reduce((s, x) => s + x, 0) : null),
    bereik: veld(m, 'reach', 'impressionsUnique', 'impressionsunique', 'uniqueImpressions'),
    weergaven: veld(m, 'views', 'impressions', 'impressionsTotal', 'impressionCount', 'videoViews', 'plays', 'impression'),
    likes, reacties, delen, opgeslagen,
  }
}

/** De beste posts in de periode: meeste interacties, dan bereik. */
export function bestePosts(posts: StatPost[], p: Pick<Periode, 'van' | 'tot'>, netwerk: Netwerk | 'alle', n = 6): (StatPost & { cijfers: PostCijfers })[] {
  return posts
    .filter((x) => (netwerk === 'alle' || x.netwerk === netwerk) && x.gepubliceerd_op && x.gepubliceerd_op.slice(0, 10) >= p.van && x.gepubliceerd_op.slice(0, 10) <= p.tot)
    .map((x) => ({ ...x, cijfers: postCijfers(x.metrics) }))
    .sort((a, b) => (b.cijfers.interacties ?? -1) - (a.cijfers.interacties ?? -1) || (b.cijfers.bereik ?? -1) - (a.cijfers.bereik ?? -1))
    .slice(0, n)
}

/** Een getal kort: 1.234 / 12,3K / 1,2M. */
export function kortGetal(n: number | null): string {
  if (n === null) return '—'
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString('nl-BE', { maximumFractionDigits: 1 })}M`
  if (a >= 10_000) return `${(n / 1000).toLocaleString('nl-BE', { maximumFractionDigits: 1 })}K`
  return Math.round(n).toLocaleString('nl-BE')
}

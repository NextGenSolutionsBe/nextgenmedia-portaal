import { fetchMetLimiet } from '@/lib/fetch-met-limiet'

// ── Metricool integratie (server-side only) ──────────────────────────────────
// READ-ONLY. App → Metricool, nooit terug. Uitsluitend server-side; de sleutels
// komen enkel uit process.env (METRICOOL_USER_TOKEN + METRICOOL_USER_ID) en mogen
// nooit in clientcode lekken. Plannen/goedkeuren gebeurt volledig in Metricool zelf.
//
// Auth: header 'X-Mc-Auth: <token>'. Elke call vereist userId (+ meestal blogId).
// Rate limits publiceert Metricool niet → we throttlen (~1 req/s) en cachen.

const API_BASE = 'https://app.metricool.com/api'

export function metricoolConfigured(): boolean {
  return !!process.env.METRICOOL_USER_TOKEN && !!process.env.METRICOOL_USER_ID
}

function creds(): { token: string; userId: string } {
  const token = process.env.METRICOOL_USER_TOKEN
  const userId = process.env.METRICOOL_USER_ID
  if (!token || !userId) throw new Error('METRICOOL_USER_TOKEN / METRICOOL_USER_ID niet ingesteld')
  return { token, userId }
}

// ── Throttled fetch (~1 req/s, aanbevolen) met lichte backoff bij 429 ─────────
let lastRequestAt = 0
const MIN_INTERVAL_MS = 1100
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Voegt userId + query toe, zet X-Mc-Auth, en geeft de ruwe Response terug. */
async function mcFetch(path: string, query: Record<string, string | number | undefined> = {}, attempt = 0): Promise<Response> {
  const { token, userId } = creds()
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()

  const url = new URL(`${API_BASE}${path}`)
  url.searchParams.set('userId', userId)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }

  const res = await fetchMetLimiet(url.toString(), {
    headers: { 'X-Mc-Auth': token, 'Content-Type': 'application/json' },
    cache: 'no-store',
  })
  if (res.status === 429 && attempt < 4) {
    await sleep(Math.min(2 ** attempt * 1000, 8000))
    return mcFetch(path, query, attempt + 1)
  }
  return res
}

async function mcJson<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const res = await mcFetch(path, query)
  const text = await res.text()
  if (!res.ok) throw new Error(`Metricool GET ${path} → ${res.status}: ${text.slice(0, 200)}`)
  return text ? (JSON.parse(text) as T) : ({} as T)
}

// ── Merken (brands / blogs) ───────────────────────────────────────────────────

export type MetricoolBrand = { blogId: string; name: string; picture?: string | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeBrand(raw: any): MetricoolBrand | null {
  const blogId = raw?.id ?? raw?.blogId ?? raw?.blog_id
  if (blogId == null) return null
  return {
    blogId: String(blogId),
    name: String(raw?.label ?? raw?.name ?? raw?.title ?? `Merk ${blogId}`),
    picture: raw?.picture ?? raw?.pictureUrl ?? raw?.avatar ?? null,
  }
}

/** Alle merken van het Metricool-account (voor de klant-koppeling). */
export async function listBrands(): Promise<MetricoolBrand[]> {
  // Meerdere kandidaat-endpoints; de eerste die een lijst geeft wint.
  const candidates = ['/admin/simpleProfiles', '/admin/profiles', '/admin/profiles-auth']
  for (const path of candidates) {
    try {
      const data = await mcJson<unknown>(path)
      const arr = Array.isArray(data) ? data : (data as { data?: unknown[] })?.data
      if (Array.isArray(arr)) {
        const out = arr.map(normalizeBrand).filter((b): b is MetricoolBrand => !!b)
        if (out.length > 0) return out
      }
    } catch { /* volgende kandidaat proberen */ }
  }
  return []
}

// ── Geplande posts ────────────────────────────────────────────────────────────

export type MetricoolMedia = { type: 'image' | 'video' | 'other'; url: string; thumbnail?: string | null }
export type MetricoolPost = {
  id: string
  blogId: string
  datetime: string | null   // ISO 8601 (met tijd)
  networks: string[]        // instagram, facebook, tiktok, linkedin, …
  text: string
  status: string            // scheduled | published | draft | error | …
  media: MetricoolMedia[]
  permalink?: string | null
}

const MEDIA_VIDEO = /\.(mp4|mov|m4v|webm|avi)(\?|$)/i
const MEDIA_IMAGE = /\.(jpg|jpeg|png|gif|webp|heic)(\?|$)/i
function mediaType(url: string): MetricoolMedia['type'] {
  if (MEDIA_VIDEO.test(url)) return 'video'
  if (MEDIA_IMAGE.test(url)) return 'image'
  return 'other'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickMedia(raw: any): MetricoolMedia[] {
  const out: MetricoolMedia[] = []
  const push = (u: unknown, thumb?: unknown) => {
    if (typeof u === 'string' && u) out.push({ type: mediaType(u), url: u, thumbnail: typeof thumb === 'string' ? thumb : null })
  }
  // Diverse mogelijke vormen tolerant afhandelen (bevestigd via diagnose-endpoint).
  const candidates = [raw?.media, raw?.medias, raw?.images, raw?.pictures, raw?.attachments, raw?.imageUrls, raw?.videoUrls]
  for (const c of candidates) {
    if (typeof c === 'string') push(c)
    else if (Array.isArray(c)) {
      for (const m of c) {
        if (typeof m === 'string') push(m)
        else if (m && typeof m === 'object') push(m.url ?? m.src ?? m.link ?? m.mediaUrl, m.thumbnail ?? m.thumbnailUrl ?? m.preview)
      }
    }
  }
  // Enkelvoudige beeld-velden (o.a. Facebook stats: picture/fullPicture).
  for (const s of [raw?.fullPicture, raw?.picture, raw?.image, raw?.thumbnail, raw?.thumbnailUrl]) push(s)
  // Video's: gebruik de aparte thumbnail (poster) indien aanwezig.
  const thumb = typeof raw?.videoThumbnailUrl === 'string' ? raw.videoThumbnailUrl : null
  if (thumb) for (const m of out) if (m.type === 'video' && !m.thumbnail) m.thumbnail = thumb
  // Dedup op url
  const seen = new Set<string>()
  return out.filter((m) => (seen.has(m.url) ? false : (seen.add(m.url), true)))
}

// Metricool geeft de tijd als naïeve wall-clock in publicationDate.timezone
// (meestal Europe/Brussels). We bewaren die string ONGEWIJZIGD — géén UTC-
// conversie — zodat 15:00 ook echt 15:00 blijft. UI + mail behandelen 'm als
// Brusselse tijd (de kijkers zitten in België).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickDatetime(raw: any): string | null {
  const pd = raw?.publicationDate
  const d = (pd && typeof pd === 'object' ? pd.dateTime : pd) ?? raw?.date ?? raw?.datetime ?? raw?.scheduledDate ?? raw?.publishDate
  if (!d) return null
  return String(d).slice(0, 19)   // "YYYY-MM-DDTHH:mm:ss" (naïef)
}

/** Status afleiden: draft-vlag + providers[].status (geen top-level status-veld). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickStatus(raw: any): string {
  if (raw?.draft === true) return 'draft'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provs: any[] = Array.isArray(raw?.providers) ? raw.providers : []
  const statuses = provs.map((p) => String(p?.status ?? '').toUpperCase()).filter(Boolean)
  if (statuses.length) {
    if (statuses.every((s) => ['PUBLISHED', 'OK', 'DONE', 'SENT'].includes(s))) return 'published'
    if (statuses.some((s) => ['ERROR', 'FAILED', 'REJECTED'].includes(s))) return 'error'
    return 'scheduled'
  }
  const top = String(raw?.status ?? raw?.state ?? '').toLowerCase()
  return top || (raw?.published ? 'published' : 'scheduled')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickNetworks(raw: any): string[] {
  const src = raw?.providers ?? raw?.networks ?? raw?.channels ?? raw?.socialNetworks ?? raw?.provider ?? raw?.network
  const out: string[] = []
  const add = (v: unknown) => {
    if (typeof v === 'string' && v) out.push(v.toLowerCase())
    else if (v && typeof v === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = (v as any).network ?? (v as any).name ?? (v as any).provider
      if (typeof n === 'string') out.push(n.toLowerCase())
    }
  }
  if (Array.isArray(src)) src.forEach(add)
  else add(src)
  return Array.from(new Set(out))
}

/** Ruwe Metricool-post → genormaliseerd. Tolerant voor veldnaam-varianten. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizePost(raw: any, blogId: string): MetricoolPost {
  return {
    id: String(raw?.id ?? raw?.uuid ?? raw?.postId ?? crypto.randomUUID()),
    blogId,
    datetime: pickDatetime(raw),
    networks: pickNetworks(raw),
    text: String(raw?.text ?? raw?.content ?? raw?.caption ?? raw?.message ?? '').trim(),
    status: pickStatus(raw),
    media: pickMedia(raw),
    permalink: raw?.permalink ?? raw?.link ?? raw?.url ?? null,
  }
}

/** Kandidaat-endpoints voor geplande posts (eerste die een lijst geeft wint). */
function postCandidates(blogId: string, start: string, end: string): Array<{ path: string; query: Record<string, string> }> {
  const q = { blogId, start, end, timezone: 'Europe/Brussels' }
  // Bevestigd via /diag: enkel /v2/scheduler/posts werkt (de rest gaf 404).
  return [{ path: '/v2/scheduler/posts', query: q }]
}

/** yyyy-MM-dd → volledige dag; Metricool verwacht meestal 'yyyy-MM-ddTHH:mm:ss'. */
function dayStart(d: string) { return `${d.slice(0, 10)}T00:00:00` }
function dayEnd(d: string) { return `${d.slice(0, 10)}T23:59:59` }

/** Geplande posts voor één merk binnen een datumbereik (genormaliseerd). */
export async function listScheduledPosts(blogId: string, startDate: string, endDate: string): Promise<MetricoolPost[]> {
  const start = dayStart(startDate)
  const end = dayEnd(endDate)
  for (const c of postCandidates(blogId, start, end)) {
    try {
      const data = await mcJson<unknown>(c.path, c.query)
      const arr = Array.isArray(data) ? data : (data as { data?: unknown[] })?.data
      if (Array.isArray(arr)) return arr.map((r) => normalizePost(r, blogId))
    } catch { /* volgende kandidaat */ }
  }
  return []
}

/** Diagnose: probeer de kandidaat-endpoints en geef de ruwe respons terug,
 *  zodat we de exacte veldnamen kunnen bevestigen zonder gokwerk. */
export async function diagnoseScheduledPosts(blogId: string, startDate: string, endDate: string) {
  const start = dayStart(startDate)
  const end = dayEnd(endDate)
  const attempts: Array<{ path: string; ok: boolean; status?: number; sample?: unknown; error?: string }> = []
  for (const c of postCandidates(blogId, start, end)) {
    try {
      const res = await mcFetch(c.path, c.query)
      const text = await res.text()
      let parsed: unknown = null
      try { parsed = text ? JSON.parse(text) : null } catch { parsed = text.slice(0, 500) }
      const arr = Array.isArray(parsed) ? parsed : (parsed as { data?: unknown[] })?.data
      attempts.push({ path: c.path, ok: res.ok, status: res.status, sample: Array.isArray(arr) ? arr.slice(0, 2) : parsed })
    } catch (e) {
      attempts.push({ path: c.path, ok: false, error: e instanceof Error ? e.message : 'fout' })
    }
  }
  return attempts
}

// ── Statistieken (analytics) — ADMIN-ONLY ─────────────────────────────────────
// Gepubliceerde posts + hun performance-cijfers per netwerk/formaat. Read-only.
// Metric-veldnamen verschillen per netwerk → tolerante extractie (bevestigen via
// de analytics-diagnose). Nooit in het klantportaal tonen.

export type PostStat = {
  id: string
  network: string
  type: string             // post | reel | story | video | tweet
  datetime: string | null  // naïeve Brusselse wall-clock
  text: string
  media: MetricoolMedia[]
  metrics: Record<string, number>   // likes, comments, shares, saved, views, reach, impressions, engagement, interactions
  permalink?: string | null
}

type StatSource = { network: string; type: string; path: string }
const STAT_SOURCES: StatSource[] = [
  { network: 'instagram', type: 'reel',  path: '/stats/instagram/reels' },
  { network: 'instagram', type: 'post',  path: '/stats/instagram/posts' },
  { network: 'instagram', type: 'story', path: '/stats/instagram/stories' },
  { network: 'facebook',  type: 'post',  path: '/stats/facebook/posts' },
  { network: 'linkedin',  type: 'post',  path: '/stats/linkedin/posts' },
  { network: 'twitter',   type: 'post',  path: '/stats/twitter/posts' },
  { network: 'youtube',   type: 'video', path: '/stats/youtube/videos' },
]

// Bevestigd via /diag op echte Facebook-data: likes=reactions, views=videoViews,
// reach=impressionsUnique, plus impressions/clicks. Let op: Metricool's veld
// `engagement` is een PERCENTAGE (rate), geen telling → bewust NIET als count
// mappen (we berekenen engagement uit interacties in engagementOf).
const METRIC_FIELDS: Record<string, string[]> = {
  likes:        ['likes', 'likeCount', 'like', 'favorites', 'favoriteCount', 'reactions', 'reactionsCount', 'totalReactions'],
  comments:     ['comments', 'commentCount', 'comment', 'commentsCount', 'replies', 'replyCount'],
  shares:       ['shares', 'shareCount', 'share', 'sharesCount', 'retweets', 'retweetCount', 'reposts', 'repostCount'],
  saved:        ['saved', 'saves', 'saveCount', 'bookmarks', 'bookmarkCount'],
  views:        ['views', 'videoViews', 'viewCount', 'plays', 'playCount', 'reproductions', 'videoViewCount', 'impressionsVideo', 'totalMediaViewUnique'],
  reach:        ['reach', 'reachCount', 'uniqueReach', 'accountsReached', 'reachedAccounts', 'impressionsUnique', 'impressionsUniqueOrganic'],
  impressions:  ['impressions', 'impressionCount', 'impressionsCount', 'impressionsOrganic'],
  clicks:       ['clicks', 'linkClicks', 'linkclicks', 'postClicks'],
  interactions: ['interactions', 'totalInteractions', 'interactionCount'],
  engagementRate: ['engagementRate', 'engagement'],   // percentage — enkel ter info, niet als telling
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMetrics(raw: any): Record<string, number> {
  const containers = [raw, raw?.metrics, raw?.stats, raw?.data, raw?.insights, raw?.values].filter(Boolean)
  const out: Record<string, number> = {}
  for (const [key, names] of Object.entries(METRIC_FIELDS)) {
    let done = false
    for (const c of containers) {
      for (const n of names) {
        const v = num(c?.[n])
        if (v != null) { out[key] = v; done = true; break }
      }
      if (done) break
    }
  }
  return out
}

// Stats-posts geven de tijd als unix-timestamp (ms of s), bv. created/timestamp.
// Omzetten naar naïeve Brusselse wall-clock string zodat de heatmap + weergave kloppen.
function toMs(n: number): number { return n < 1e12 ? n * 1000 : n }
function epochToBrussels(ms: number): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(ms))
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  const h = g('hour') === '24' ? '00' : g('hour')
  return `${g('year')}-${g('month')}-${g('day')}T${h}:${g('minute')}:${g('second')}`
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickStatDatetime(raw: any): string | null {
  const t = raw?.timestamp ?? raw?.created ?? raw?.publishedAt ?? raw?.publishDate ?? raw?.date
  if (typeof t === 'number' && isFinite(t)) return epochToBrussels(toMs(t))
  if (typeof t === 'string' && /^\d{10,}$/.test(t.trim())) return epochToBrussels(toMs(Number(t)))
  return pickDatetime(raw)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeStat(raw: any, network: string, type: string): PostStat {
  return {
    id: String(raw?.id ?? raw?.uuid ?? raw?.postId ?? crypto.randomUUID()),
    network,
    type,
    datetime: pickStatDatetime(raw),
    text: String(raw?.text ?? raw?.content ?? raw?.caption ?? raw?.message ?? raw?.title ?? '').trim(),
    media: pickMedia(raw),
    metrics: extractMetrics(raw),
    permalink: raw?.permalink ?? raw?.link ?? raw?.url ?? raw?.postUrl ?? null,
  }
}

// De /stats/*-endpoints verwachten datums als yyyyMMdd (géén streepjes/tijd) —
// bevestigd via /diag ("could not be parsed at index 4"). Afwijkend van de
// v2/scheduler-endpoints die net ISO met tijd willen.
function statDate(d: string): string { return d.slice(0, 10).replace(/-/g, '') }

async function fetchStatSource(blogId: string, src: StatSource, start: string, end: string): Promise<PostStat[]> {
  const q = { blogId, start: statDate(start), end: statDate(end), timezone: 'Europe/Brussels' }
  try {
    const data = await mcJson<unknown>(src.path, q)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = Array.isArray(data) ? data : (data as any)?.data ?? (data as any)?.posts ?? (data as any)?.results
    if (Array.isArray(arr)) return arr.map((r) => normalizeStat(r, src.network, src.type))
  } catch { /* endpoint niet beschikbaar voor dit merk/netwerk */ }
  return []
}

/** Alle gepubliceerde posts + metrics voor één merk binnen een bereik. */
export async function fetchAllPostStats(blogId: string, start: string, end: string): Promise<PostStat[]> {
  const out: PostStat[] = []
  for (const src of STAT_SOURCES) out.push(...await fetchStatSource(blogId, src, start, end))
  return out
}

/** Engagement per post: som van interacties (fallback op engagement/interactions-veld). */
export function engagementOf(p: PostStat): number {
  const m = p.metrics
  const sum = (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saved ?? 0)
  return sum > 0 ? sum : (m.engagement ?? m.interactions ?? 0)
}

export type MetricTotals = Record<string, number>
export type FormatSummary = { key: string; network: string; type: string; count: number; totals: MetricTotals; avg: MetricTotals }
export type StatsSummary = {
  totalPosts: number
  overall: MetricTotals
  byType: FormatSummary[]
  byNetworkType: FormatSummary[]
  heatmap: number[][]        // 7 (ma..zo) x 24 — gemiddelde engagement
  heatmapCount: number[][]
}

function addTotals(t: MetricTotals, m: MetricTotals) { for (const [k, v] of Object.entries(m)) t[k] = (t[k] ?? 0) + v }

/** Aggregeert posts tot per-formaat/per-netwerk cijfers + een dag×uur heatmap. */
export function summarizeStats(posts: PostStat[]): StatsSummary {
  const overall: MetricTotals = {}
  const groupsType = new Map<string, PostStat[]>()
  const groupsNT = new Map<string, PostStat[]>()
  const heatSum = Array.from({ length: 7 }, () => new Array(24).fill(0))
  const heatCnt = Array.from({ length: 7 }, () => new Array(24).fill(0))

  for (const p of posts) {
    addTotals(overall, p.metrics)
    if (!groupsType.has(p.type)) groupsType.set(p.type, [])
    groupsType.get(p.type)!.push(p)
    const ntk = `${p.network}:${p.type}`
    if (!groupsNT.has(ntk)) groupsNT.set(ntk, [])
    groupsNT.get(ntk)!.push(p)
    if (p.datetime) {
      const [y, mo, d] = p.datetime.slice(0, 10).split('-').map(Number)
      const hh = Number(p.datetime.slice(11, 13))
      if (y && mo && d && !isNaN(hh)) {
        const wd = (new Date(y, mo - 1, d).getDay() + 6) % 7  // 0 = maandag
        heatSum[wd][hh] += engagementOf(p)
        heatCnt[wd][hh] += 1
      }
    }
  }

  const toSummary = (map: Map<string, PostStat[]>): FormatSummary[] =>
    [...map.entries()].map(([key, ps]) => {
      const totals: MetricTotals = {}
      for (const p of ps) addTotals(totals, p.metrics)
      const avg: MetricTotals = {}
      for (const [k, v] of Object.entries(totals)) avg[k] = v / ps.length
      const [network, type] = key.includes(':') ? key.split(':') : ['', key]
      return { key, network, type, count: ps.length, totals, avg }
    }).sort((a, b) => b.count - a.count)

  const heatmap = heatSum.map((row, i) => row.map((s, h) => (heatCnt[i][h] ? s / heatCnt[i][h] : 0)))
  return { totalPosts: posts.length, overall, byType: toSummary(groupsType), byNetworkType: toSummary(groupsNT), heatmap, heatmapCount: heatCnt }
}

/** Diagnose voor analytics: ruwe respons per stats-endpoint (veldnamen bevestigen). */
export async function diagnoseAnalytics(blogId: string, start: string, end: string) {
  const q = { blogId, start: statDate(start), end: statDate(end), timezone: 'Europe/Brussels' }
  const paths = [...STAT_SOURCES.map((s) => s.path), '/stats/posts', '/stats/besttimes/global', '/stats/besttimes/instagram']
  const attempts: Array<{ path: string; ok: boolean; status?: number; count?: number; sample?: unknown; error?: string }> = []
  for (const path of paths) {
    try {
      const res = await mcFetch(path, q)
      const text = await res.text()
      let parsed: unknown = null
      try { parsed = text ? JSON.parse(text) : null } catch { parsed = text.slice(0, 300) }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr = Array.isArray(parsed) ? parsed : (parsed as any)?.data
      attempts.push({ path, ok: res.ok, status: res.status, count: Array.isArray(arr) ? arr.length : undefined, sample: Array.isArray(arr) ? arr.slice(0, 1) : parsed })
    } catch (e) {
      attempts.push({ path, ok: false, error: e instanceof Error ? e.message : 'fout' })
    }
  }
  return attempts
}

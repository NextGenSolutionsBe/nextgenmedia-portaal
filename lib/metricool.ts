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

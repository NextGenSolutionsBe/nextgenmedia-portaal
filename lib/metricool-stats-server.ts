import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { brandProfielen, mcVraag, metricoolConfigured } from '@/lib/metricool'
import { BRONNEN, bronSleutel, isNetwerk, reeksUit, type Bron, type Netwerk, type Punt, type Rij, type StatPost } from '@/lib/metricool-stats'

type Admin = ReturnType<typeof createAdminSupabaseClient>

/**
 * De statistieken-sync met Metricool (enkel lezen).
 *
 * Per merk (de klanten met een metricool_blog_id) en per gekoppeld netwerk een
 * paar dagreeksen via /v2/analytics/timelines (volgers, nieuwe volgers, bereik,
 * weergaven, interacties, posts) en de recente posts via
 * /v2/analytics/brand-summary/posts. Alles komt in metricool_statistieken en
 * metricool_posts; de klantapp leest enkel daaruit.
 *
 * De eerste keer 200 dagen terug (zodat er meteen een vorige periode is om mee
 * te vergelijken), daarna de laatste 14 dagen (Metricool vult soms nog aan).
 * Welke metric bij welk cijfer werkt, onthouden we per merk
 * (metricool_sync.bronnen): de volgende keer enkel die vraag. Metricool wil
 * ongeveer één vraag per seconde, dus één merk per ronde (de scheduler komt
 * elke 10 minuten, een merk is na 6 uur weer aan de beurt).
 */

const TZ = 'Europe/Brussels'
const VOLLEDIG_DAGEN = 200
const RECENT_DAGEN = 14
const VERS_UUR = 6
const STANDAARD_NETWERKEN: Netwerk[] = ['instagram', 'facebook', 'linkedin', 'tiktok']

const vandaagBrussel = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const plusDagen = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

/** "2026-11-23" + "00:00:00" → "2026-11-23T00:00:00+01:00" (Belgische tijd, zomer en winter). */
export function isoBrussel(datum: string, tijd: string): string {
  const deel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(new Date(`${datum}T12:00:00Z`)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const off = deel.replace('GMT', '')
  return `${datum}T${tijd}${off || '+00:00'}`
}

/** Welke netwerken hangen aan een merk? Uit het profiel van Metricool (velden als instagram, facebook, linkedinCompany …). */
export function netwerkenUitProfiel(p: Record<string, unknown>): Netwerk[] {
  const uit = new Set<Netwerk>()
  for (const [k, v] of Object.entries(p)) {
    const key = k.toLowerCase()
    if (v === null || v === undefined || v === '' || v === false) continue
    if (/ads|picture|image|avatar|token|expired|url|name/.test(key)) continue
    for (const n of ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'twitter'] as Netwerk[]) {
      if (key.startsWith(n)) uit.add(n)
    }
  }
  return Array.from(uit)
}

let profielCache: { tot: number; per: Map<string, Netwerk[]> } | null = null
async function netwerkenPerMerk(): Promise<Map<string, Netwerk[]>> {
  if (profielCache && profielCache.tot > Date.now()) return profielCache.per
  const per = new Map<string, Netwerk[]>()
  try {
    for (const p of await brandProfielen()) {
      const id = p.id ?? p.blogId
      if (id !== undefined && id !== null) per.set(String(id), netwerkenUitProfiel(p))
    }
  } catch { /* zonder profielen: de standaardnetwerken */ }
  profielCache = { tot: Date.now() + 60 * 60_000, per }
  return per
}

type SyncRij = { blog_id: string; laatst_op: string | null; volledig_op: string | null; bronnen: Record<string, string | null> | null; netwerken: string[] | null; fouten: unknown[] | null; bezig_sinds: string | null }
type Fout = { netwerk?: string; kpi?: string; bron?: string; status?: number; melding: string }
export type SyncUitkomst = { blog_id: string; volledig: boolean; afgebroken: boolean; cijfers: number; posts: number; netwerken: string[]; fouten: Fout[] }

async function bewaarPunten(admin: Admin, blogId: string, netwerk: string, kpi: string, punten: Punt[]): Promise<void> {
  const nu = new Date().toISOString()
  const rijen = punten.map((p) => ({ blog_id: blogId, netwerk, kpi, datum: p.datum, waarde: p.waarde, bijgewerkt_op: nu }))
  for (let i = 0; i < rijen.length; i += 500) {
    const { error } = await admin.from('metricool_statistieken').upsert(rijen.slice(i, i + 500), { onConflict: 'blog_id,netwerk,kpi,datum' })
    if (error) throw new Error(error.message)
  }
}

const NETWERK_ALIAS: Record<string, Netwerk> = { linkedin_company: 'linkedin', linkedincompany: 'linkedin', x: 'twitter', facebookpage: 'facebook' }
const netwerkVan = (v: unknown): Netwerk | null => {
  const s = String(v ?? '').toLowerCase().replace(/[^a-z_]/g, '')
  const n = NETWERK_ALIAS[s] ?? s
  return isNetwerk(n) ? n : null
}
const datumVan = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === 'string') return v
  if (typeof v === 'object') { const d = (v as { dateTime?: unknown }).dateTime; return typeof d === 'string' ? d : null }
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000).toISOString()
  return null
}
const tekstVan = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Posts uit /v2/analytics/brand-summary/posts (alle netwerken), anders Instagram en Facebook apart. */
async function haalPosts(blogId: string, from: string, to: string, fouten: Fout[]): Promise<StatPost[]> {
  const r = await mcVraag('/v2/analytics/brand-summary/posts', { blogId, from, to, timezone: TZ })
  const lijst = (r.json as { data?: unknown })?.data
  if (r.ok && Array.isArray(lijst)) {
    return lijst.flatMap((x): StatPost[] => {
      const p = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      const netwerk = netwerkVan(p.network)
      const id = tekstVan(String(p.id ?? p.contentId ?? ''), 200)
      if (!netwerk || !id) return []
      return [{
        netwerk, post_id: id, gepubliceerd_op: datumVan(p.publicationDate), soort: tekstVan(p.type, 40),
        tekst: tekstVan(p.text, 600), link: tekstVan(p.link, 500), beeld: tekstVan(p.picture, 1000),
        metrics: (p.metrics && typeof p.metrics === 'object' ? p.metrics : {}) as Record<string, unknown>,
      }]
    })
  }
  fouten.push({ bron: 'brand-summary/posts', status: r.status, melding: r.tekst.slice(0, 160) })
  // Terugval: de per-netwerk-lijsten van Instagram en Facebook (gedocumenteerd).
  const uit: StatPost[] = []
  const ig = await mcVraag('/v2/analytics/posts/instagram', { blogId, from, to, timezone: TZ })
  for (const x of (Array.isArray((ig.json as { data?: unknown })?.data) ? (ig.json as { data: Record<string, unknown>[] }).data : [])) {
    const { postId, publishedAt, url, content, imageUrl, ...metrics } = x
    if (!postId) continue
    uit.push({ netwerk: 'instagram', post_id: String(postId), gepubliceerd_op: datumVan(publishedAt), soort: tekstVan(x.type, 40), tekst: tekstVan(content, 600), link: tekstVan(url, 500), beeld: tekstVan(imageUrl, 1000), metrics })
  }
  const fb = await mcVraag('/v2/analytics/posts/facebook', { blogId, from, to, timezone: TZ })
  for (const x of (Array.isArray((fb.json as { data?: unknown })?.data) ? (fb.json as { data: Record<string, unknown>[] }).data : [])) {
    const { postId, created, link, text, picture, ...metrics } = x
    if (!postId) continue
    uit.push({ netwerk: 'facebook', post_id: String(postId), gepubliceerd_op: datumVan(created), soort: tekstVan(x.type, 40), tekst: tekstVan(text, 600), link: tekstVan(link, 500), beeld: tekstVan(picture, 1000), metrics })
  }
  if (!ig.ok) fouten.push({ netwerk: 'instagram', bron: 'posts/instagram', status: ig.status, melding: ig.tekst.slice(0, 160) })
  if (!fb.ok) fouten.push({ netwerk: 'facebook', bron: 'posts/facebook', status: fb.status, melding: fb.tekst.slice(0, 160) })
  return uit
}

/** Eén merk bijwerken. Werpt niet: wat misloopt staat in `fouten` (ook bewaard in metricool_sync). */
export async function syncMerk(admin: Admin, blogId: string, opties: { volledig?: boolean; netwerken?: Netwerk[]; deadline?: number } = {}): Promise<SyncUitkomst> {
  const deadline = opties.deadline ?? Date.now() + 50_000
  const { data } = await admin.from('metricool_sync').select('*').eq('blog_id', blogId).maybeSingle()
  const vroeger = data as SyncRij | null
  // Eén keer per week een volledige ronde: zo komen nieuwe kanalen en bronnen vanzelf mee.
  const volledig = !!opties.volledig || !vroeger?.volledig_op || Date.parse(vroeger.volledig_op) < Date.now() - 7 * 86_400_000
  const vandaag = vandaagBrussel()
  const from = isoBrussel(plusDagen(vandaag, -(volledig ? VOLLEDIG_DAGEN : RECENT_DAGEN)), '00:00:00')
  const to = isoBrussel(vandaag, '23:59:59')
  const bronnen: Record<string, string | null> = { ...(vroeger?.bronnen ?? {}) }
  const netwerken: Netwerk[] = (opties.netwerken?.length ? opties.netwerken : (vroeger?.netwerken ?? []).filter(isNetwerk))
  if (!netwerken.length) netwerken.push(...STANDAARD_NETWERKEN)
  const fouten: Fout[] = []
  let cijfers = 0, afgebroken = false
  await admin.from('metricool_sync').upsert({ blog_id: blogId, bezig_sinds: new Date().toISOString() }, { onConflict: 'blog_id' })

  for (const netwerk of netwerken) {
    for (const [kpi, kandidaten] of Object.entries(BRONNEN[netwerk]) as [string, Bron[]][]) {
      if (Date.now() > deadline) { afgebroken = true; break }
      const sleutel = `${netwerk}.${kpi}`
      const bekend = bronnen[sleutel]
      // Werkte geen enkele bron de vorige keer, dan enkel bij een volledige ronde opnieuw proberen.
      if (bekend === null && !volledig) continue
      const lijst = bekend ? [...kandidaten.filter((k) => bronSleutel(k) === bekend), ...kandidaten.filter((k) => bronSleutel(k) !== bekend)] : kandidaten
      let gevonden: Bron | null = null
      for (const b of lijst) {
        if (Date.now() > deadline) { afgebroken = true; break }
        try {
          const r = await mcVraag('/v2/analytics/timelines', { blogId, network: netwerk, metric: b.metric, subject: b.subject, scope: b.scope, from, to, timezone: TZ })
          if (!r.ok) { fouten.push({ netwerk, kpi, bron: bronSleutel(b), status: r.status, melding: r.tekst.slice(0, 160) }); continue }
          const punten = reeksUit(r.json)
          if (!punten.length) { fouten.push({ netwerk, kpi, bron: bronSleutel(b), status: r.status, melding: 'leeg' }); continue }
          await bewaarPunten(admin, blogId, netwerk, kpi, punten)
          cijfers += punten.length
          gevonden = b
          break
        } catch (e) {
          fouten.push({ netwerk, kpi, bron: bronSleutel(b), melding: e instanceof Error ? e.message.slice(0, 160) : 'fout' })
        }
      }
      if (afgebroken) break
      bronnen[sleutel] = gevonden ? bronSleutel(gevonden) : null
    }
    if (afgebroken) break
  }

  // De posts van de laatste 90 dagen (bij een volledige ronde 200), met hun cijfers.
  let posts = 0
  if (!afgebroken || Date.now() < deadline + 8000) {
    try {
      const lijst = await haalPosts(blogId, isoBrussel(plusDagen(vandaag, -(volledig ? VOLLEDIG_DAGEN : 90)), '00:00:00'), to, fouten)
      const nu = new Date().toISOString()
      const rijen = lijst.map((p) => ({ blog_id: blogId, ...p, bijgewerkt_op: nu }))
      for (let i = 0; i < rijen.length; i += 200) {
        const { error } = await admin.from('metricool_posts').upsert(rijen.slice(i, i + 200), { onConflict: 'blog_id,netwerk,post_id' })
        if (error) throw new Error(error.message)
      }
      posts = rijen.length
    } catch (e) { fouten.push({ bron: 'posts', melding: e instanceof Error ? e.message.slice(0, 160) : 'fout' }) }
  }

  const metData = netwerken.filter((n) => Object.entries(bronnen).some(([k, v]) => k.startsWith(`${n}.`) && v))
  await admin.from('metricool_sync').upsert({
    blog_id: blogId, laatst_op: new Date().toISOString(),
    volledig_op: volledig && !afgebroken ? new Date().toISOString() : vroeger?.volledig_op ?? null,
    bronnen, netwerken: metData.length ? metData : netwerken, fouten: fouten.slice(0, 40), bezig_sinds: null,
  }, { onConflict: 'blog_id' })
  return { blog_id: blogId, volledig, afgebroken, cijfers, posts, netwerken: metData, fouten }
}

/**
 * De volgende merken bijwerken (wat nog nooit of al 6 uur niet bijgewerkt is),
 * binnen het tijdsbudget van één scheduler-ronde. Meestal één merk per ronde.
 */
export async function syncVolgende(admin: Admin, opties: { budgetMs?: number } = {}): Promise<{ configured: boolean; gedaan: SyncUitkomst[]; wachtend: number }> {
  if (!metricoolConfigured()) return { configured: false, gedaan: [], wachtend: 0 }
  const start = Date.now()
  const budget = opties.budgetMs ?? 50_000
  const { data: klanten } = await admin.from('clients').select('metricool_blog_id').not('metricool_blog_id', 'is', null)
  const blogs = Array.from(new Set(((klanten ?? []) as { metricool_blog_id: string | null }[]).map((k) => String(k.metricool_blog_id ?? '').trim()).filter(Boolean)))
  if (!blogs.length) return { configured: true, gedaan: [], wachtend: 0 }
  const { data: syncs } = await admin.from('metricool_sync').select('blog_id, laatst_op, bezig_sinds').in('blog_id', blogs)
  const per = new Map(((syncs ?? []) as Pick<SyncRij, 'blog_id' | 'laatst_op' | 'bezig_sinds'>[]).map((s) => [s.blog_id, s]))
  const grens = Date.now() - VERS_UUR * 3600_000
  const teDoen = blogs
    .filter((b) => { const s = per.get(b); return !s?.laatst_op || Date.parse(s.laatst_op) < grens })
    .filter((b) => { const s = per.get(b); return !s?.bezig_sinds || Date.parse(s.bezig_sinds) < Date.now() - 3 * 60_000 })
    .sort((a, b) => (per.get(a)?.laatst_op ?? '').localeCompare(per.get(b)?.laatst_op ?? ''))
  const profielen = teDoen.length ? await netwerkenPerMerk() : new Map<string, Netwerk[]>()
  const gedaan: SyncUitkomst[] = []
  for (const blog of teDoen) {
    // Een merk vraagt een dertigtal vragen aan één per seconde: enkel beginnen als dat nog past.
    if (gedaan.length && Date.now() - start > budget - 35_000) break
    gedaan.push(await syncMerk(admin, blog, { netwerken: profielen.get(blog), deadline: start + budget }))
  }
  return { configured: true, gedaan, wachtend: Math.max(0, teDoen.length - gedaan.length) }
}

export type StatistiekenData = { rijen: Rij[]; posts: StatPost[]; laatstOp: string | null; netwerken: string[] }

/** De dagcijfers van één merk vanaf een dag, uit onze databank (per 1000 rijen). */
export async function laadRijen(admin: Admin, blogId: string, vanaf: string): Promise<Rij[]> {
  const uit: Rij[] = []
  for (let i = 0; i < 20; i++) {
    const { data, error } = await admin.from('metricool_statistieken').select('netwerk, kpi, datum, waarde')
      .eq('blog_id', blogId).gte('datum', vanaf).order('datum').range(i * 1000, i * 1000 + 999)
    if (error) break
    const blok = (data ?? []) as { netwerk: string; kpi: string; datum: string; waarde: number | string }[]
    uit.push(...blok.map((r) => ({ netwerk: r.netwerk, kpi: r.kpi, datum: String(r.datum).slice(0, 10), waarde: Number(r.waarde) })))
    if (blok.length < 1000) break
  }
  return uit
}

/** Alles voor het scherm van één merk: dagcijfers (200 dagen) en posts, uit onze databank. */
export async function laadStatistieken(admin: Admin, blogId: string): Promise<StatistiekenData> {
  const vanaf = plusDagen(vandaagBrussel(), -VOLLEDIG_DAGEN)
  const [rijen, posts, sync] = await Promise.all([
    laadRijen(admin, blogId, vanaf),
    admin.from('metricool_posts').select('netwerk, post_id, gepubliceerd_op, soort, tekst, link, beeld, metrics')
      .eq('blog_id', blogId).gte('gepubliceerd_op', `${vanaf}T00:00:00Z`).order('gepubliceerd_op', { ascending: false }).limit(600)
      .then((r) => (r.error ? [] : ((r.data ?? []) as StatPost[]))),
    admin.from('metricool_sync').select('laatst_op, netwerken').eq('blog_id', blogId).maybeSingle()
      .then((r) => (r.data as { laatst_op: string | null; netwerken: string[] | null } | null)),
  ])
  return { rijen, posts, laatstOp: sync?.laatst_op ?? null, netwerken: sync?.netwerken ?? [] }
}

import 'server-only'
import { metricoolRequest } from '@/lib/metricool'

/**
 * Metricool-inbox: comments en DM's ophalen, en erop antwoorden.
 *
 * ── SCHRIJVEN ───────────────────────────────────────────────────────────────
 * Dit is de ENIGE plek waar de app naar Metricool schrijft, en enkel om een
 * antwoord te versturen nadat een mens de tekst bevestigd heeft (inbox in het
 * beheer, of de MCP-tool community_versturen met bevestigd_door). Verwijderen,
 * markeren als gelezen of iets anders wijzigen in Metricool doet de app niet.
 *
 * ── WAT DE API ZEGT (OpenAPI-spec https://app.metricool.com/api/swagger.json) ─
 *  Alle aanroepen: header X-Mc-Auth, query userId + blogId (het merk).
 *
 *  GET  /v2/inbox/post-comments?provider=…         → { data: PostCommentsThread[], page: { next } }
 *  GET  /v2/inbox/post-comments/authorizations?provider=… → { data: { missingScopes[], allowAccessToMessages } }
 *  GET  /v2/inbox/conversations?provider=…          → { data: Conversation[], page: { next } }
 *  GET  /v2/inbox/conversations/authorizations?provider=…
 *  POST /v2/inbox/post-comments   body NewCommentRequest { provider*, objectId*, text, attachment }
 *  POST /v2/inbox/conversations   body NewMessageRequest { provider*, conversationId*, recipient*, text, attachment }
 *  provider (enum): INSTAGRAM, INSTAGRAMBUSINESS, TWITTER, FACEBOOK, GMB, TIKTOKBUSINESS, YOUTUBE, LINKEDIN
 *  Geen periode-parameter in de spec; een lijst pagineert via page.next.
 *
 *  PostCommentsThread { id, provider, status (PENDING|READ|RESOLVED), creationDate, lastUpdateTime,
 *                       participants: Participant[], root: RootComment }
 *  RootComment        { id, creationDate, owner, text, mediaUrl, properties, element: Element, comments: Comment[] }
 *  Comment            { id, parentId, creationDate, owner, text, mediaUrl, properties }
 *  Element (de post)  { id, owner: Participant, link, text, mediaUrls[], commentCount, reactionCount, properties }
 *  Participant        { id, name, email, imageProfileUrl }
 *  Conversation       { id, provider, status, creationDate, lastUpdateTime, participants: Participant[], messages: Message[] }
 *  Message            { id, from, to, text, publicationDateTime, attachments[], properties, status (NEW|READ|DELETED) }
 *
 *  Onze mapping (veldnaam in Metricool → community_berichten):
 *   comment:  id = root.id | comment.id · tekst = text · auteur = participant met id = owner
 *             · datum = creationDate · post-id = root.element.id · post-tekst = element.text
 *             · post-url = element.link · parent = comment.parentId (root: geen)
 *             · van het merk zelf = owner === root.element.owner.id
 *   dm:       id = message.id · tekst = text · auteur = participant met id = from
 *             · datum = publicationDateTime · thread = conversation.id (parent_extern_id)
 *             · van het merk zelf = from is het merk (zie merkIdsUitGesprekken)
 *   antwoorden: comment → objectId = de id van de comment waarop je reageert;
 *               dm → conversationId = conversation.id, recipient = participant-id van de klant.
 *
 * ── LIVE BEVESTIGD VIA /api/admin/metricool/diag?inbox=1 ─────────────────────
 *  (zie het blok DIAGNOSE hieronder; aangevuld na de eerste diagnose op het merk)
 */

// ── Netwerken ────────────────────────────────────────────────────────────────

/** Onze netwerknamen → Metricool `provider`. */
export const PROVIDER: Record<string, string> = {
  instagram: 'INSTAGRAM', facebook: 'FACEBOOK', tiktok: 'TIKTOKBUSINESS', linkedin: 'LINKEDIN', youtube: 'YOUTUBE', x: 'TWITTER',
}
/** Comments: Instagram, Facebook, TikTok (business), LinkedIn (bedrijfspagina), YouTube. */
export const COMMENT_NETWERKEN = ['instagram', 'facebook', 'tiktok', 'linkedin', 'youtube'] as const
/** DM's: Instagram, Facebook, X. */
export const DM_NETWERKEN = ['instagram', 'facebook', 'x'] as const
export const ALLE_NETWERKEN = ['instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'x'] as const
export const NETWERK_LABEL: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', linkedin: 'LinkedIn', youtube: 'YouTube', x: 'X',
}

export type InboxBericht = {
  bron: 'comment' | 'dm'
  netwerk: string
  extern_id: string
  parent_extern_id: string | null
  post_extern_id: string | null
  post_tekst: string | null
  post_url: string | null
  auteur_naam: string | null
  auteur_handle: string | null
  tekst: string
  ontvangen_op: string | null
  /** Voor een DM: de participant-id van de klant (recipient bij antwoorden). */
  ontvanger_id: string | null
  raw: unknown
}
export type InboxResultaat = {
  berichten: InboxBericht[]
  /** Berichten waarop het merk al antwoordde (bv. manueel in Metricool). */
  alBeantwoord: string[]
}

// ── Parsen (puur; getest in tests/metricool-inbox.test.ts) ─────────────────────

type Participant = { id?: string; name?: string; email?: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ruw = any

const tekstVan = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const idVan = (v: unknown) => (v == null || v === '' ? null : String(v))
function naamVan(participants: Participant[] | undefined, id: string | null): { naam: string | null; handle: string | null } {
  if (!id) return { naam: null, handle: null }
  const p = (participants ?? []).find((x) => String(x?.id) === id)
  return { naam: p?.name ?? null, handle: p?.email || id }
}

/** Comment-threads → berichten. Reacties van het merk worden niet opgeslagen, maar markeren hun parent als beantwoord. */
export function parseCommentThreads(threads: Ruw[], netwerk: string): InboxResultaat {
  const berichten: InboxBericht[] = []
  const alBeantwoord = new Set<string>()
  for (const t of Array.isArray(threads) ? threads : []) {
    const root = t?.root ?? {}
    const post = root?.element ?? {}
    const merkId = idVan(post?.owner?.id)
    const isMerk = (owner: unknown) => !!merkId && idVan(owner) === merkId
    const postInfo = { post_extern_id: idVan(post?.id), post_tekst: tekstVan(post?.text) || null, post_url: idVan(post?.link) }
    const rootId = idVan(root?.id)
    if (rootId && !isMerk(root?.owner)) {
      const a = naamVan(t?.participants, idVan(root?.owner))
      berichten.push({
        bron: 'comment', netwerk, extern_id: rootId, parent_extern_id: null, ...postInfo,
        auteur_naam: a.naam, auteur_handle: a.handle, tekst: tekstVan(root?.text), ontvangen_op: idVan(root?.creationDate),
        ontvanger_id: null, raw: { ...t, root: { ...root, comments: undefined } },
      })
    }
    for (const c of Array.isArray(root?.comments) ? root.comments : []) {
      const cid = idVan(c?.id)
      if (!cid) continue
      const parent = idVan(c?.parentId) ?? rootId
      if (isMerk(c?.owner)) { if (parent) alBeantwoord.add(parent); continue }
      const a = naamVan(t?.participants, idVan(c?.owner))
      berichten.push({
        bron: 'comment', netwerk, extern_id: cid, parent_extern_id: parent, ...postInfo,
        auteur_naam: a.naam, auteur_handle: a.handle, tekst: tekstVan(c?.text), ontvangen_op: idVan(c?.creationDate),
        ontvanger_id: null, raw: c,
      })
    }
  }
  return { berichten, alBeantwoord: [...alBeantwoord] }
}

/**
 * Wie is het merk in de gesprekken? Het merk zit in élk gesprek; een klant
 * (bijna) nooit in meer dan één. Met één gesprek kunnen we het niet zeker weten:
 * dan geven we de ids terug die we al kennen (uit de comments van hetzelfde merk).
 */
export function merkIdsUitGesprekken(conversations: Ruw[], bekend: string[] = []): Set<string> {
  const uit = new Set(bekend.filter(Boolean))
  const lijst = Array.isArray(conversations) ? conversations : []
  if (lijst.length >= 2) {
    const telling = new Map<string, number>()
    for (const c of lijst) for (const id of new Set((c?.participants ?? []).map((p: Participant) => idVan(p?.id)).filter(Boolean) as string[])) telling.set(id, (telling.get(id) ?? 0) + 1)
    for (const [id, n] of telling) if (n === lijst.length) uit.add(id)
  }
  return uit
}

/** Gesprekken → berichten (enkel inkomende). Een bericht met een latere reactie van het merk is beantwoord. */
export function parseGesprekken(conversations: Ruw[], netwerk: string, merkIds: Set<string>): InboxResultaat {
  const berichten: InboxBericht[] = []
  const alBeantwoord = new Set<string>()
  for (const c of Array.isArray(conversations) ? conversations : []) {
    const convId = idVan(c?.id)
    if (!convId) continue
    const msgs = (Array.isArray(c?.messages) ? c.messages : [])
      .filter((m: Ruw) => idVan(m?.id) && m?.status !== 'DELETED')
      .sort((a: Ruw, b: Ruw) => String(a?.publicationDateTime ?? '').localeCompare(String(b?.publicationDateTime ?? '')))
    let laatsteMerk: string | null = null
    for (const m of msgs) if (merkIds.has(String(m?.from))) laatsteMerk = String(m?.publicationDateTime ?? '')
    for (const m of msgs) {
      const van = idVan(m?.from)
      if (van && merkIds.has(van)) continue
      const id = String(m.id)
      const a = naamVan(c?.participants, van)
      berichten.push({
        bron: 'dm', netwerk, extern_id: id, parent_extern_id: convId, post_extern_id: null, post_tekst: null, post_url: null,
        auteur_naam: a.naam, auteur_handle: a.handle, tekst: tekstVan(m?.text), ontvangen_op: idVan(m?.publicationDateTime),
        ontvanger_id: van, raw: m,
      })
      if (laatsteMerk && String(m?.publicationDateTime ?? '') <= laatsteMerk) alBeantwoord.add(id)
    }
  }
  return { berichten, alBeantwoord: [...alBeantwoord] }
}

// ── Ophalen ──────────────────────────────────────────────────────────────────

const MAX_PAGINAS = 5

async function lijst(pad: string, blogId: string, provider: string): Promise<Ruw[]> {
  const uit: Ruw[] = []
  let volgende: string | null = pad
  for (let i = 0; volgende && i < MAX_PAGINAS; i++) {
    const res = await metricoolRequest(volgende, i === 0 ? { query: { blogId, provider } } : {})
    const tekst = await res.text()
    if (!res.ok) throw new Error(`Metricool ${pad} (${provider}) → ${res.status}: ${tekst.slice(0, 200)}`)
    const json: Ruw = tekst ? JSON.parse(tekst) : {}
    const data = Array.isArray(json) ? json : json?.data
    if (Array.isArray(data)) uit.push(...data)
    const next = json?.page?.next
    // Enkel een volledige link volgen; een onbekend formaat volgen we niet (geen gok).
    volgende = typeof next === 'string' && /^https:\/\/app\.metricool\.com\//.test(next) ? next : null
  }
  return uit
}

export async function haalComments(blogId: string, netwerk: string): Promise<InboxResultaat & { merkIds: string[] }> {
  const provider = PROVIDER[netwerk]
  if (!provider || !(COMMENT_NETWERKEN as readonly string[]).includes(netwerk)) return { berichten: [], alBeantwoord: [], merkIds: [] }
  const threads = await lijst('/v2/inbox/post-comments', blogId, provider)
  return { ...parseCommentThreads(threads, netwerk), merkIds: merkIdsUitThreads(threads) }
}

export async function haalGesprekken(blogId: string, netwerk: string, bekendeMerkIds: string[] = []): Promise<InboxResultaat & { merkIds: string[] }> {
  const provider = PROVIDER[netwerk]
  if (!provider || !(DM_NETWERKEN as readonly string[]).includes(netwerk)) return { berichten: [], alBeantwoord: [], merkIds: [] }
  const convs = await lijst('/v2/inbox/conversations', blogId, provider)
  const merk = merkIdsUitGesprekken(convs, bekendeMerkIds)
  return { ...parseGesprekken(convs, netwerk, merk), merkIds: [...merk] }
}

/** De merk-id(s) uit comment-threads (de eigenaar van de post). */
export function merkIdsUitThreads(threads: Ruw[]): string[] {
  return [...new Set((Array.isArray(threads) ? threads : []).map((t) => idVan(t?.root?.element?.owner?.id)).filter(Boolean) as string[])]
}

// ── Antwoorden (enkel na bevestiging door een mens) ─────────────────────────────

async function post(pad: string, blogId: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await metricoolRequest(pad, { method: 'POST', query: { blogId }, body })
  const tekst = await res.text()
  if (!res.ok) throw new Error(`Metricool weigerde het antwoord (${res.status}): ${tekst.slice(0, 300)}`)
  try { const j = tekst ? JSON.parse(tekst) : null; return typeof j?.data === 'string' ? j.data : null } catch { return null }
}

/** Antwoord op een comment: objectId = de comment waarop je reageert. */
export async function beantwoordComment(a: { blogId: string; netwerk: string; objectId: string; tekst: string }): Promise<string | null> {
  const provider = PROVIDER[a.netwerk]
  if (!provider) throw new Error(`Onbekend netwerk: ${a.netwerk}`)
  return post('/v2/inbox/post-comments', a.blogId, { provider, objectId: a.objectId, text: a.tekst })
}

/** Antwoord in een gesprek (DM). */
export async function beantwoordGesprek(a: { blogId: string; netwerk: string; conversationId: string; recipient: string; tekst: string }): Promise<string | null> {
  const provider = PROVIDER[a.netwerk]
  if (!provider) throw new Error(`Onbekend netwerk: ${a.netwerk}`)
  return post('/v2/inbox/conversations', a.blogId, { provider, conversationId: a.conversationId, recipient: a.recipient, text: a.tekst })
}

// ── Diagnose (stap 0): ruwe antwoorden bekijken, niets wijzigen ────────────────

export async function diagnoseInbox(blogId: string, netwerk: string) {
  const providers = netwerk === 'instagram' ? ['INSTAGRAM', 'INSTAGRAMBUSINESS'] : [PROVIDER[netwerk] ?? netwerk.toUpperCase()]
  const paden = ['/v2/inbox/post-comments', '/v2/inbox/post-comments/authorizations', '/v2/inbox/conversations', '/v2/inbox/conversations/authorizations']
  const uit: { pad: string; provider: string; status?: number; ok: boolean; antwoord?: unknown; fout?: string }[] = []
  for (const provider of providers) {
    for (const pad of paden) {
      try {
        const res = await metricoolRequest(pad, { query: { blogId, provider } })
        const tekst = await res.text()
        let antwoord: unknown = tekst.slice(0, 2000)
        try {
          const j = JSON.parse(tekst)
          // Beperkt tot de eerste 3 items, zodat de diagnose leesbaar blijft.
          antwoord = Array.isArray(j?.data) ? { ...j, data: j.data.slice(0, 3), aantal: j.data.length } : j
        } catch { /* geen JSON */ }
        uit.push({ pad, provider, status: res.status, ok: res.ok, antwoord })
      } catch (e) {
        uit.push({ pad, provider, ok: false, fout: e instanceof Error ? e.message : 'fout' })
      }
    }
  }
  return uit
}

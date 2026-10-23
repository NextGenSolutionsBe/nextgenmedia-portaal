import 'server-only'
import { metricoolRequest } from '@/lib/metricool'
import {
  PROVIDER, COMMENT_NETWERKEN, DM_NETWERKEN, parseCommentThreads, merkIdsUitGesprekken, parseGesprekken, merkIdsUitThreads,
  type InboxResultaat,
} from '@/lib/metricool-inbox-parse'

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
 * ── LIVE BEVESTIGD (22 okt 2026, /api/cron/community-diag op Straight-Line Leadership,
 *    Inner Stance en PB - Kristof Cuppens; Instagram, Facebook, LinkedIn) ────────
 *  - Antwoord is { data: [...] } ZONDER page-veld: comments geven tot 50 threads,
 *    gesprekken tot 25. Er is dus geen paginering; de sync om de 10 minuten vangt
 *    nieuwe berichten op omdat de lijst recentste eerst geeft.
 *  - Elke thread en elk gesprek heeft `self` = het account van het merk
 *    (bv. IG "17841455442435509", LinkedIn "urn:li:organization:…"). Dat is de
 *    merkherkenning; element.owner.id (de post-eigenaar) is gelijk en blijft reserve.
 *  - root.owner en comment.owner zijn een id-string; de naam staat in participants[]
 *    (IG: name = gebruikersnaam; FB: volledige naam; LinkedIn: naam).
 *  - Datums met offset zonder dubbelpunt: "2026-10-22T06:41:31+0200" → isoVan().
 *  - Comment-reacties hangen één niveau diep: comment.parentId = root.id.
 *    Antwoord van het merk gezien als comment met owner = self en parentId = root.id.
 *  - LinkedIn: root kan door het merk zelf geplaatst zijn (link in eerste comment);
 *    die slaan we over. GET /conversations met LINKEDIN → 500 "provider invalid"
 *    (DM's dus niet voor LinkedIn, zoals voorzien).
 *  - INSTAGRAMBUSINESS geeft lege lijsten en missingScopes; INSTAGRAM is de juiste provider.
 *  - FB-comment-id's zien eruit als "<post>_<comment>"; IG-id's zijn numeriek.
 *  - DM-berichten kunnen text "" hebben (enkel een bijlage).
 *  - Authorizations: post-comments → { data: { missingScopes: [] } };
 *    conversations → { data: { missingScopes: [], allowAccessToMessages: true } }.
 *
 *  NIET LIVE BEVESTIGD: het POST-antwoord. Veldnamen komen uit de spec
 *  (NewCommentRequest / NewMessageRequest), maar de spec zegt niet of objectId de
 *  post of de comment is. Wij sturen objectId = de bovenste comment van de thread
 *  (parent_extern_id, of de comment zelf als die bovenaan staat): zo antwoordt het
 *  merk ook in de live data (parentId = root.id), en Instagram kent maar één niveau.
 *  Het eerste echte antwoord moet dit bevestigen (zie docs/community-management.md).
 */

export {
  PROVIDER, COMMENT_NETWERKEN, DM_NETWERKEN, ALLE_NETWERKEN, NETWERK_LABEL,
  parseCommentThreads, merkIdsUitGesprekken, parseGesprekken, merkIdsUitThreads,
} from '@/lib/metricool-inbox-parse'
export type { InboxBericht, InboxResultaat } from '@/lib/metricool-inbox-parse'

// ── Ophalen ──────────────────────────────────────────────────────────────────

const MAX_PAGINAS = 5

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ruw = any

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

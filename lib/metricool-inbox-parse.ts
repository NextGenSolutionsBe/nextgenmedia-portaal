// Metricool-inbox — pure delen (netwerken, types, parsen). Client-safe en zonder
// netwerkverkeer, zodat tests/community.test.ts ze rechtstreeks kan draaien.
// Ophalen en antwoorden staan in lib/metricool-inbox.ts (server-only).

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

// ── Parsen (puur; getest in tests/community.test.ts) ─────────────────────

type Participant = { id?: string; name?: string; email?: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ruw = any

const tekstVan = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const idVan = (v: unknown) => (v == null || v === '' ? null : String(v))
/** Metricool geeft "2026-10-22T06:41:31+0200"; wij bewaren ISO (UTC). */
export function isoVan(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}
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
    // `self` = het account van het merk (live bevestigd); de eigenaar van de post als reserve.
    const merkId = idVan(t?.self) ?? idVan(post?.owner?.id)
    const isMerk = (owner: unknown) => !!merkId && idVan(owner) === merkId
    const postInfo = { post_extern_id: idVan(post?.id), post_tekst: tekstVan(post?.text) || null, post_url: idVan(post?.link) }
    const rootId = idVan(root?.id)
    if (rootId && !isMerk(root?.owner)) {
      const a = naamVan(t?.participants, idVan(root?.owner))
      berichten.push({
        bron: 'comment', netwerk, extern_id: rootId, parent_extern_id: null, ...postInfo,
        auteur_naam: a.naam, auteur_handle: a.handle, tekst: tekstVan(root?.text), ontvangen_op: isoVan(root?.creationDate),
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
        auteur_naam: a.naam, auteur_handle: a.handle, tekst: tekstVan(c?.text), ontvangen_op: isoVan(c?.creationDate),
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
  for (const c of lijst) { const s = idVan(c?.self); if (s) uit.add(s) }
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
      .sort((a: Ruw, b: Ruw) => (isoVan(a?.publicationDateTime) ?? '').localeCompare(isoVan(b?.publicationDateTime) ?? ''))
    const isMerk = (id: string | null) => !!id && (merkIds.has(id) || id === idVan(c?.self))
    const tijd = (m: Ruw) => isoVan(m?.publicationDateTime) ?? ''
    let laatsteMerk: string | null = null
    for (const m of msgs) if (isMerk(idVan(m?.from))) laatsteMerk = tijd(m)
    for (const m of msgs) {
      const van = idVan(m?.from)
      if (isMerk(van)) continue
      const id = String(m.id)
      const a = naamVan(c?.participants, van)
      berichten.push({
        bron: 'dm', netwerk, extern_id: id, parent_extern_id: convId, post_extern_id: null, post_tekst: null, post_url: null,
        auteur_naam: a.naam, auteur_handle: a.handle, tekst: tekstVan(m?.text), ontvangen_op: isoVan(m?.publicationDateTime),
        ontvanger_id: van, raw: m,
      })
      if (laatsteMerk && tijd(m) <= laatsteMerk) alBeantwoord.add(id)
    }
  }
  return { berichten, alBeantwoord: [...alBeantwoord] }
}

/** De merk-id(s) uit comment-threads (de eigenaar van de post). */
export function merkIdsUitThreads(threads: Ruw[]): string[] {
  return [...new Set((Array.isArray(threads) ? threads : []).flatMap((t) => [idVan(t?.self), idVan(t?.root?.element?.owner?.id)]).filter(Boolean) as string[])]
}

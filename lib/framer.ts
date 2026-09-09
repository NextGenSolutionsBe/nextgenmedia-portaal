import 'server-only'
import { decryptSecret } from '@/lib/crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

// Server-side Framer-publicatie. API-calls gebeuren UITSLUITEND hier (server),
// nooit vanuit de frontend. De API key wordt versleuteld bewaard en pas hier
// ontsleuteld.
//
// STATUS: de effectieve Framer Server API-aanroepen zitten achter deze interface
// en zijn nog NIET geactiveerd, omdat de exacte methodenamen van het
// `framer-api`-package geverifieerd moeten worden tegen de officiële docs:
//   https://www.framer.com/developers/server-api-quick-start
//   https://www.framer.com/developers/server-api-reference
//   https://www.framer.com/developers/cms
// Bedoelde flow (één keer activeren na verificatie):
//   1. const client = connect(projectUrl, apiKey)
//   2. const collection = await client.getCollection(collectionId)
//   3. const fieldData = buildFieldData(fieldMap, blog)
//   4. bestaand item? update : add  (idempotent op slug / framer_item_id)
//   5. const changed = await collection.getChangedPaths()  → safety check
//   6. await collection.publish()
//   7. await client.deploy()
//   8. finally: await client.disconnect()

export type FramerClientConfig = {
  projectUrl: string | null
  apiKeyEncrypted: string | null
  collectionId: string | null
  fieldMap: Record<string, string> | null
}

export type BlogForPublish = {
  id: string
  titel: string
  slug: string
  content: string | null
  meta_title: string | null
  meta_description: string | null
  thumbnail_url: string | null
  framer_item_id: string | null
}

export type PublishResult = {
  ok: boolean
  pending?: boolean          // integratie nog niet geactiveerd (geen echte fout)
  needsConfirm?: boolean     // openstaande Framer-wijzigingen → admin moet bevestigen
  framerItemId?: string
  error?: string
  warning?: string           // bv. onverwachte getChangedPaths
}

// Slug is in Framer de ingebouwde item-slug (geen CMS-veld), dus niet verplicht
// in de field-map. Enkel titel + content moeten gemapt zijn.
const REQUIRED_FIELDS = ['titel', 'content'] as const

/** Controleert of alle Framer-config aanwezig is om te mogen publiceren. */
export function validateFramerConfig(c: FramerClientConfig): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  if (!c.projectUrl) missing.push('Framer project URL')
  if (!decryptSecret(c.apiKeyEncrypted)) missing.push('Framer API key')
  if (!c.collectionId) missing.push('Framer collection ID')
  const fm = c.fieldMap
  if (!fm || typeof fm !== 'object') missing.push('Field map')
  else for (const f of REQUIRED_FIELDS) if (!fm[f]) missing.push(`Field map: ${f}`)
  return { ok: missing.length === 0, missing }
}

/** Bouwt de fieldData op basis van de field-map (field IDs → blogwaarden). */
export function buildFieldData(fieldMap: Record<string, string>, blog: BlogForPublish): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const set = (key: string, value: unknown) => { if (fieldMap[key]) out[fieldMap[key]] = value }
  set('titel', blog.titel)
  set('content', blog.content ?? '')
  set('slug', blog.slug)
  set('datum', new Date().toISOString())
  set('thumbnail', blog.thumbnail_url ?? '')
  return out
}

/**
 * Publiceert een (reeds GOEDGEKEURDE) blog naar Framer.
 * Tot de framer-api integratie geverifieerd + geactiveerd is, geeft dit een
 * `pending`-resultaat terug i.p.v. een echte publicatie — zo gaat er nooit
 * ongeteste/niet-goedgekeurde content live en blijft de build groen.
 */
export async function publishBlogToFramer(config: FramerClientConfig, blog: BlogForPublish, opts?: { confirmOverride?: boolean; accountId?: string }): Promise<PublishResult> {
  const v = validateFramerConfig(config)
  if (!v.ok) return { ok: false, error: `Ontbrekende Framer-configuratie: ${v.missing.join(', ')}` }

  const apiKey = decryptSecret(config.apiKeyEncrypted)

  if (process.env.FRAMER_ENABLED !== 'true') {
    return {
      ok: false,
      pending: true,
      error: 'Framer-publicatie is nog niet geactiveerd. Configuratie is volledig — zet FRAMER_ENABLED=true en test op één klant om live te publiceren.',
    }
  }

  // ── Echte per-klant publicatie via framer-api (connect → … → disconnect) ────
  // connect() neemt per aanroep project + key → elke klant publiceert naar zijn
  // eigen Framer-project. Dynamische import zodat de (ESM) package alleen laadt
  // wanneer er effectief gepubliceerd wordt.
  const cid = opts?.accountId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let framer: any = null
  try {
    const mod = await import('framer-api')
    framer = await mod.connect(config.projectUrl as string, apiKey)
    await logFramerAction(cid, blog.id, 'connect', 'ok')

    const collections = await framer.getCollections()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collection = (collections as any[]).find((c) => c.id === config.collectionId)
    if (!collection) return { ok: false, error: `Framer-collectie ${config.collectionId} niet gevonden in dit project.` }

    // fieldData in Framer-vorm: { [fieldId]: { type, value } } — type is verplicht.
    const fm = config.fieldMap as Record<string, string>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fd: Record<string, any> = {}
    if (fm.titel) fd[fm.titel] = { type: 'string', value: blog.titel }
    if (fm.content) fd[fm.content] = { type: 'formattedText', value: blog.content ?? '' }
    if (fm.thumbnail && blog.thumbnail_url) fd[fm.thumbnail] = { type: 'image', value: blog.thumbnail_url }
    if (fm.datum) fd[fm.datum] = { type: 'date', value: new Date().toISOString() }
    if (fm.excerpt && blog.meta_description) fd[fm.excerpt] = { type: 'string', value: blog.meta_description }

    // Idempotent: bestaand item ALTIJD opzoeken in de collectie zelf (op echte
    // Framer-id of op slug). We vertrouwen NIET blind op blog.framer_item_id,
    // want een verkeerd opgeslagen waarde (bv. de slug i.p.v. de echte id) zou
    // anders een "No item found with ID …"-fout geven. addItems met een
    // bestaande id = update; zonder id = nieuw item.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingItems = (await collection.getItems()) as any[]
    const match = existingItems.find((it) => (blog.framer_item_id && it.id === blog.framer_item_id) || it.slug === blog.slug)
    const itemId: string | null = match?.id ?? null

    // Veiligheidscheck vóór publish: onverwachte openstaande wijzigingen.
    try {
      const changed = await framer.getChangedPaths()
      const total = ((changed?.added?.length ?? 0) + (changed?.removed?.length ?? 0) + (changed?.modified?.length ?? 0))
      await logFramerAction(cid, blog.id, 'getChangedPaths', 'ok')
      if (total > 1 && !opts?.confirmOverride) {
        const warning = 'Er staan nog niet-gepubliceerde wijzigingen in dit Framer-project.'
        return { ok: false, needsConfirm: true, warning, error: warning }
      }
    } catch { /* getChangedPaths optioneel */ }

    // Item toevoegen of updaten (addItems met bestaande id = update; zonder id = nieuw item).
    // Robuust: faalt een update omdat de id niet (meer) bestaat ("No item found
    // with ID …"), dan maken we het item gewoon opnieuw aan zonder id.
    let createdFresh = false
    try {
      await collection.addItems([itemId ? { id: itemId, slug: blog.slug, fieldData: fd } : { slug: blog.slug, fieldData: fd }])
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (itemId && /no item found/i.test(m)) {
        await collection.addItems([{ slug: blog.slug, fieldData: fd }])
        createdFresh = true
      } else {
        throw e
      }
    }

    // Echte Framer-id ophalen (na een create heeft het nieuwe item een gegenereerde id).
    let realId: string | null = createdFresh ? null : itemId
    if (!realId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const after = (await collection.getItems()) as any[]
        realId = after.find((it) => it.slug === blog.slug)?.id ?? null
      } catch { /* best-effort */ }
    }

    // Publiceren + naar productie deployen.
    const pub = await framer.publish()
    await logFramerAction(cid, blog.id, 'publish', 'ok')
    const deploymentId = pub?.deployment?.id ?? pub?.deployment ?? pub?.deploymentId
    if (deploymentId) { try { await framer.deploy(deploymentId); await logFramerAction(cid, blog.id, 'deploy', 'ok') } catch (e) { await logFramerAction(cid, blog.id, 'deploy', 'gefaald', e instanceof Error ? e.message : null) } }

    // Enkel een ECHTE Framer-id teruggeven (nooit de slug) zodat updates blijven werken.
    return { ok: true, framerItemId: realId ?? undefined }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Framer-publicatie mislukt'
    await logFramerAction(cid, blog.id, 'publish', 'gefaald', msg)
    return { ok: false, error: msg }
  } finally {
    try { await framer?.disconnect(); await logFramerAction(cid, blog.id, 'disconnect', 'ok') } catch { /* altijd netjes sluiten */ }
  }
}

// ── Manager-helpers: logging, verbinding testen, collecties + velden ──────────

type FramerAction = 'connect' | 'getChangedPaths' | 'publish' | 'deploy' | 'disconnect' | 'test'

/** Best-effort logregel in framer_logs (per blogaccount). Breekt nooit de flow. */
export async function logFramerAction(accountId: string | null, blogId: string | null, actie: FramerAction, status: 'ok' | 'gefaald', foutmelding?: string | null): Promise<void> {
  try {
    const admin = createAdminSupabaseClient()
    await admin.from('framer_logs').insert({ account_id: accountId, blog_id: blogId, actie, status, foutmelding: foutmelding ?? null })
  } catch { /* logging mag nooit breken */ }
}

/** Markeert de laatste geslaagde synchronisatie van een blogaccount. */
export async function markFramerSync(accountId: string): Promise<void> {
  try { await createAdminSupabaseClient().from('blog_accounts').update({ framer_last_sync: new Date().toISOString() }).eq('id', accountId) } catch { }
}

/** Automatische field-map-suggestie op basis van veldnamen. */
export function suggestFieldMap(fields: { id: string; name: string; type: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  const pick = (key: string, matchers: RegExp[], typePref?: string) => {
    const f = fields.find((x) => matchers.some((m) => m.test(x.name)) && (!typePref || x.type === typePref)) ?? fields.find((x) => matchers.some((m) => m.test(x.name)))
    if (f) out[key] = f.id
  }
  pick('titel', [/titel/i, /title/i, /naam/i])
  pick('content', [/content/i, /inhoud/i, /body/i, /tekst/i], 'formattedText')
  pick('thumbnail', [/thumb/i, /image/i, /afbeeld/i, /foto/i], 'image')
  pick('excerpt', [/excerpt/i, /samenvat/i, /intro/i, /beschrijv/i, /description/i])
  pick('datum', [/datum/i, /date/i, /publish/i], 'date')
  return out
}

/** Kiest automatisch de meest waarschijnlijke blogcollectie. */
export function detectBlogCollection(collections: { id: string; name: string }[]): { id: string | null; candidates: { id: string; name: string }[] } {
  const blogMatches = collections.filter((c) => /blog/i.test(c.name))
  if (blogMatches.length === 1) return { id: blogMatches[0].id, candidates: blogMatches }
  if (blogMatches.length > 1) return { id: null, candidates: blogMatches }
  if (collections.length === 1) return { id: collections[0].id, candidates: collections }
  return { id: null, candidates: collections }
}

async function withFramer<T>(config: FramerClientConfig, fn: (framer: { getCollections: () => Promise<unknown[]>; disconnect: () => Promise<void> }) => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!config.projectUrl) return { ok: false, error: 'Geen Framer project URL ingesteld.' }
  const apiKey = decryptSecret(config.apiKeyEncrypted)
  if (!apiKey) return { ok: false, error: 'Geen Framer API key ingesteld.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let framer: any = null
  try {
    const mod = await import('framer-api')
    framer = await mod.connect(config.projectUrl, apiKey)
    const data = await fn(framer)
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Framer-verbinding mislukt' }
  } finally {
    try { await framer?.disconnect() } catch { /* altijd netjes sluiten */ }
  }
}

/** Test de verbinding: connect → getCollections → disconnect. */
export async function testFramerConnection(config: FramerClientConfig): Promise<{ ok: boolean; collections?: number; error?: string }> {
  const r = await withFramer(config, async (framer) => (await framer.getCollections()).length)
  return r.ok ? { ok: true, collections: r.data } : { ok: false, error: r.error }
}

/** Haalt de beschikbare CMS-collecties op. */
export async function listFramerCollections(config: FramerClientConfig): Promise<{ ok: boolean; collections?: { id: string; name: string }[]; error?: string }> {
  const r = await withFramer(config, async (framer) => {
    const cols = await framer.getCollections()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (cols as any[]).map((c) => ({ id: String(c.id), name: String(c.name ?? c.id) }))
  })
  return r.ok ? { ok: true, collections: r.data } : { ok: false, error: r.error }
}

/** Haalt de velden van een collectie op (voor automatische field-map). */
export async function listFramerFields(config: FramerClientConfig, collectionId: string): Promise<{ ok: boolean; fields?: { id: string; name: string; type: string }[]; error?: string }> {
  const r = await withFramer(config, async (framer) => {
    const cols = await framer.getCollections()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const col = (cols as any[]).find((c) => c.id === collectionId)
    if (!col) throw new Error(`Collectie ${collectionId} niet gevonden.`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fields = typeof col.getFields === 'function' ? await col.getFields() : (col.fields ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (fields as any[]).filter((f) => f && f.type !== 'divider').map((f) => ({ id: String(f.id), name: String(f.name ?? ''), type: String(f.type ?? 'string') }))
  })
  return r.ok ? { ok: true, fields: r.data } : { ok: false, error: r.error }
}

export type AnalyzeResult = {
  ok: boolean
  error?: string
  collections?: { id: string; name: string }[]
  detectedId?: string | null
  needsChoice?: boolean
  fields?: { id: string; name: string; type: string }[]
  suggested?: Record<string, string>
}

/** Eén-klik analyse: verbind, detecteer blogcollectie, lees velden, stel map voor. */
export async function analyzeFramerProject(config: FramerClientConfig): Promise<AnalyzeResult> {
  if (!config.projectUrl) return { ok: false, error: 'Geen Framer project ingevuld.' }
  const apiKey = decryptSecret(config.apiKeyEncrypted)
  if (!apiKey) return { ok: false, error: 'Geen Framer toegangssleutel ingevuld.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let framer: any = null
  try {
    const mod = await import('framer-api')
    framer = await mod.connect(config.projectUrl, apiKey)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols = (await framer.getCollections()) as any[]
    const collections = cols.map((c) => ({ id: String(c.id), name: String(c.name ?? c.id) }))
    const det = detectBlogCollection(collections)
    if (!det.id) return { ok: true, collections, detectedId: null, needsChoice: true }
    const col = cols.find((c) => String(c.id) === det.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawFields = col && typeof col.getFields === 'function' ? await col.getFields() : (col?.fields ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fields = (rawFields as any[]).filter((f) => f && f.type !== 'divider').map((f) => ({ id: String(f.id), name: String(f.name ?? ''), type: String(f.type ?? 'string') }))
    return { ok: true, collections, detectedId: det.id, needsChoice: false, fields, suggested: suggestFieldMap(fields) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Analyse mislukt' }
  } finally {
    try { await framer?.disconnect() } catch { /* altijd sluiten */ }
  }
}

/** Test of de configuratie schrijftoegang heeft: maakt + verwijdert een testitem.
 *  Publiceert/deployt NIET, zodat er nooit een testblog live komt. */
export async function testPublish(config: FramerClientConfig): Promise<{ ok: boolean; error?: string }> {
  const v = validateFramerConfig(config)
  if (!v.ok) return { ok: false, error: `Ontbrekend: ${v.missing.join(', ')}` }
  const apiKey = decryptSecret(config.apiKeyEncrypted)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let framer: any = null
  try {
    const mod = await import('framer-api')
    framer = await mod.connect(config.projectUrl as string, apiKey)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols = (await framer.getCollections()) as any[]
    const col = cols.find((c) => String(c.id) === config.collectionId)
    if (!col) return { ok: false, error: 'Blogcollectie niet gevonden.' }
    const fm = config.fieldMap as Record<string, string>
    const slug = `ngm-test-${Date.now().toString(36)}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fd: Record<string, any> = {}
    if (fm.titel) fd[fm.titel] = { type: 'string', value: 'NGM testblog (mag verwijderd worden)' }
    if (fm.content) fd[fm.content] = { type: 'formattedText', value: 'Test' }
    await col.addItems([{ slug, fieldData: fd }])
    // Opruimen: terugzoeken op slug en verwijderen (geen publish/deploy).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (await col.getItems()) as any[]
    const made = items.find((it) => it.slug === slug)
    if (made) await col.removeItems([made.id])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Testpublicatie mislukt' }
  } finally {
    try { await framer?.disconnect() } catch { /* altijd sluiten */ }
  }
}

/** Vertaalt validatie-ontbrekende items naar niet-technische taal. */
export function friendlyMissing(config: FramerClientConfig, opts: { brandContext?: boolean }): string[] {
  const out: string[] = []
  if (!config.projectUrl) out.push('Framer project ontbreekt')
  if (!decryptSecret(config.apiKeyEncrypted)) out.push('Framer toegangssleutel ontbreekt')
  if (!config.collectionId) out.push('Blogcollectie niet gekozen')
  const fm = config.fieldMap
  if (!fm || !fm.titel || !fm.content) out.push('Framer velden niet gekoppeld')
  if (opts.brandContext === false) out.push('Brand context ontbreekt')
  return out
}

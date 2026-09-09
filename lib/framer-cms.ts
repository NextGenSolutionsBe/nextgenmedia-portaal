// ── Framer CMS-integratie (server-side only) ─────────────────────────────────
// Beheer de website-CMS van een klant via de Framer Server API (npm: framer-api).
// De klant bewerkt in ONZE app; onze server schrijft naar Framer met de per-klant
// API-key → geen extra Framer-seat nodig. De API-key blijft server-side (nooit
// naar de browser). framer-api is ESM + beta → dynamisch importeren + defensief.

import 'server-only'
import { decryptSecret } from '@/lib/crypto'

export type FramerEnumCase = { id: string; name: string }
export type FramerField = { id: string; name: string; type: string; editable: boolean; options?: FramerEnumCase[] }
export type FramerCollection = {
  id: string
  name: string
  slugField: string | null
  managedBy: string          // 'user' = door de klant gemaakt (bewerkbaar)
  editable: boolean          // schrijfbaar via de API?
  fields: FramerField[]
}
export type FramerItem = {
  framerItemId: string
  slug: string
  fieldData: Record<string, unknown>     // ruwe Framer-fieldData (voor terugschrijven)
  values: Record<string, string>         // vereenvoudigde weergavewaarden
}

export function framerConfigured(c: { framer_project_url?: string | null; framer_api_key?: string | null } | null | undefined): boolean {
  return !!(c?.framer_project_url && c?.framer_api_key)
}

/**
 * De opgeslagen API-sleutel omzetten naar een bruikbare sleutel.
 * Sleutels worden versleuteld opgeslagen (AES-256-GCM, zie lib/crypto.ts);
 * reeds bestaande onversleutelde sleutels blijven werken omdat decryptSecret
 * een onbekend formaat ongewijzigd teruggeeft. Zo is de overgang naadloos.
 */
export function framerApiKey(c: { framer_api_key?: string | null } | null | undefined): string {
  return decryptSecret(c?.framer_api_key ?? '')
}

/** Verbindt met het Framer-project, voert fn uit en verbreekt daarna netjes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withFramer<T>(projectUrl: string, apiKey: string, fn: (framer: any) => Promise<T>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any
  try {
    mod = await import('framer-api')
  } catch {
    throw new Error('framer-api is niet beschikbaar op de server')
  }
  const connect = mod?.connect
  if (typeof connect !== 'function') throw new Error('framer-api: connect() ontbreekt')
  const framer = await connect(projectUrl, apiKey)
  try {
    return await fn(framer)
  } finally {
    try { await framer?.disconnect?.() } catch { /* best-effort */ }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fieldsFrom(raw: any[]): FramerField[] {
  return (raw ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((f: any) => f && f.type !== 'divider' && f.type !== 'unsupported')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((f: any) => {
      // Enum-velden: de geldige opties (cases) uitlezen — id = wat Framer bij het
      // schrijven verwacht (EnumFieldDataEntryInput.value = case-id), name = weergave.
      let options: FramerEnumCase[] | undefined
      try {
        const cs = f.cases
        if (Array.isArray(cs)) options = cs.map((c: { id: unknown; name: unknown }) => ({ id: String(c.id), name: String(c.name ?? c.id) }))
      } catch { /* geen enum */ }
      return {
        id: String(f.id),
        name: String(f.name ?? f.id ?? ''),
        type: String(f.type ?? 'string'),
        editable: f.userEditable !== false,
        ...(options && options.length ? { options } : {}),
      }
    })
}

/** Ruwe Framer-fieldData-entry → leesbare weergavewaarde (string). */
function displayValue(entry: unknown): string {
  if (entry == null) return ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = entry as any
  const v = e.value ?? e
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') return String(v.url ?? v.value?.url ?? v.name ?? v.id ?? '')
  return ''
}

/** Zoekt het collectie-OBJECT (met .getFields/.getItems/.addItems/.removeItems). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findCollection(framer: any, collectionId: string): Promise<any | null> {
  const cols = (await framer.getCollections?.()) ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (cols as any[]).find((c) => String(c.id) === String(collectionId)) ?? null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeItem(it: any): FramerItem {
  const fieldData = (it.fieldData ?? {}) as Record<string, unknown>
  const values: Record<string, string> = {}
  for (const [k, entry] of Object.entries(fieldData)) values[k] = displayValue(entry)
  return { framerItemId: String(it.id ?? it.nodeId ?? ''), slug: String(it.slug ?? ''), fieldData, values }
}

/** Alle collecties + hun velden (schema). De lees-/schrijf-methodes zitten op het
 *  collectie-OBJECT (col.getFields/getItems), niet op framer. */
export async function listCollectionsWithSchema(projectUrl: string, apiKey: string): Promise<FramerCollection[]> {
  return withFramer(projectUrl, apiKey, async (framer) => {
    const cols = (await framer.getCollections?.()) ?? []
    const out: FramerCollection[] = []
    for (const c of cols) {
      const managedBy = String(c.managedBy ?? (c.readonly ? 'anotherPlugin' : 'user'))
      const editable = c.readonly !== true   // enkel écht read-only uitsluiten
      let fields: FramerField[] = []
      try { fields = fieldsFrom(await c.getFields?.()) } catch { /* niet leesbaar */ }
      out.push({ id: String(c.id), name: String(c.name ?? ''), slugField: c.slugFieldName ?? null, managedBy, editable, fields })
    }
    return out
  })
}

/** Alle items van één collectie (genormaliseerd + ruwe fieldData bewaard). */
export async function getCollectionItems(projectUrl: string, apiKey: string, collectionId: string): Promise<FramerItem[]> {
  return withFramer(projectUrl, apiKey, async (framer) => {
    const col = await findCollection(framer, collectionId)
    if (!col) return []
    const items = (await col.getItems?.()) ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (items as any[]).map(normalizeItem)
  })
}

// ── Schrijven + publiceren ────────────────────────────────────────────────────
// De klant bewerkt eenvoudige waarden (strings) in de app; we bouwen daaruit de
// Framer-veld-input per veldtype op. Beeld/bestand = URL-string; enum = case-id;
// referenties = item-id('s). Bevestigen via /diag met echte data.

/** 'YYYY-MM-DD' of ISO → volledige ISO-datum (zoals Framer die bewaart), of null. */
function toIsoDate(v: string): string | null {
  const d = new Date(v.length <= 10 ? `${v}T00:00:00.000Z` : v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// Bouwt de Framer-fieldData-input. LEGE niet-tekstvelden (datum/enum/image/file/
// referenties/getal) worden BEWUST overgeslagen: Framer valideert elke entry strikt
// (typia) en wijst een heel item af bij één ongeldige/lege waarde. Tekstvelden mogen
// wél leeg zijn (geldige lege string). Datum wordt naar volledige ISO genormaliseerd.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFieldDataInput(fields: FramerField[], values: Record<string, string>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {}
  for (const f of fields) {
    if (!(f.id in values)) continue
    // Waarde kan een kale string zijn OF (bij oudere/ruwe data) een Framer-entry-
    // object zoals { type:'enum', value:'Overig' }. displayValue herleidt beide
    // naar de onderliggende scalar (case-naam / url / tekst), anders wordt een
    // object ".toString()"'d tot "[object Object]" → Framer wijst het item af.
    const v = displayValue(values[f.id])
    // Vangrail: een kapotte waarde die eerder als object werd opgeslagen kan als
    // de letterlijke tekst "[object Object]" in de DB staan → behandel als leeg
    // zodat Framer het item niet afwijst.
    const empty = v.trim() === '' || v === '[object Object]'
    switch (f.type) {
      case 'number': { if (empty) break; const n = Number(v); if (!Number.isNaN(n)) out[f.id] = { type: 'number', value: n }; break }
      case 'boolean': out[f.id] = { type: 'boolean', value: v === 'true' || v === '1' || v === 'on' }; break
      case 'formattedText': out[f.id] = { type: 'formattedText', value: v, contentType: 'html' }; break
      // LET OP — lees- en schrijfvorm verschillen bij image/file:
      // lezen geeft een object (ImageFieldDataEntry.value = { id, url, … }),
      // maar schrijven verwacht de kale URL (…EntryInput.value = string | null).
      case 'image': if (!empty) out[f.id] = { type: 'image', value: v }; break
      case 'file': if (!empty) out[f.id] = { type: 'file', value: v }; break
      case 'date': { if (empty) break; const iso = toIsoDate(v); if (iso) out[f.id] = { type: 'date', value: iso }; break }
      case 'enum': {
        if (empty) break
        const opts = f.options ?? []
        if (opts.length === 0) { out[f.id] = { type: 'enum', value: v }; break } // cases onbekend → best effort
        const match = opts.find((o) => o.id === v || o.name === v)
          ?? opts.find((o) => o.id.toLowerCase() === v.toLowerCase() || o.name.toLowerCase() === v.toLowerCase())
        // Geldige case → stuur de case-id. Ongeldige categorie → OVERSLAAN zodat
        // Framer het hele item niet afwijst (categorie blijft dan gewoon leeg).
        if (match) out[f.id] = { type: 'enum', value: match.id }
        break
      }
      case 'color': if (!empty) out[f.id] = { type: 'color', value: v }; break
      case 'link': if (!empty) out[f.id] = { type: 'link', value: v }; break
      case 'collectionReference': if (!empty) out[f.id] = { type: 'collectionReference', value: v }; break
      case 'multiCollectionReference': { const ids = empty ? [] : v.split(',').map((s) => s.trim()).filter(Boolean); out[f.id] = { type: 'multiCollectionReference', value: ids }; break }
      default: out[f.id] = { type: 'string', value: v }
    }
  }
  return out
}

export type PushItem = { framerItemId: string | null; slug: string; values: Record<string, string> }

/** Voegt nieuwe items toe / werkt bestaande bij op het collectie-object.
 *  `addItems` met een `id` = bijwerken, zonder = nieuw. Geeft de nieuw
 *  aangemaakte Framer-item-id's terug (gekeyd op slug) door na te lezen. */
export async function pushItems(projectUrl: string, apiKey: string, collectionId: string, fields: FramerField[], items: PushItem[]): Promise<Record<string, string>> {
  return withFramer(projectUrl, apiKey, async (framer) => {
    const col = await findCollection(framer, collectionId)
    if (!col) throw new Error('Collectie niet gevonden in Framer')
    if (items.length === 0) return {}

    // Serialiseer met de LIVE veldtypes uit Framer: de opgeslagen fields
    // (cms_collections.fields) kunnen stale/fout zijn, waardoor een veld met een
    // verkeerd type wordt weggeschreven (bv. enum als image → object-waarde →
    // "Expected a valid enum case, got: [object Object]"). Live is de waarheid.
    let liveFields = fields
    try { const lf = fieldsFrom(await col.getFields?.()); if (lf.length) liveFields = lf } catch { /* val terug op opgeslagen fields */ }

    // Bij een schrijffout ook tonen WAT er verstuurd werd (per veld type+waarde),
    // zodat een resterend probleemveld meteen zichtbaar is in de foutmelding.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const describe = (fd: Record<string, any>) => Object.entries(fd)
      .map(([k, val]) => { const f = liveFields.find((x) => x.id === k); return `${f?.name ?? k}(${val?.type})=${typeof val?.value === 'object' ? JSON.stringify(val.value) : String(val?.value)}` })
      .join(', ')

    const updates = items.filter((i) => i.framerItemId)
    const adds = items.filter((i) => !i.framerItemId)

    // Bestaande items bijwerken via addItems MÉT id (bewezen schrijfweg — probe
    // toont dat addItems met de {type,value}-vorm persistent + niet-draft is).
    // Fallback per item via item.setAttributes() als addItems-met-id faalt.
    if (updates.length) {
      const payload = updates.map((u) => ({
        id: u.framerItemId as string,
        slug: u.slug || undefined,
        fieldData: buildFieldDataInput(liveFields, u.values),
      }))
      try {
        await col.addItems?.(payload)
      } catch (addErr) {
        const existing = (await col.getItems?.()) ?? []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const byId = new Map((existing as any[]).map((it) => [String(it.id ?? it.nodeId), it]))
        for (const u of updates) {
          const obj = byId.get(String(u.framerItemId))
          const fieldData = buildFieldDataInput(liveFields, u.values)
          if (obj?.setAttributes) await obj.setAttributes({ slug: u.slug || undefined, fieldData })
          else throw new Error(`${addErr instanceof Error ? addErr.message : 'schrijffout'} — verstuurd: ${describe(fieldData)}`)
        }
      }
    }

    // Nieuwe items toevoegen + hun Framer-item-id opzoeken via de slug.
    const newIds: Record<string, string> = {}
    if (adds.length) {
      const payload = adds.map((a) => ({ slug: a.slug, fieldData: buildFieldDataInput(liveFields, a.values) }))
      try {
        await col.addItems?.(payload)
      } catch (e) {
        throw new Error(`${e instanceof Error ? e.message : 'schrijffout'} — verstuurd: ${payload.map((p) => describe(p.fieldData)).join(' | ')}`)
      }
      const after = (await col.getItems?.()) ?? []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bySlug = new Map((after as any[]).map((it) => [String(it.slug), String(it.id ?? it.nodeId ?? '')]))
      for (const a of adds) { const nid = bySlug.get(a.slug); if (nid) newIds[a.slug] = nid }
    }
    return newIds
  })
}

// ── Veldbeheer (een echt CMS: velden toevoegen, hernoemen, verwijderen) ───────

export type NewFieldInput = { name: string; type: string; cases?: string[] }

/** Voegt nieuwe velden toe aan een Framer-collectie. Enum-velden krijgen hun
 *  keuze-opties mee; de overige types hebben enkel naam + type nodig. */
export async function addFields(projectUrl: string, apiKey: string, collectionId: string, fields: NewFieldInput[]): Promise<FramerField[]> {
  if (fields.length === 0) return []
  return withFramer(projectUrl, apiKey, async (framer) => {
    const col = await findCollection(framer, collectionId)
    if (!col) throw new Error('Collectie niet gevonden in Framer')
    if (typeof col.addFields !== 'function') throw new Error('Deze Framer-versie ondersteunt geen velden toevoegen')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any[] = fields.map((f) => {
      const base: Record<string, unknown> = { type: f.type, name: f.name }
      if (f.type === 'enum') base.cases = (f.cases ?? []).filter(Boolean).map((c) => ({ name: c }))
      return base
    })
    const created = await col.addFields(payload)
    return fieldsFrom(Array.isArray(created) ? created : [])
  })
}

/** Hernoemt één veld (via field.setAttributes). */
export async function renameField(projectUrl: string, apiKey: string, collectionId: string, fieldId: string, name: string): Promise<void> {
  return withFramer(projectUrl, apiKey, async (framer) => {
    const col = await findCollection(framer, collectionId)
    if (!col) throw new Error('Collectie niet gevonden in Framer')
    const all = (await col.getFields?.()) ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = (all as any[]).find((f) => String(f.id) === String(fieldId))
    if (!target) throw new Error('Veld niet gevonden')
    if (typeof target.setAttributes !== 'function') throw new Error('Dit veld kan niet hernoemd worden')
    await target.setAttributes({ name })
  })
}

/** Verwijdert velden uit een collectie (op veld-id). */
export async function removeFields(projectUrl: string, apiKey: string, collectionId: string, fieldIds: string[]): Promise<void> {
  if (fieldIds.length === 0) return
  return withFramer(projectUrl, apiKey, async (framer) => {
    const col = await findCollection(framer, collectionId)
    if (!col) throw new Error('Collectie niet gevonden in Framer')
    if (typeof col.removeFields === 'function') { await col.removeFields(fieldIds); return }
    // Fallback: per veld via field.remove()
    const all = (await col.getFields?.()) ?? []
    const ids = new Set(fieldIds.map(String))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of (all as any[]).filter((x) => ids.has(String(x.id)))) {
      if (typeof f.remove === 'function') await f.remove()
    }
  })
}

/** Verwijdert items uit een collectie op het collectie-object. Probeert eerst
 *  col.removeItems(ids); valt terug op item.remove() per gevonden item, zodat de
 *  verwijdering echt doorgaat ook als removeItems met de losse id's niets doet. */
export async function removeItems(projectUrl: string, apiKey: string, collectionId: string, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return
  return withFramer(projectUrl, apiKey, async (framer) => {
    const col = await findCollection(framer, collectionId)
    if (!col) return
    const idset = new Set(itemIds.map(String))
    const existing = (await col.getItems?.()) ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targets = (existing as any[]).filter((it) => idset.has(String(it.id ?? it.nodeId)))
    try {
      await col.removeItems?.(itemIds)
    } catch {
      // val terug op per-item verwijderen
    }
    // Controleer of ze weg zijn; zo niet, verwijder via item.remove().
    const still = (await col.getItems?.()) ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stillIds = new Set((still as any[]).map((it) => String(it.id ?? it.nodeId)))
    for (const it of targets) {
      if (stillIds.has(String(it.id ?? it.nodeId)) && typeof it.remove === 'function') {
        try { await it.remove() } catch { /* best-effort */ }
      }
    }
  })
}

/** Publiceert de wijzigingen naar de live Framer-website (publish → deploy). */
export async function publishSite(projectUrl: string, apiKey: string): Promise<{ ok: boolean; deploymentId?: string | null }> {
  return withFramer(projectUrl, apiKey, async (framer) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await framer.publish?.()
    const deploymentId: string | null = result?.deployment?.id ?? null
    if (deploymentId && typeof framer.deploy === 'function') {
      try { await framer.deploy(deploymentId) } catch { /* productie-deploy best-effort */ }
    }
    return { ok: true, deploymentId }
  })
}

/** Schrijf-probe: voegt in een bewerkbare collectie één TESTitem toe, leest het
 *  terug en ruimt het weer op. Probeert meerdere fieldData-vormen tot er één
 *  blijft plakken → zo weten we exact hoe Framer waarden verwacht (en of items
 *  als draft worden aangemaakt). Muteert enkel tijdelijk (add + remove), geen publish. */
export async function probeWriteFramer(projectUrl: string, apiKey: string, collectionId?: string) {
  return withFramer(projectUrl, apiKey, async (framer) => {
    const cols = (await framer.getCollections?.()) ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = cols as any[]
    const col = collectionId
      ? list.find((c) => String(c.id) === String(collectionId))
      : list.find((c) => c.readonly !== true) ?? list[0]
    if (!col) return { ok: false, error: 'Geen bewerkbare collectie gevonden' }

    const fields = fieldsFrom(await col.getFields?.())
    const textField = fields.find((f) => f.type === 'string') ?? fields.find((f) => f.type === 'formattedText') ?? fields[0]
    if (!textField) return { ok: false, error: 'Collectie heeft geen velden' }

    // Ruwe vorm van een BESTAAND item (canonieke read-shape + sleutels).
    const existing = (await col.getItems?.()) ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ex0 = (existing as any[])[0]
    const existingSample = ex0 ? { id: ex0.id, slug: ex0.slug, draft: ex0.draft, fieldDataKeys: Object.keys(ex0.fieldData ?? {}), fieldData: ex0.fieldData } : null

    const imageField = fields.find((f) => f.type === 'image')
    const isHtml = textField.type === 'formattedText'
    const textEntry = (val: string) => isHtml ? { type: 'formattedText', value: val, contentType: 'html' } : { type: textField.type, value: val }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = async () => ((await col.getItems?.()) ?? []) as any[]
    const steps: Array<Record<string, unknown>> = []
    const slug = `ngm-diag-${Date.now()}`
    let tempId: string | null = null

    // STAP 1 — nieuw item toevoegen (bewezen typed-vorm).
    const m1 = `NGM-ADD-${Date.now()}`
    try {
      await col.addItems?.([{ slug, fieldData: { [textField.id]: textEntry(m1) } }])
      const created = (await items()).find((it) => String(it.slug) === slug)
      tempId = created ? String(created.id ?? created.nodeId ?? '') : null
      steps.push({ step: 'add', persisted: created ? JSON.stringify(created.fieldData ?? {}).includes(m1) : false, draft: created?.draft, itemId: tempId })
    } catch (e) { steps.push({ step: 'add', error: String(e).slice(0, 300) }) }

    if (tempId) {
      // STAP 2a — bijwerken via addItems MÉT id.
      const m2 = `NGM-UPD-ADD-${Date.now()}`
      try {
        await col.addItems?.([{ id: tempId, fieldData: { [textField.id]: textEntry(m2) } }])
        const upd = (await items()).find((it) => String(it.id ?? it.nodeId) === tempId)
        steps.push({ step: 'update via addItems+id', applied: upd ? JSON.stringify(upd.fieldData ?? {}).includes(m2) : false })
      } catch (e) { steps.push({ step: 'update via addItems+id', error: String(e).slice(0, 300) }) }

      // STAP 2b — bijwerken via item.setAttributes().
      const m3 = `NGM-UPD-SET-${Date.now()}`
      try {
        const obj = (await items()).find((it) => String(it.id ?? it.nodeId) === tempId)
        if (obj?.setAttributes) {
          await obj.setAttributes({ fieldData: { [textField.id]: textEntry(m3) } })
          const upd = (await items()).find((it) => String(it.id ?? it.nodeId) === tempId)
          steps.push({ step: 'update via setAttributes', applied: upd ? JSON.stringify(upd.fieldData ?? {}).includes(m3) : false })
        } else steps.push({ step: 'update via setAttributes', skipped: 'setAttributes bestaat niet op item' })
      } catch (e) { steps.push({ step: 'update via setAttributes', error: String(e).slice(0, 300) }) }

      // STAP 3 — afbeelding-veld: welke value-vorm accepteert Framer?
      if (imageField && existingSample) {
        // Hergebruik een bestaande Framer-image-URL om zeker een geldige te hebben.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const exImg: any = (existingSample.fieldData as any)?.[imageField.id]?.value
        const testUrl = String(exImg?.url ?? 'https://framerusercontent.com/images/placeholder.png')
        const marker = testUrl.split('/').pop()
        for (const [name, val] of [['value:{url}', { url: testUrl }], ['value:string', testUrl]] as const) {
          try {
            await col.addItems?.([{ id: tempId, fieldData: { [imageField.id]: { type: 'image', value: val } } }])
            const upd = (await items()).find((it) => String(it.id ?? it.nodeId) === tempId)
            const iv = upd?.fieldData?.[imageField.id]
            steps.push({ step: `image ${name}`, readBack: iv ?? null, applied: iv ? JSON.stringify(iv).includes(String(marker)) : false })
          } catch (e) { steps.push({ step: `image ${name}`, error: String(e).slice(0, 300) }) }
        }
      }

      try { await col.removeItems?.([tempId]) } catch { /* opruimen best-effort */ }
    }

    return { ok: true, collection: { id: col.id, name: col.name, readonly: col.readonly }, textField, imageField: imageField ?? null, fields, existingSample, steps }
  })
}

/** Diagnose: probeert per collectie ELKE lees-methode (user + managed) en toont
 *  de ruwe respons/fout, zodat we exact zien wat werkt en hoe de velden/items
 *  serialiseren. */
export async function diagnoseFramer(projectUrl: string, apiKey: string) {
  return withFramer(projectUrl, apiKey, async (framer) => {
    // Welke methodes bestaan op deze framer-versie?
    const methodNames = ['getCollections', 'getCollectionFields', 'getCollectionFields2', 'getCollectionItems', 'getCollectionItems2', 'getManagedCollections', 'getManagedCollectionFields', 'getManagedCollectionFields2', 'getManagedCollectionItemIds', 'addCollectionItems2', 'setCollectionItemAttributes2', 'removeCollectionItems', 'publish', 'deploy']
    const methods: Record<string, boolean> = {}
    for (const m of methodNames) methods[m] = typeof framer[m] === 'function'

    const cols = (await framer.getCollections?.()) ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tryOne = async (fn: () => Promise<any>) => {
      try { const r = await fn(); return { ok: true, count: Array.isArray(r) ? r.length : undefined, sample: Array.isArray(r) ? r.slice(0, 2) : r } }
      catch (e) { return { ok: false, error: String(e).slice(0, 200) } }
    }

    const perCollection = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of cols as any[]) {
      // De echte methodes zitten op het collectie-OBJECT.
      perCollection.push({
        id: c.id, name: c.name, managedBy: c.managedBy, readonly: c.readonly, slugFieldName: c.slugFieldName,
        objectMethods: {
          getFields: typeof c.getFields === 'function',
          getItems: typeof c.getItems === 'function',
          addItems: typeof c.addItems === 'function',
          removeItems: typeof c.removeItems === 'function',
        },
        fields: await tryOne(() => c.getFields?.()),
        items: await tryOne(() => c.getItems?.()),
      })
    }

    return { methods, collectionCount: cols.length, collections: perCollection }
  })
}

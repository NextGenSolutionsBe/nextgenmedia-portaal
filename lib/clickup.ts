import { fetchMetLimiet, TijdslimietFout, STANDAARD_LIMIET_MS } from '@/lib/fetch-met-limiet'
import { createAdminSupabaseClient } from '@/lib/supabase/admin-client'

// ── ClickUp integratie (server-side only) ────────────────────────────────────
// App → ClickUp, één richting. Wordt UITSLUITEND server-side gebruikt; de API key
// komt enkel uit process.env.CLICKUP_API_KEY en mag nooit in client-code lekken.

const API_BASE = 'https://api.clickup.com/api/v2'

// Vaste omgeving (exact zoals aangeleverd)
export const CLICKUP_SPACE_ID = '90154938729' // NextGenMedia space

// Custom field IDs (workspace-breed, op alle lijsten aanwezig)
const FIELD = {
  caption: 'a5c04488-6da9-4f8f-ad62-75de0a088433',
  channel: '3a75dd8a-cbcc-41de-b02e-f602a4148419',
  link: '62b7394f-ae28-46f3-9ac1-dce63e3b38ed',
  publicatieDatum: '4e706dbc-6609-4d41-bdf5-d7b4baa5f0ef',
  sharedUrl: '9971653c-80c0-4775-acbd-e0545e080d20',
} as const

const CAPTION_OPTION = {
  af: '6eb2566a-fcc7-47d3-92b0-ca59b3adbd16',          // "Caption is af"
  nog: '26cfc2eb-840a-4ccf-8273-2a318ba5682a',         // "Caption nog schrijven"
} as const

const CHANNEL_OPTION = {
  facebook: '4958a028-e238-43e0-8fd6-044a20808e1a',
  twitter: '8c87acc5-c49d-4c34-8c58-4f2de80e6e89',
  youtube: '427cb857-2d58-4a9f-b959-f1f4309bf4c7',
  linkedin: '59c05846-9d4b-4ab9-9576-a5c89ce5d19f',
  instagram: '085dac55-cb72-4da7-a20d-56a85a5030b6',
  all: 'b8fb0948-8175-48f7-ab91-057624940068',
  email: '4ad93978-3ee7-4f9e-86d5-d14939f27264',
  google: 'f4fb9e74-489b-4aef-86e0-e9649e80f7be',
} as const

// ClickUp-statussen
const STATUS_NEW = 'to do'
const STATUS_DONE = 'complete'

// App-klantnaam → ClickUp-naam uitzonderingen
const NAME_EXCEPTIONS: Record<string, string> = {
  cash4goods: 'Cash4goods',
  core_tennis_camp: 'Core_Tennis_Camp',
}

export function clickupConfigured(): boolean {
  return !!process.env.CLICKUP_API_KEY
}

export function mapClientName(appName: string): string {
  const key = appName.trim().toLowerCase().replace(/\s+/g, '_')
  return NAME_EXCEPTIONS[key] ?? appName.trim()
}

// ── Titel / platform / field mapping ─────────────────────────────────────────

const CONTENT_TYPE_WORDS = ['reel', 'post', 'story', 'carousel']

/** Groepeer ruwe app-platformen naar ClickUp-labels (META/LINKEDIN/TIKTOK/…). */
function platformGroups(platforms: string[]): string[] {
  const norm = platforms.map((p) => p.trim().toLowerCase()).filter(Boolean)
  const groups: string[] = []
  const has = (p: string) => norm.includes(p)

  if (has('facebook') || has('instagram') || has('meta')) groups.push('META')
  if (has('linkedin')) groups.push('LINKEDIN')
  if (has('tiktok')) groups.push('TIKTOK')

  // Overige bekende kanalen, in voorkomende volgorde
  for (const p of norm) {
    if (['facebook', 'instagram', 'meta', 'linkedin', 'tiktok'].includes(p)) continue
    const label = p.toUpperCase()
    if (!groups.includes(label)) groups.push(label)
  }
  return groups
}

/** "(META & LINKEDIN)" — altijd hoofdletters, '&' als separator, tussen haakjes. */
export function formatPlatformSuffix(platforms: string[]): string {
  const groups = platformGroups(platforms)
  if (groups.length === 0) return '(ALL)'
  return `(${groups.join(' & ')})`
}

/** Strip een leidend contenttype-woord en een eventuele tijd-suffix ("— 14:00"). */
function cleanSubject(rawTitle: string, contentType: string): string {
  let s = (rawTitle ?? '').trim()
  // leidend type-woord weghalen (bv. "Post Welkom..." → "Welkom...")
  const lead = new RegExp(`^(${CONTENT_TYPE_WORDS.join('|')})\\b[\\s:–—-]*`, 'i')
  s = s.replace(lead, '')
  // ook het exacte contenttype (indien anders) vooraan weghalen
  if (contentType) {
    const t = new RegExp(`^${contentType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s:–—-]*`, 'i')
    s = s.replace(t, '')
  }
  // trailing tijd " — 14:00" / " - 14:00" / " 14:00"
  s = s.replace(/\s*[—–-]?\s*\d{1,2}[:.]\d{2}\s*$/, '')
  return s.replace(/\s+/g, ' ').trim()
}

/** [CONTENTTYPE] [onderwerp] ([PLATFORM(S)]) — exact schrijfwijze. */
export function buildTaskTitle(item: {
  content_type: string
  title: string
  platforms: string[]
}): string {
  const type = (item.content_type || 'post').trim().toUpperCase()
  const subject = cleanSubject(item.title, item.content_type)
  const suffix = formatPlatformSuffix(item.platforms)
  return [type, subject, suffix].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

/** Channel-dropdown optie: één groep → bijhorende optie, meerdere → All. */
export function channelOptionId(platforms: string[]): string {
  const groups = platformGroups(platforms)
  if (groups.length !== 1) return CHANNEL_OPTION.all
  switch (groups[0]) {
    case 'META': return CHANNEL_OPTION.instagram   // META only → Instagram option
    case 'LINKEDIN': return CHANNEL_OPTION.linkedin
    case 'TWITTER': return CHANNEL_OPTION.twitter
    case 'YOUTUBE': return CHANNEL_OPTION.youtube
    case 'GOOGLE': return CHANNEL_OPTION.google
    case 'EMAIL': return CHANNEL_OPTION.email
    default: return CHANNEL_OPTION.all             // o.a. TIKTOK heeft geen optie
  }
}

export function captionOptionId(caption: string | null | undefined): string {
  return caption && caption.trim() ? CAPTION_OPTION.af : CAPTION_OPTION.nog
}

export function statusFor(appStatus: string): string {
  return appStatus === 'published' ? STATUS_DONE : STATUS_NEW
}

/** planned_date (YYYY-MM-DD) → unix ms (noon UTC, voorkomt dag-shift). */
export function plannedDateMs(plannedDate: string): number {
  return Date.parse(`${plannedDate.slice(0, 10)}T12:00:00Z`)
}

/** Stabiele, lichte hash van de gesyncte velden (skip onnodige API-calls). */
export function syncHash(parts: {
  name: string; captionOpt: string; channelOpt: string; dateMs: number; status: string
}): string {
  const s = `${parts.name}|${parts.captionOpt}|${parts.channelOpt}|${parts.dateMs}|${parts.status}`
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// ── Rate-limited fetch (100 req/min) met exponential backoff bij 429 ──────────

let lastRequestAt = 0
const MIN_INTERVAL_MS = 650 // ~92 req/min, ruim onder de limiet
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Lezen bij ClickUp mag langer duren dan de standaard tien seconden.
 *
 * De agendasync haalt elke minuut de takenlijst op; die komt normaal in twee
 * tot vijf seconden binnen. Maar ClickUp heeft periodes waarin hij er elf tot
 * veertien over doet, en dan sloeg de sync stuk op een dienst die gewoon traag
 * was in plaats van kapot. Achttien seconden dekt wat we in de praktijk zien,
 * en blijft — ook mét één herkansing — ruim onder de zestig seconden die de
 * cronfunctie krijgt.
 *
 * SCHRIJVEN houdt de tien seconden. Een POST die blijft hangen mag je niet
 * zomaar laten doorlopen: dan weet je niet of de taak er nu wel of niet staat.
 */
const LEES_LIMIET_MS = 18_000

async function clickupFetch(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const key = process.env.CLICKUP_API_KEY
  if (!key) throw new Error('CLICKUP_API_KEY is niet ingesteld')

  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()

  const leesActie = !init.method || init.method.toUpperCase() === 'GET'

  let res: Response
  try {
    res = await fetchMetLimiet(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: key,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    }, leesActie ? LEES_LIMIET_MS : STANDAARD_LIMIET_MS)
  } catch (err) {
    /**
     * Een tijdslimiet is bij ClickUp een hikje, geen storing — net als de
     * SHARD-fout hieronder. Dit werd tot nu toe NIET opnieuw geprobeerd, want
     * fetchMetLimiet gooit vóór er een antwoord is en de herkansingen hieronder
     * kijken naar een statuscode. Eén trage minuut werd zo meteen een mislukte
     * run en een alarmmail.
     *
     * Enkel bij lezen. Een POST opnieuw sturen zou een tweede taak of een
     * tweede agenda-item kunnen maken, en dubbele afspraken zijn precies wat
     * deze sync moet voorkomen.
     */
    if (err instanceof TijdslimietFout && leesActie && attempt < 1) {
      await sleep(1000)
      return clickupFetch(path, init, attempt + 1)
    }
    throw err
  }

  if (res.status === 429 && attempt < 5) {
    const retryAfter = Number(res.headers.get('retry-after') ?? 0)
    const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempt * 1000, 16000)
    await sleep(backoff)
    return clickupFetch(path, init, attempt + 1)
  }

  /**
   * Hikjes aan de kant van ClickUp opnieuw proberen.
   *
   * Twee soorten. Een 5xx spreekt voor zich. En een 404 met ECODE "SHARD_…":
   * dat is géén ontbrekende taak maar een ClickUp-server die zijn eigen shard
   * even niet vindt — we zagen het op /team, waar niets kan ontbreken. Zo'n
   * antwoord komt bij de volgende poging gewoon goed.
   *
   * Alleen bij LEZEN. Een POST of PUT opnieuw sturen zou een tweede taak of een
   * tweede agenda-item kunnen maken, en dubbele afspraken zijn precies wat deze
   * sync moet voorkomen.
   */
  if (leesActie && attempt < 3) {
    const hikje = res.status >= 500
      || (res.status === 404 && /"ECODE"\s*:\s*"SHARD_/i.test(await res.clone().text().catch(() => '')))
    if (hikje) {
      await sleep(Math.min(2 ** attempt * 1000, 4000))
      return clickupFetch(path, init, attempt + 1)
    }
  }
  return res
}

async function clickupJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await clickupFetch(path, init)
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`ClickUp ${init?.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  }
  return text ? (JSON.parse(text) as T) : ({} as T)
}

// ── Folder / list resolutie ──────────────────────────────────────────────────

type CuList = { id: string; name: string }
type CuFolder = { id: string; name: string; lists?: CuList[] }

const isContentkalender = (name: string) => /contentkalender\s*$/i.test(name.trim())

export type ClientListRef = { folderId: string; listId: string }

/**
 * Zoek (of maak) de klantstructuur in de NextGenMedia-space en geef folder+list id.
 *   Space → Folder: [Klantnaam] → List: [Klantnaam] CONTENTKALENDER
 */
export async function findOrCreateClientList(appClientName: string): Promise<ClientListRef> {
  const name = mapClientName(appClientName)

  const { folders } = await clickupJson<{ folders: CuFolder[] }>(`/space/${CLICKUP_SPACE_ID}/folder`)
  const folder = (folders ?? []).find((f) => f.name.trim().toLowerCase() === name.toLowerCase())

  if (folder) {
    let list = (folder.lists ?? []).find((l) => isContentkalender(l.name))
    if (!list) {
      list = await clickupJson<CuList>(`/folder/${folder.id}/list`, {
        method: 'POST',
        body: JSON.stringify({ name: `${name} CONTENTKALENDER` }),
      })
    }
    return { folderId: folder.id, listId: list.id }
  }

  // Nieuwe structuur aanmaken: folder + algemene lijst + CONTENTKALENDER-lijst
  const newFolder = await clickupJson<CuFolder>(`/space/${CLICKUP_SPACE_ID}/folder`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  // Algemene lijst [Klantnaam] (best effort — niet kritisch voor de sync)
  try {
    await clickupJson<CuList>(`/folder/${newFolder.id}/list`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  } catch { /* niet fataal */ }

  const contentList = await clickupJson<CuList>(`/folder/${newFolder.id}/list`, {
    method: 'POST',
    body: JSON.stringify({ name: `${name} CONTENTKALENDER` }),
  })
  return { folderId: newFolder.id, listId: contentList.id }
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export type CuTask = {
  id: string
  name: string
  due_date?: string | null
  custom_fields?: Array<{ id: string; value?: unknown }>
}

/** Alle (open + gesloten) taken in een lijst ophalen, met paginatie. */
export async function fetchListTasks(listId: string): Promise<CuTask[]> {
  const out: CuTask[] = []
  for (let page = 0; page < 50; page++) {
    const data = await clickupJson<{ tasks: CuTask[]; last_page?: boolean }>(
      `/list/${listId}/task?archived=false&include_closed=true&subtasks=false&page=${page}`,
    )
    const tasks = data.tasks ?? []
    out.push(...tasks)
    if (data.last_page || tasks.length === 0) break
  }
  return out
}

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Datum van een bestaande taak: due_date, anders het Publicatie datum-veld. */
function taskDateMs(t: CuTask): number | null {
  if (t.due_date != null && String(t.due_date) !== '') return Number(t.due_date)
  const cf = t.custom_fields?.find((f) => f.id === FIELD.publicatieDatum)?.value
  return cf != null ? Number(cf) : null
}

/**
 * Zoek een bestaande taak om te 'adopteren' — STRIKT op naam ÉN datum.
 * Terugkerende content kan dezelfde titel hebben op verschillende datums; die
 * mogen NOOIT samenvallen op één taak. Geen datum-match → null (nieuwe taak).
 */
export function findTaskByNameAndDate(tasks: CuTask[], name: string, dateMs: number): CuTask | null {
  const target = normName(name)
  const SAME_DAY = 30 * 3600 * 1000 // ~1,25 dag tolerantie (TZ-ruis)
  const match = tasks.find((t) => {
    if (normName(t.name) !== target) return false
    const tms = taskDateMs(t)
    return tms != null && Math.abs(tms - dateMs) < SAME_DAY
  })
  return match ?? null
}

export type TaskFields = {
  name: string
  status: string
  dateMs: number
  captionOpt: string
  channelOpt: string
}

export type TaskResult = { id: string; fieldsBlocked: number }

/** Taak bestaat niet meer in ClickUp (verwijderd) → opnieuw aanmaken. */
export function isTaskGone(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  // 'Team not authorized' (OAUTH_027): de taak zit in een werkruimte waar de
  // sleutel niet (meer) bij kan — voor de sync is dat hetzelfde als weg.
  return /ITEM_013|task not found|not found, deleted|Team not authorized|OAUTH_027/i.test(m)
}

export type LijstToegang = 'ok' | 'weg' | 'fout'

/**
 * Is een opgeslagen lijst nog bereikbaar? 'weg' = verwijderd of in een
 * werkruimte waar de sleutel niet bij kan (dan moet de klantstructuur opnieuw
 * opgezocht worden); 'fout' = ClickUp tijdelijk onbereikbaar (niets veranderen).
 */
export async function lijstToegang(listId: string): Promise<LijstToegang> {
  try {
    await clickupJson(`/list/${listId}`)
    return 'ok'
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (/→\s*404\b|Team not authorized|OAUTH_027|→\s*401\b/.test(m)) return 'weg'
    return 'fout'
  }
}

/** Generieke 404 (bv. lijst verwijderd) → structuur opnieuw opbouwen. */
export function isNotFound(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /→\s*404\b/.test(m)
}

// We syncen bewust ALLEEN de titel (= WAT) + status + due_date (= WANNEER).
// Geen custom fields: die vallen onder de ClickUp-planlimiet (FIELD_033) en zijn
// niet nodig. due_date is een ingebouwd ClickUp-veld en telt NIET mee voor die
// limiet. fieldsBlocked blijft daarom altijd 0.

export async function createTask(listId: string, f: TaskFields): Promise<TaskResult> {
  const task = await clickupJson<{ id: string }>(`/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify({ name: f.name, status: f.status, due_date: f.dateMs }),
  })
  return { id: task.id, fieldsBlocked: 0 }
}

export async function updateTask(taskId: string, f: TaskFields): Promise<TaskResult> {
  await clickupJson(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: f.name, status: f.status, due_date: f.dateMs }),
  })
  return { id: taskId, fieldsBlocked: 0 }
}

/**
 * Verwijder een taak in ClickUp (spiegelt een verwijdering in de app).
 * Een reeds verwijderde/onbestaande taak is GEEN fout — dan is het doel al bereikt.
 * Geeft true als de taak weg is (of al weg was), false bij een echte API-fout.
 */
export async function deleteTask(taskId: string): Promise<boolean> {
  try {
    await clickupJson(`/task/${taskId}`, { method: 'DELETE' })
    return true
  } catch (e) {
    if (isTaskGone(e) || isNotFound(e)) return true // al weg = prima
    return false
  }
}

/**
 * Verwijder een volledige lijst in ClickUp (bv. de CONTENTKALENDER-lijst wanneer
 * een klant definitief verwijderd wordt) — in één call, incl. alle taken erin.
 * Best-effort: een reeds verwijderde lijst is geen fout.
 */
export async function deleteList(listId: string): Promise<boolean> {
  try {
    await clickupJson(`/list/${listId}`, { method: 'DELETE' })
    return true
  } catch (e) {
    if (isNotFound(e)) return true
    return false
  }
}

// ── Facturen → ClickUp (best-effort, breekt nooit de facturatie-flow) ─────────
// Bij het aanmaken van een factuur wordt een taak "Factuur versturen — [Klant]"
// gemaakt en toegewezen aan Bram Reinquin; bij status 'verstuurd' → Completed.

const INVOICE_LIST_NAME = 'Facturen'
const INVOICE_ASSIGNEE = 'Bram Reinquin'

type CuMemberUser = { id: number; username?: string | null; email?: string | null }

/** Zoekt het ClickUp-gebruikers-id op naam (of e-mail), workspace-breed. */
export async function findMemberId(name: string): Promise<number | null> {
  const want = name.trim().toLowerCase()
  if (!want) return null
  const leden = await listClickupMembers().catch(() => [] as ClickupMember[])
  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()
  // 1. Exacte naam of exact e-mailadres.
  const exact = leden.find((m) => norm(m.username) === want || norm(m.email) === want)
  if (exact) return exact.id
  // 2. Voornaam + achternaam als losse woorden in de gebruikersnaam (bv. "Bram R." vs "Bram Reinquin").
  const woorden = want.split(/\s+/).filter(Boolean)
  const perWoord = leden.filter((m) => { const u = norm(m.username); return woorden.every((w) => u.includes(w)) })
  if (perWoord.length === 1) return perWoord[0].id
  // 3. Deeltreffer op naam of e-mail — enkel wanneer er precies één kandidaat is,
  //    anders liever geen verantwoordelijke dan de verkeerde.
  const los = leden.filter((m) => { const u = norm(m.username), e = norm(m.email); return (u && (u.includes(want) || want.includes(u))) || (e && e.startsWith(woorden[0] ?? want)) })
  return los.length === 1 ? los[0].id : null
}

/** Vindt (of maakt) de folderloze lijst "Facturen" in de NextGenMedia-space. */
async function findOrCreateInvoiceList(): Promise<string | null> {
  try {
    const { lists } = await clickupJson<{ lists: CuList[] }>(`/space/${CLICKUP_SPACE_ID}/list`)
    const existing = (lists ?? []).find((l) => l.name.trim().toLowerCase() === INVOICE_LIST_NAME.toLowerCase())
    if (existing) return existing.id
    const created = await clickupJson<CuList>(`/space/${CLICKUP_SPACE_ID}/list`, { method: 'POST', body: JSON.stringify({ name: INVOICE_LIST_NAME }) })
    return created.id
  } catch { return null }
}

// ── De vaste facturatielijst (Bram Reinquin (Growth) → Facturen & Boekhouding → List) ──
//
// Facturatietaken horen op precies één plek. Die plek wordt met haar unieke
// lijst-id ingesteld (env CLICKUP_INVOICING_LIST_ID) en bij gebruik geverifieerd
// tegen de verwachte structuur: klopt space, folder of lijstnaam niet, dan is
// dat een configuratiefout en wordt er NIETS aangemaakt — nooit ergens anders,
// nooit in een nieuwe lijst, nooit op naam gezocht.

export const INVOICING_LIST_ENV = 'CLICKUP_INVOICING_LIST_ID'
export const INVOICING_ASSIGNEE_ENV = 'CLICKUP_INVOICING_ASSIGNEE_ID'
export const VERWACHTE_FACTURATIELOCATIE = { space: 'Bram Reinquin (Growth)', folder: 'Facturen & Boekhouding', list: 'List' } as const

export type FacturatieLijst =
  | { ok: true; listId: string; pad: string; url: string }
  | { ok: false; reden: string; ingesteld: boolean }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
let facturatieLijstCache: { id: string; tot: number; resultaat: FacturatieLijst } | null = null

/**
 * Overschrijving uit Instellingen → Facturatie-instellingen (app_settings,
 * sleutel 'facturatie'). Leeg = de omgevingsvariabele geldt. De waarde komt
 * daar enkel terecht ná een geslaagde structuurcontrole én bevestiging.
 */
async function facturatieOverschrijving(): Promise<{ lijstId: string; assigneeId: string; syncAan: boolean }> {
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('app_settings').select('value').eq('key', 'facturatie').maybeSingle()
    const v = (data?.value ?? {}) as { clickup_lijst_id?: unknown; clickup_assignee_id?: unknown; clickup_sync_aan?: unknown }
    return {
      lijstId: typeof v.clickup_lijst_id === 'string' ? v.clickup_lijst_id.trim() : '',
      assigneeId: typeof v.clickup_assignee_id === 'string' ? v.clickup_assignee_id.trim() : '',
      // Standaard aan; enkel een uitdrukkelijke 'false' zet de facturatietaken uit.
      syncAan: v.clickup_sync_aan !== false,
    }
  } catch { return { lijstId: '', assigneeId: '', syncAan: true } }
}

/** Staat "Facturatietaken naar ClickUp sturen" aan (Instellingen → Facturatie)? */
export async function facturatieSyncAan(): Promise<boolean> {
  return (await facturatieOverschrijving()).syncAan
}

/** Is de vaste facturatielijst ingesteld (env of instellingen)? Zegt niets over geldigheid. */
export async function facturatieLijstIngesteld(): Promise<boolean> {
  if ((process.env[INVOICING_LIST_ENV] ?? '').trim()) return true
  return !!(await facturatieOverschrijving()).lijstId
}

export type LijstControle = {
  ok: boolean; listId: string; workspace: string; space: string; folder: string; list: string; pad: string; url: string
  afwijkingen: string[]
}

/**
 * Haalt de structuur van een lijst op (workspace → space → folder → lijst) en
 * vergelijkt ze met de verwachte locatie. Leest enkel; maakt of verplaatst
 * nooit iets. Gooit bij een onbekend id of onbereikbare ClickUp.
 */
export async function controleerFacturatieLijst(id: string): Promise<LijstControle> {
  if (!/^\d+$/.test(id)) throw new Error('Geen geldig ClickUp lijst-id (enkel cijfers).')
  if (!clickupConfigured()) throw new Error('CLICKUP_API_KEY is niet ingesteld.')
  const lijst = await clickupJson<{ id: string; name: string; folder?: { id: string; name: string; hidden?: boolean } | null; space?: { id: string; name?: string } | null }>(`/list/${id}`)
  const folderNaam = lijst.folder && !lijst.folder.hidden ? lijst.folder.name : ''
  let spaceNaam = lijst.space?.name ?? ''
  if (!spaceNaam && lijst.space?.id) {
    const space = await clickupJson<{ id: string; name: string }>(`/space/${lijst.space.id}`)
    spaceNaam = space.name
  }
  const team = await clickupJson<{ teams: Array<{ id: string; name: string }> }>(`/team`).then((r) => r.teams?.[0] ?? null).catch(() => null)
  const pad = `${team?.name ?? '?'} → ${spaceNaam || '?'} → ${folderNaam || '(geen folder)'} → ${lijst.name}`
  const afwijkingen: string[] = []
  if (norm(spaceNaam) !== norm(VERWACHTE_FACTURATIELOCATIE.space)) afwijkingen.push(`space is "${spaceNaam || '?'}" i.p.v. "${VERWACHTE_FACTURATIELOCATIE.space}"`)
  if (norm(folderNaam) !== norm(VERWACHTE_FACTURATIELOCATIE.folder)) afwijkingen.push(`folder is "${folderNaam || 'geen'}" i.p.v. "${VERWACHTE_FACTURATIELOCATIE.folder}"`)
  if (norm(lijst.name) !== norm(VERWACHTE_FACTURATIELOCATIE.list)) afwijkingen.push(`lijst heet "${lijst.name}" i.p.v. "${VERWACHTE_FACTURATIELOCATIE.list}"`)
  return {
    ok: afwijkingen.length === 0, listId: lijst.id, workspace: team?.name ?? '', space: spaceNaam, folder: folderNaam, list: lijst.name, pad,
    url: team ? `https://app.clickup.com/${team.id}/v/l/li/${lijst.id}` : `https://app.clickup.com/v/l/li/${lijst.id}`,
    afwijkingen,
  }
}

/**
 * Haalt de ingestelde lijst op en controleert dat ze werkelijk onder
 * Bram Reinquin (Growth) → Facturen & Boekhouding → List hangt.
 * Een goed resultaat wordt 10 minuten onthouden; een fout één minuut, zodat
 * een herstelde configuratie snel doorwerkt zonder ClickUp te overvragen.
 */
export async function facturatieLijst(): Promise<FacturatieLijst> {
  const over = await facturatieOverschrijving()
  if (!over.syncAan) return { ok: false, ingesteld: true, reden: 'De ClickUp-synchronisatie voor facturatie staat uit (Instellingen → Facturatie-instellingen).' }
  const id = over.lijstId || (process.env[INVOICING_LIST_ENV] ?? '').trim()
  if (!id) return { ok: false, ingesteld: false, reden: `${INVOICING_LIST_ENV} is niet ingesteld. Vul het lijst-id van "${VERWACHTE_FACTURATIELOCATIE.folder} → ${VERWACHTE_FACTURATIELOCATIE.list}" in (omgeving of Instellingen → Facturatie).` }
  if (!/^\d+$/.test(id)) return { ok: false, ingesteld: true, reden: `${INVOICING_LIST_ENV} is geen geldig ClickUp lijst-id (enkel cijfers).` }
  if (!clickupConfigured()) return { ok: false, ingesteld: true, reden: 'CLICKUP_API_KEY is niet ingesteld.' }
  if (facturatieLijstCache && facturatieLijstCache.id === id && facturatieLijstCache.tot > Date.now()) return facturatieLijstCache.resultaat

  const onthoud = (r: FacturatieLijst): FacturatieLijst => {
    facturatieLijstCache = { id, tot: Date.now() + (r.ok ? 10 * 60_000 : 60_000), resultaat: r }
    return r
  }
  try {
    const c = await controleerFacturatieLijst(id)
    if (!c.ok) {
      return onthoud({ ok: false, ingesteld: true, reden: `Lijst ${id} staat op "${c.pad}" — ${c.afwijkingen.join('; ')}. Er worden geen taken aangemaakt tot dit klopt.` })
    }
    return onthoud({ ok: true, listId: c.listId, pad: c.pad, url: c.url })
  } catch (e) {
    // Onbereikbaar of onbekend id: geen taak, wel een duidelijke reden.
    const boodschap = e instanceof Error ? e.message : String(e)
    return onthoud({ ok: false, ingesteld: true, reden: /→ 404/.test(boodschap) ? `Lijst ${id} bestaat niet (of de API-sleutel heeft er geen toegang toe).` : `ClickUp niet bereikbaar: ${boodschap.slice(0, 200)}` })
  }
}

/** Het ingestelde assignee-id voor facturatietaken (instellingen vóór env); leeg = taak zonder verantwoordelijke. */
export async function facturatieAssigneeId(): Promise<number | null> {
  const over = await facturatieOverschrijving()
  const v = over.assigneeId || (process.env[INVOICING_ASSIGNEE_ENV] ?? '').trim()
  return /^\d+$/.test(v) ? Number(v) : null
}

/** Verbindingstest voor Instellingen → Integraties. Geeft nooit de sleutel terug. */
export async function clickupTest(): Promise<{ gebruiker: string; workspace: string }> {
  const u = await clickupJson<{ user?: { username?: string; email?: string } }>(`/user`)
  const t = await clickupJson<{ teams?: Array<{ name: string }> }>(`/team`).catch(() => ({ teams: [] as Array<{ name: string }> }))
  return { gebruiker: u.user?.username || u.user?.email || '?', workspace: t.teams?.[0]?.name ?? '?' }
}

export type OpdrachtTaak = {
  naam: string
  beschrijving: string
  /** YYYY-MM-DD: de dag waarop de factuur verstuurd moet zijn. */
  deadline: string
  /** High wanneer de factuur vandaag of binnen twee werkdagen weg moet. */
  hoog: boolean
}

function opdrachtTaakBody(t: OpdrachtTaak, nieuw: boolean, assignee: number | null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: t.naam, description: t.beschrijving,
    // ClickUp: 1 = urgent, 2 = high, 3 = normal, 4 = low
    priority: t.hoog ? 2 : 3,
  }
  const due = Date.parse(`${t.deadline}T12:00:00Z`)
  if (!Number.isNaN(due)) { body.due_date = due; body.due_date_time = false }
  if (nieuw) {
    body.status = STATUS_NEW
    if (assignee) body.assignees = [assignee]
  } else if (assignee) {
    body.assignees = { add: [assignee] }
  }
  return body
}

/**
 * Maakt de taak voor één facturatieopdracht in de vaste facturatielijst.
 * Gooit een fout (met reden) als de lijst niet ingesteld/geldig/bereikbaar is,
 * zodat de aanroeper de synchronisatie als "mislukt" kan registreren en later
 * opnieuw kan proberen — zónder dat er ergens anders een taak belandt.
 */
export async function maakOpdrachtTaak(t: OpdrachtTaak): Promise<{ taskId: string; url: string }> {
  const lijst = await facturatieLijst()
  if (!lijst.ok) throw new Error(lijst.reden)
  const task = await clickupJson<{ id: string; url?: string }>(`/list/${lijst.listId}/task`, { method: 'POST', body: JSON.stringify(opdrachtTaakBody(t, true, await facturatieAssigneeId())) })
  return { taskId: task.id, url: task.url ?? `https://app.clickup.com/t/${task.id}` }
}

/** Werkt een bestaande opdrachttaak bij (naam, omschrijving, deadline, prioriteit). */
export async function werkOpdrachtTaakBij(taskId: string, t: OpdrachtTaak): Promise<void> {
  await clickupJson(`/task/${taskId}`, { method: 'PUT', body: JSON.stringify(opdrachtTaakBody(t, false, await facturatieAssigneeId())) })
}

/** Bestaat de taak nog in ClickUp? (Voor "opnieuw synchroniseren" zonder dubbels.) */
export async function opdrachtTaakBestaat(taskId: string): Promise<boolean> {
  try { await clickupJson(`/task/${taskId}`); return true } catch (e) { if (isTaskGone(e)) return false; throw e }
}

export type InvoiceTaskInput = {
  clientName: string; amountIncl: number; invoiceDate: string; dueDate?: string | null; type: string
  /** Eigen titel; leeg = "Factuur versturen — [naam]". Gebruikt voor
   *  afrekeningen die WIJ moeten betalen in plaats van versturen. */
  title?: string
}

export type InvoiceTaskResult = { taskId: string | null; assigneeFound: boolean }

/** Maakt de "Factuur versturen"-taak (best-effort). Geeft taak-id + of de
 *  assignee (Bram Reinquin) gevonden is, zodat de app kan waarschuwen. */
export async function createInvoiceTask(input: InvoiceTaskInput): Promise<InvoiceTaskResult> {
  if (!clickupConfigured()) return { taskId: null, assigneeFound: true } // geen ClickUp = geen waarschuwing
  if (!(await facturatieSyncAan())) return { taskId: null, assigneeFound: true } // bewust uitgezet in Instellingen
  try {
    // Is de vaste facturatielijst ingesteld, dan gaan ÁLLE factuurtaken daarheen
    // (Bram Reinquin (Growth) → Facturen & Boekhouding → List). Klopt die
    // configuratie niet, dan liever geen taak dan een taak op de verkeerde plek.
    let listId: string | null
    if (await facturatieLijstIngesteld()) {
      const lijst = await facturatieLijst()
      if (!lijst.ok) { console.error('[clickup] factuurtaak niet aangemaakt:', lijst.reden); return { taskId: null, assigneeFound: true } }
      listId = lijst.listId
    } else {
      listId = await findOrCreateInvoiceList()
    }
    if (!listId) return { taskId: null, assigneeFound: true }
    const assignee = await findMemberId(INVOICE_ASSIGNEE)
    const desc = [
      `Klant: ${input.clientName}`,
      `Bedrag: € ${input.amountIncl.toFixed(2)} incl. btw`,
      `Factuurdatum: ${input.invoiceDate}`,
      input.dueDate ? `Vervaldatum: ${input.dueDate}` : null,
      `Type: ${input.type}`,
    ].filter(Boolean).join('\n')
    const body: Record<string, unknown> = {
      name: input.title || `Factuur versturen — ${input.clientName}`,
      description: desc, status: STATUS_NEW,
    }
    if (assignee) body.assignees = [assignee]
    const due = Date.parse(`${input.invoiceDate}T12:00:00Z`)
    if (!Number.isNaN(due)) body.due_date = due
    const task = await clickupJson<{ id: string }>(`/list/${listId}/task`, { method: 'POST', body: JSON.stringify(body) })
    return { taskId: task.id, assigneeFound: assignee != null }
  } catch { return { taskId: null, assigneeFound: true } }
}

/** Naam van de factuur-assignee, voor waarschuwingen in de UI. */
export const INVOICE_ASSIGNEE_NAME = INVOICE_ASSIGNEE

/** Zet de factuurtaak op Completed (status 'verstuurd' in de app). */
export async function completeInvoiceTask(taskId: string): Promise<void> {
  try { await clickupJson(`/task/${taskId}`, { method: 'PUT', body: JSON.stringify({ status: STATUS_DONE }) }) } catch { /* best-effort */ }
}

// ── Opdrachten (partner-assignments) → ClickUp ───────────────────────────────
const ASSIGNMENT_LIST_NAME = 'Opdrachten'

export type ClickupMember = { id: number; username: string; email: string }

/** Alle ClickUp-leden (voor naam-matching, o.a. via AI). */
export async function listClickupMembers(): Promise<ClickupMember[]> {
  if (!clickupConfigured()) return []
  try {
    const { teams } = await clickupJson<{ teams: Array<{ members: Array<{ user: CuMemberUser }> }> }>(`/team`)
    const out: ClickupMember[] = []
    const seen = new Set<number>()
    for (const t of teams ?? []) for (const m of t.members ?? []) {
      const u = m.user
      if (u?.id == null || seen.has(u.id)) continue
      seen.add(u.id)
      out.push({ id: u.id, username: (u.username ?? '').trim(), email: (u.email ?? '').trim() })
    }
    return out
  } catch { return [] }
}

async function findOrCreateAssignmentList(): Promise<string | null> {
  try {
    const { lists } = await clickupJson<{ lists: CuList[] }>(`/space/${CLICKUP_SPACE_ID}/list`)
    const existing = (lists ?? []).find((l) => l.name.trim().toLowerCase() === ASSIGNMENT_LIST_NAME.toLowerCase())
    if (existing) return existing.id
    const created = await clickupJson<CuList>(`/space/${CLICKUP_SPACE_ID}/list`, { method: 'POST', body: JSON.stringify({ name: ASSIGNMENT_LIST_NAME }) })
    return created.id
  } catch { return null }
}

export type AssignmentTaskInput = {
  title: string; description?: string | null; clientName?: string | null
  roles?: string[]; budget?: number | null; deadline?: string | null; assigneeId?: number | null
}
export type AssignmentTaskResult = { taskId: string | null; ok: boolean; error?: string }

/** Maakt (of werkt bij) de opdracht-taak in de lijst "Opdrachten". Best-effort. */
export async function upsertAssignmentTask(input: AssignmentTaskInput, existingTaskId?: string | null): Promise<AssignmentTaskResult> {
  if (!clickupConfigured()) return { taskId: existingTaskId ?? null, ok: false, error: 'ClickUp niet geconfigureerd' }
  try {
    const desc = [
      input.clientName ? `Klant: ${input.clientName}` : null,
      input.roles?.length ? `Rollen: ${input.roles.join(', ')}` : null,
      input.budget != null ? `Budget: € ${Number(input.budget).toFixed(2)}` : null,
      input.description ? `\n${input.description}` : null,
    ].filter(Boolean).join('\n')
    const body: Record<string, unknown> = { name: input.title, description: desc }
    if (input.assigneeId != null) body.assignees = existingTaskId ? { add: [input.assigneeId] } : [input.assigneeId]
    if (input.deadline) { const d = Date.parse(`${input.deadline}T12:00:00Z`); if (!Number.isNaN(d)) body.due_date = d }

    if (existingTaskId) {
      await clickupJson(`/task/${existingTaskId}`, { method: 'PUT', body: JSON.stringify(body) })
      return { taskId: existingTaskId, ok: true }
    }
    const listId = await findOrCreateAssignmentList()
    if (!listId) return { taskId: null, ok: false, error: 'Lijst "Opdrachten" niet gevonden' }
    body.status = STATUS_NEW
    const task = await clickupJson<{ id: string }>(`/list/${listId}/task`, { method: 'POST', body: JSON.stringify(body) })
    return { taskId: task.id, ok: true }
  } catch (e) { return { taskId: existingTaskId ?? null, ok: false, error: e instanceof Error ? e.message : 'ClickUp-fout' } }
}

// ── Verkoopafspraken → ClickUp ───────────────────────────────────────────────
//
// Elke geboekte afspraak wordt gespiegeld als taak in de "agenda"-lijst van
// het merk (NextGenMedia of NextGenSolutions), toegewezen aan de closer van
// die agenda (Bram of Marco). Beheer blijft in ClickUp — de invite naar de
// prospect gaat via Google Calendar, maar het team kijkt in ClickUp.
//
// Alles hier is BEST-EFFORT voor de oproeper: een boeking mag nooit stuklopen
// omdat ClickUp even hapert. De oproeper vangt fouten en toont een waarschuwing.

export type AfspraakTaak = {
  naam: string
  omschrijving: string
  /** Begin van de afspraak (ms sinds epoch) — wordt de starttijd van de taak. */
  startMs: number
  /**
   * Einde van de afspraak — wordt de due date. Zonder eindtijd toonde ClickUp
   * één los momentje op het beginuur in plaats van een blok van-tot, en zou
   * een ClickUp→Google-synchronisatie het uur ook verkeerd neerzetten.
   */
  eindMs: number
  /** ClickUp-lid dat toegewezen wordt; null = niemand toewijzen. */
  assigneeId: number | null
}

/** De tijdvelden van een afspraaktaak: loopt van start tot einde, mét uren. */
function afspraakTijden(t: Pick<AfspraakTaak, 'startMs' | 'eindMs'>): Record<string, unknown> {
  return {
    start_date: t.startMs, start_date_time: true,
    due_date: t.eindMs, due_date_time: true,
  }
}

export async function maakAfspraakTaak(listId: string, t: AfspraakTaak): Promise<string> {
  const body: Record<string, unknown> = {
    name: t.naam,
    description: t.omschrijving,
    ...afspraakTijden(t),
  }
  if (t.assigneeId) body.assignees = [t.assigneeId]
  const task = await clickupJson<{ id: string }>(`/list/${listId}/task`, {
    method: 'POST', body: JSON.stringify(body),
  })
  return task.id
}

/** Naam/omschrijving/tijdstip bijwerken (verzetten, andere lead). */
export async function werkAfspraakTaakBij(taskId: string, t: Omit<AfspraakTaak, 'assigneeId'>): Promise<void> {
  await clickupJson(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: t.naam, description: t.omschrijving, ...afspraakTijden(t) }),
  })
}

/**
 * Taak sluiten bij annulering. We VERWIJDEREN bewust niet: een spoorloos
 * verdwenen taak roept vragen op ("stond hier niet iets?"), een taak met
 * [GEANNULEERD] ervoor en de status dicht vertelt wat er gebeurd is.
 * De sluitstatus verschilt per lijst, dus we vragen hem op.
 */
export async function annuleerAfspraakTaak(taskId: string): Promise<void> {
  const task = await clickupJson<{ name?: string; list?: { id?: string } }>(`/task/${taskId}`)
  let dicht: string | null = null
  if (task.list?.id) {
    try {
      const lijst = await clickupJson<{ statuses?: { status: string; type: string }[] }>(`/list/${task.list.id}`)
      dicht = (lijst.statuses ?? []).find((s) => s.type === 'closed')?.status ?? null
    } catch { /* geen statussen op te vragen → enkel hernoemen */ }
  }
  const naam = String(task.name ?? '').replace(/^\[GEANNULEERD\]\s*/, '')
  await clickupJson(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: `[GEANNULEERD] ${naam}`, ...(dicht ? { status: dicht } : {}) }),
  })
}

export type ClickupLijst = { id: string; naam: string; pad: string }

/**
 * Alle lijsten van de hele werkruimte, met hun pad (space / folder / lijst).
 * Voor de instellingen-dropdown "in welke ClickUp-lijst komen de afspraken van
 * dit merk". Best-effort: zonder sleutel of bij een fout een lege lijst.
 */
export async function listAlleLijsten(): Promise<ClickupLijst[]> {
  if (!clickupConfigured()) return []
  try {
    const { teams } = await clickupJson<{ teams: Array<{ id: string }> }>(`/team`)
    const uit: ClickupLijst[] = []
    for (const team of teams ?? []) {
      const { spaces } = await clickupJson<{ spaces: Array<{ id: string; name: string }> }>(`/team/${team.id}/space?archived=false`)
      for (const space of spaces ?? []) {
        const [{ folders }, { lists: los }] = await Promise.all([
          clickupJson<{ folders: Array<{ id: string; name: string; lists?: CuList[] }> }>(`/space/${space.id}/folder?archived=false`),
          clickupJson<{ lists: CuList[] }>(`/space/${space.id}/list?archived=false`),
        ])
        for (const f of folders ?? []) {
          for (const l of f.lists ?? []) uit.push({ id: l.id, naam: l.name, pad: `${space.name} / ${f.name} / ${l.name}` })
        }
        for (const l of los ?? []) uit.push({ id: l.id, naam: l.name, pad: `${space.name} / ${l.name}` })
      }
    }
    return uit
  } catch { return [] }
}

// ── Taken lezen voor de agenda-sync (ClickUp → Google Calendar) ──────────────

export type SyncTaak = {
  id: string
  naam: string
  /** ClickUp-leden op de taak. */
  assigneeIds: number[]
  startMs: number | null
  dueMs: number
  url: string
  lijstNaam: string
}

/** Het (enige) team-id van de werkruimte. */
async function teamId(): Promise<string> {
  const { teams } = await clickupJson<{ teams: Array<{ id: string }> }>(`/team`)
  const id = teams?.[0]?.id
  if (!id) throw new Error('Geen ClickUp-werkruimte gevonden')
  return id
}

/**
 * Alle OPEN taken met een deadline binnen het venster, toegewezen aan één van
 * de opgegeven leden. Gesloten taken blijven bewust buiten beeld: wat af is
 * hoeft niemands agenda meer te blokkeren — de sync ruimt het event dan op.
 */
export async function haalSyncTaken(
  assigneeIds: number[], vanMs: number, totMs: number,
): Promise<SyncTaak[]> {
  if (!clickupConfigured() || assigneeIds.length === 0) return []
  const team = await teamId()
  const uit: SyncTaak[] = []

  // ClickUp pagineert per 100; het vangnet van 10 pagina's is ver boven wat
  // twee agenda's aan taken kunnen dragen.
  for (let page = 0; page < 10; page++) {
    const p = new URLSearchParams({
      page: String(page),
      due_date_gt: String(vanMs),
      due_date_lt: String(totMs),
      include_closed: 'false',
      subtasks: 'true',
    })
    for (const a of assigneeIds) p.append('assignees[]', String(a))

    const { tasks } = await clickupJson<{ tasks: Array<{
      id: string; name: string; due_date: string | null; start_date: string | null
      url: string; assignees?: Array<{ id: number }>; list?: { name?: string }
    }> }>(`/team/${team}/task?${p}`)

    for (const t of tasks ?? []) {
      const due = Number(t.due_date)
      if (!Number.isFinite(due) || due <= 0) continue
      uit.push({
        id: t.id,
        naam: t.name,
        assigneeIds: (t.assignees ?? []).map((x) => x.id),
        startMs: t.start_date ? Number(t.start_date) : null,
        dueMs: due,
        url: t.url,
        lijstNaam: t.list?.name ?? '',
      })
    }
    if ((tasks ?? []).length < 100) break
  }
  return uit
}

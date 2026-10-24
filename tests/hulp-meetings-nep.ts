// Nagebootste omgeving voor tests/klantmeetings-orkestratie.test.ts:
// een databank in het geheugen (zelfde unieke indexen als de migratie) en
// nep-API's voor Google Calendar, ClickUp en Resend via een eigen fetch.
// Moet als EERSTE geïmporteerd worden: vervangt server-only modules.

/* eslint-disable @typescript-eslint/no-explicit-any */
import Module from 'module'
import { randomUUID } from 'crypto'

type Rij = Record<string, any>

// ── Databank ─────────────────────────────────────────────────────────────────

export const tabellen: Record<string, Rij[]> = {
  klant_meetings: [], klant_meeting_herinneringen: [], email_messages: [], sales_calendar_connections: [], sales_pipelines: [],
}

const STANDAARD: Record<string, () => Rij> = {
  klant_meetings: () => ({
    bron: 'intern', status: 'ingepland', tijdzone: 'Europe/Brussels', klant_ontvangers: [], deelnemers: [], herinnering_aan: true,
    google_status: 'wacht', clickup_status: 'wacht', google_event_id: null, google_calendar_id: null, meet_url: null, google_fout: null,
    clickup_task_id: null, clickup_list_id: null, clickup_fout: null, clickup_gestart_op: null, geannuleerd_op: null, geannuleerd_door: null,
  }),
  klant_meeting_herinneringen: () => ({ meeting_id: null, afspraak_id: null, status: 'gepland', pogingen: 0, provider_id: null, email_message_id: null, fout: null, bezig_sinds: null, verzonden_op: null, geannuleerd_op: null }),
}

function botsing(tabel: string, rijen: Rij[]): string | null {
  const uniek = (veld: string, filter: (r: Rij) => boolean = (r) => r[veld] != null) => {
    const w = rijen.filter(filter).map((r) => r[veld])
    return new Set(w).size !== w.length
  }
  if (tabel === 'klant_meetings' && uniek('aanvraag_sleutel')) return 'klant_meetings_aanvraag_uniek'
  if (tabel === 'klant_meetings') {
    const w = rijen.filter((r) => r.bron === 'klantboeking' && r.status === 'ingepland').map((r) => `${r.agenda_id}|${new Date(r.starts_at).toISOString()}`)
    if (new Set(w).size !== w.length) return 'klant_meetings_klantslot'
    const t = rijen.filter((r) => r.beheer_token_hash).map((r) => r.beheer_token_hash)
    if (new Set(t).size !== t.length) return 'klant_meetings_beheer_token'
  }
  if (tabel === 'klant_meeting_herinneringen') {
    if (uniek('verzend_sleutel')) return 'klant_meeting_herinnering_sleutel'
    if (uniek('meeting_id', (r) => ['gepland', 'bezig', 'mislukt'].includes(r.status))) return 'klant_meeting_herinnering_actief'
  }
  if (tabel === 'email_messages' && uniek('verzend_sleutel')) return 'email_messages_verzend_sleutel_uniek'
  return null
}

/** PostgREST-filter zoals in .or('a.eq.x,and(b.lt."…",c.eq.y)'). */
function parseOf(s: string): (r: Rij) => boolean {
  let i = 0
  const lijst = (): ((r: Rij) => boolean)[] => {
    const uit: ((r: Rij) => boolean)[] = []
    for (;;) {
      uit.push(item())
      if (s[i] === ',') { i++; continue }
      return uit
    }
  }
  const item = (): ((r: Rij) => boolean) => {
    for (const soort of ['and', 'or'] as const) {
      if (s.startsWith(`${soort}(`, i)) {
        i += soort.length + 1
        const delen = lijst()
        if (s[i] !== ')') throw new Error(`Filter: ')' verwacht in ${s}`)
        i++
        return soort === 'and' ? (r) => delen.every((f) => f(r)) : (r) => delen.some((f) => f(r))
      }
    }
    const kolEind = s.indexOf('.', i); const kol = s.slice(i, kolEind); i = kolEind + 1
    const opEind = s.indexOf('.', i); const op = s.slice(i, opEind); i = opEind + 1
    let waarde = ''
    if (s[i] === '"') { const eind = s.indexOf('"', i + 1); waarde = s.slice(i + 1, eind); i = eind + 1 }
    else { while (i < s.length && s[i] !== ',' && s[i] !== ')') waarde += s[i++] }
    return (r) => vergelijk(r[kol], op, waarde)
  }
  const delen = lijst()
  return (r) => delen.some((f) => f(r))
}
function vergelijk(a: any, op: string, b: any): boolean {
  switch (op) {
    case 'eq': return String(a) === String(b)
    case 'neq': return String(a) !== String(b)
    case 'lt': return a != null && a < b
    case 'lte': return a != null && a <= b
    case 'gt': return a != null && a > b
    case 'gte': return a != null && a >= b
    case 'is': return b === null || b === 'null' ? a == null : a === b
    default: throw new Error(`Onbekende operator ${op}`)
  }
}

class Vraag {
  private soort: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private filters: ((r: Rij) => boolean)[] = []
  private data: any = null
  private terug = false
  private enkel: 'single' | 'maybe' | null = null
  private volgorde: { kol: string; op: boolean } | null = null
  private max: number | null = null
  constructor(private tabel: string) { if (!tabellen[tabel]) tabellen[tabel] = [] }
  select() { if (this.soort !== 'select') this.terug = true; return this }
  insert(d: any) { this.soort = 'insert'; this.data = d; return this }
  update(d: any) { this.soort = 'update'; this.data = d; return this }
  delete() { this.soort = 'delete'; return this }
  eq(k: string, v: any) { this.filters.push((r) => r[k] === v || String(r[k]) === String(v)); return this }
  neq(k: string, v: any) { this.filters.push((r) => r[k] !== v); return this }
  is(k: string, v: any) { this.filters.push((r) => (v === null ? r[k] == null : r[k] === v)); return this }
  in(k: string, v: any[]) { this.filters.push((r) => v.includes(r[k])); return this }
  not(k: string, op: string, v: any) { this.filters.push((r) => !vergelijk(r[k], op, v)); return this }
  gte(k: string, v: any) { this.filters.push((r) => vergelijk(r[k], 'gte', v)); return this }
  lte(k: string, v: any) { this.filters.push((r) => vergelijk(r[k], 'lte', v)); return this }
  lt(k: string, v: any) { this.filters.push((r) => vergelijk(r[k], 'lt', v)); return this }
  gt(k: string, v: any) { this.filters.push((r) => vergelijk(r[k], 'gt', v)); return this }
  upsert(d: any) { this.soort = 'insert'; this.data = d; return this }
  or(f: string) { this.filters.push(parseOf(f)); return this }
  order(kol: string, o?: { ascending?: boolean }) { this.volgorde = { kol, op: o?.ascending !== false }; return this }
  limit(n: number) { this.max = n; return this }
  single() { this.enkel = 'single'; return this }
  maybeSingle() { this.enkel = 'maybe'; return this }
  then(ok: (v: any) => any, nok?: (e: any) => any) { return Promise.resolve().then(() => this.voerUit()).then(ok, nok) }

  private voerUit(): { data: any; error: any } {
    const t = tabellen[this.tabel]
    const kopie = (r: Rij) => JSON.parse(JSON.stringify(r))
    const past = (r: Rij) => this.filters.every((f) => f(r))
    let rijen: Rij[]
    if (this.soort === 'insert') {
      const nieuw = (Array.isArray(this.data) ? this.data : [this.data]).map((d: Rij) => ({
        id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(STANDAARD[this.tabel]?.() ?? {}), ...kopie(d),
      }))
      const fout = botsing(this.tabel, [...t, ...nieuw])
      if (fout) return { data: null, error: { message: `duplicate key value violates unique constraint "${fout}"`, code: '23505' } }
      t.push(...nieuw)
      rijen = nieuw
      if (!this.terug) return { data: null, error: null }
    } else if (this.soort === 'update') {
      const doel = t.filter(past)
      const voor = doel.map(kopie)
      doel.forEach((r) => Object.assign(r, kopie(this.data)))
      const fout = botsing(this.tabel, t)
      if (fout) { doel.forEach((r, i) => { for (const k of Object.keys(r)) delete r[k]; Object.assign(r, voor[i]) }); return { data: null, error: { message: `duplicate key value violates unique constraint "${fout}"`, code: '23505' } } }
      rijen = doel
      if (!this.terug) return { data: null, error: null }
    } else if (this.soort === 'delete') {
      tabellen[this.tabel] = t.filter((r) => !past(r)); return { data: null, error: null }
    } else {
      rijen = t.filter(past)
    }
    if (this.volgorde) { const { kol, op } = this.volgorde; rijen = [...rijen].sort((a, b) => (a[kol] < b[kol] ? -1 : a[kol] > b[kol] ? 1 : 0) * (op ? 1 : -1)) }
    if (this.max != null) rijen = rijen.slice(0, this.max)
    const uit = rijen.map(kopie)
    if (this.enkel === 'single') return uit.length === 1 ? { data: uit[0], error: null } : { data: null, error: { message: `JSON object requested, ${uit.length} rows returned` } }
    if (this.enkel === 'maybe') return uit.length > 1 ? { data: null, error: { message: 'meerdere rijen' } } : { data: uit[0] ?? null, error: null }
    return { data: uit, error: null }
  }
}

export const nepDb = { from: (t: string) => new Vraag(t) }

// ── Nep-API's ────────────────────────────────────────────────────────────────

export const google = {
  events: new Map<string, Rij>(),
  aangemaakt: 0, verwijderd: [] as { id: string; sendUpdates: string | null }[], patches: [] as { id: string; body: Rij; sendUpdates: string | null }[],
  /** Volgende POST maakt het event wél aan, maar het antwoord gaat verloren (time-out). */
  verliesAntwoord: false,
  /** Meet-link komt niet meteen (Google meldt 'pending'). */
  meetTraag: false,
  /** Vrij/bezet: bezette blokken (ISO) en storingen. */
  bezet: [] as { start: string; end: string }[],
  freebusyFout: false,
  freebusyKalenderFout: false,
  /** Volgende POST wordt geweigerd (bv. geen schrijfrechten). */
  weigerAanmaak: false,
}
export const clickup = {
  taken: new Map<string, Rij>(), aangemaakt: 0, volgnr: 0,
  verliesAntwoord: false,
  /** Taken in de werkruimte (voor bezet): { id, name, start_date, due_date, assignees }. */
  werkruimte: [] as Rij[],
  teamFout: false,
}
export const resend = {
  verstuurd: [] as Rij[], sleutels: new Map<string, string>(),
  /** Volgende verzending vertrekt wél, maar de verbinding valt weg vóór het antwoord. */
  verliesAntwoord: false,
  /** Volgende verzending wordt geweigerd met deze melding. */
  weiger: null as string | null,
}

let meetNr = 0
const json = (data: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

function metMeet(ev: Rij, aanvraag: boolean): Rij {
  if (aanvraag && !ev.hangoutLink) {
    if (google.meetTraag) ev.conferenceData = { createRequest: { status: { statusCode: 'pending' } } }
    else { ev.hangoutLink = `https://meet.google.com/test-${++meetNr}`; ev.conferenceData = { createRequest: { status: { statusCode: 'success' } }, entryPoints: [{ entryPointType: 'video', uri: ev.hangoutLink }] } }
  }
  return ev
}

async function nepFetch(input: any, init: any = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const methode = (init.method ?? 'GET').toUpperCase()
  const body = init.body ? JSON.parse(String(init.body)) : null

  if (url.host === 'www.googleapis.com') {
    const lijst = url.pathname.match(/\/calendar\/v3\/users\/me\/calendarList\/([^/]+)$/)
    if (lijst) return json({ id: decodeURIComponent(lijst[1]), summary: 'Agenda Bram', accessRole: 'owner' })
    if (url.pathname.endsWith('/calendar/v3/users/me/calendarList')) return json({ items: [{ id: 'bram@agenda', summary: 'Agenda Bram', accessRole: 'owner', primary: true }] })
    if (url.pathname.endsWith('/calendar/v3/freeBusy')) {
      if (google.freebusyFout) return json({ error: { message: 'Backend Error' } }, 500)
      const ids = (body.items ?? []).map((x: { id: string }) => x.id)
      const calendars: Record<string, unknown> = {}
      for (const id of ids) calendars[id] = google.freebusyKalenderFout ? { errors: [{ reason: 'notFound' }], busy: [] } : { busy: id === ids[0] ? google.bezet : [] }
      return json({ calendars })
    }
    const m = url.pathname.match(/\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/)
    if (!m) return json({ error: { message: 'onbekend pad' } }, 404)
    const id = m[2] ? decodeURIComponent(m[2]) : null
    if (methode === 'POST') {
      if (google.weigerAanmaak) { google.weigerAanmaak = false; return json({ error: { message: 'Forbidden' } }, 403) }
      if (google.events.has(body.id)) return json({ error: { message: 'The requested identifier already exists.' } }, 409)
      const ev = metMeet({ ...body, status: 'confirmed', calendarId: decodeURIComponent(m[1]) }, !!body.conferenceData?.createRequest)
      delete ev.conferenceData?.createRequest?.requestId
      google.events.set(body.id, ev); google.aangemaakt++
      if (google.verliesAntwoord) { google.verliesAntwoord = false; throw new TypeError('fetch failed') }
      return json(ev)
    }
    const ev = id ? google.events.get(id) : null
    if (!ev) return json({ error: { message: 'Not Found' } }, 404)
    if (methode === 'GET') return json(ev)
    if (methode === 'PATCH') {
      google.patches.push({ id: id!, body, sendUpdates: url.searchParams.get('sendUpdates') })
      const { conferenceData, ...rest } = body
      Object.assign(ev, rest)
      metMeet(ev, !!conferenceData?.createRequest)
      return json(ev)
    }
    if (methode === 'DELETE') {
      if (ev.status === 'cancelled') return json({ error: { message: 'Resource has been deleted' } }, 410)
      ev.status = 'cancelled'; google.verwijderd.push({ id: id!, sendUpdates: url.searchParams.get('sendUpdates') })
      return json(null, 204)
    }
  }

  if (url.host === 'api.clickup.com') {
    const p = url.pathname.replace('/api/v2', '')
    if (p === '/team') return clickup.teamFout ? json({ err: 'Team not authorized', ECODE: 'OAUTH_027' }, 401) : json({ teams: [{ id: 'T1' }] })
    if (p === '/team/T1/task') {
      const van = Number(url.searchParams.get('due_date_gt') ?? 0), tot = Number(url.searchParams.get('due_date_lt') ?? 0)
      const wie = url.searchParams.getAll('assignees[]').map(Number)
      const tasks = clickup.werkruimte.filter((t) => Number(t.due_date) > van && Number(t.due_date) < tot && (t.assignees as { id: number }[]).some((a) => wie.includes(a.id)))
      return json({ tasks })
    }
    let m = p.match(/^\/list\/([^/]+)\/task$/)
    if (m && methode === 'POST') {
      const id = `cu${++clickup.volgnr}`
      clickup.taken.set(id, { id, list: m[1], ...body, status: 'open', date_created: String(Date.now()) }); clickup.aangemaakt++
      if (clickup.verliesAntwoord) { clickup.verliesAntwoord = false; throw new TypeError('fetch failed') }
      return json({ id })
    }
    if (m && methode === 'GET') {
      const sinds = Number(url.searchParams.get('date_created_gt') ?? 0)
      const tasks = [...clickup.taken.values()].filter((t) => t.list === m![1] && Number(t.date_created) > sinds)
      return json({ tasks: tasks.map((t) => ({ id: t.id, name: t.name, description: t.description, text_content: t.description })), last_page: true })
    }
    m = p.match(/^\/task\/([^/]+)$/)
    if (m) {
      const t = clickup.taken.get(m[1])
      if (!t) return json({ err: 'Task not found, deleted', ECODE: 'ITEM_013' }, 404)
      if (methode === 'GET') return json({ id: t.id, name: t.name, list: { id: t.list } })
      if (methode === 'PUT') { Object.assign(t, body); return json({ id: t.id }) }
    }
    m = p.match(/^\/list\/([^/]+)$/)
    if (m) return json({ statuses: [{ status: 'open', type: 'open' }, { status: 'complete', type: 'closed' }] })
    return json({ err: 'onbekend' }, 404)
  }

  if (url.host === 'api.resend.com' && url.pathname === '/domains') {
    return json({ name: 'restricted_api_key', message: 'This API key is restricted to only send emails' }, 401)
  }
  if (url.host === 'api.resend.com') {
    const sleutel = (init.headers?.['Idempotency-Key'] ?? null) as string | null
    if (sleutel && resend.sleutels.has(sleutel)) return json({ id: resend.sleutels.get(sleutel) })
    if (resend.weiger) { const melding = resend.weiger; resend.weiger = null; return json({ message: melding }, 422) }
    const id = `re-${resend.verstuurd.length + 1}`
    resend.verstuurd.push({ ...body, sleutel, id })
    if (sleutel) resend.sleutels.set(sleutel, id)
    if (resend.verliesAntwoord) { resend.verliesAntwoord = false; throw new TypeError('fetch failed') }
    return json({ id })
  }
  throw new Error(`Onverwachte fetch naar ${url.host}`)
}
globalThis.fetch = nepFetch as typeof fetch

// ── Modules vervangen ────────────────────────────────────────────────────────

process.env.CLICKUP_API_KEY = 'test-clickup'
process.env.RESEND_API_KEY = 'test-resend'
process.env.NEXT_PUBLIC_APP_URL = 'https://app.nextgenmedia.be'

const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown }
const origineel = M._load
M._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req === 'server-only') return {}
  if (req === '@/lib/supabase/server' || req === '@/lib/supabase/admin-client') return { createAdminSupabaseClient: () => nepDb }
  return origineel.call(this, req, parent, isMain)
}

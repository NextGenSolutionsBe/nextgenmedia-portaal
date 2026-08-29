import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { encryptSecret, decryptSecret } from '@/lib/crypto'
import { baseUrl } from '@/lib/email'
import type { Interval } from '@/lib/sales/availability'
import { fetchMetLimiet } from '@/lib/fetch-met-limiet'

// Google Calendar per klant (§7). Bewust provider-agnostisch opgezet: de
// koppeltabel heeft een `provider`-kolom, zodat ClickUp later als tweede
// provider bijgebouwd kan worden zonder dit datamodel te wijzigen.
//
// Tokens worden VERSLEUTELD opgeslagen (lib/crypto.ts) en verlaten nooit de
// server. Vereist env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/calendar/v3'

// Lezen én schrijven van agenda's; 'email' om te tonen welk account gekoppeld is.
const SCOPES = ['https://www.googleapis.com/auth/calendar', 'openid', 'email']

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export function redirectUri(): string {
  return `${baseUrl()}/api/admin/sales/calendar/callback`
}

/**
 * Stap 1 van OAuth: waar sturen we de gebruiker heen.
 * Naam en handtekening reizen mee in `state`, zodat de callback ze meteen kan
 * opslaan — die weet verder niets van het scherm waar je vandaan komt.
 */
export function authUrl(salesClientId: string, state: string, name: string, signature = ''): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',       // nodig voor een refresh token
    prompt: 'consent',            // dwingt een refresh token af, ook bij herkoppelen
    state: `${salesClientId}:${state}:${encodeURIComponent(name)}:${encodeURIComponent(signature)}`,
  })
  return `${AUTH_URL}?${p.toString()}`
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; id_token?: string }

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchMetLimiet(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  const json = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok) throw new Error(json.error_description ?? `Google gaf een fout (${res.status})`)
  return json
}

/** Stap 2: code omruilen voor tokens en de koppeling opslaan. */
export async function exchangeCode(
  salesClientId: string, code: string, name: string, signature?: SignatureFields,
): Promise<void> {
  const tok = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  })
  if (!tok.access_token) throw new Error('Google gaf geen toegangstoken terug')

  // E-mailadres van het gekoppelde account tonen we in de UI ("gekoppeld als …").
  let email: string | null = null
  try {
    const r = await fetchMetLimiet('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })
    const info = await r.json() as { email?: string }
    email = info.email ?? null
  } catch { /* niet kritiek */ }

  const admin = createAdminSupabaseClient()
  // Eén agenda per Google-account binnen dezelfde klant. Koppel je hetzelfde
  // account opnieuw, dan verversen we de tokens i.p.v. een tweede rij te maken.
  // Zonder e-mailadres valt 'primary' terug op één rij per klant.
  const calendarId = email ?? 'primary'
  const base = {
    sales_client_id: salesClientId,
    provider: 'google',
    name: name || email || 'Agenda',
    account_email: email,
    calendar_id: calendarId,
    active: true,
    access_token: encryptSecret(tok.access_token),
    refresh_token: tok.refresh_token ? encryptSecret(tok.refresh_token) : null,
    token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
    status: 'connected',
  }
  const save = (payload: Record<string, unknown>) => admin
    .from('sales_calendar_connections')
    .upsert(payload, { onConflict: 'sales_client_id,provider,calendar_id' })
    .select('id').single()

  let { data: saved, error: saveErr } = await save({ ...base, ...(signature ?? {}) })
  // Bestaan de handtekeningkolommen nog niet, dan mag de koppeling daar niet op
  // stuklopen — die is het belangrijkste. Handtekening kan nadien.
  if (saveErr && /signature_|PGRST204|schema cache/i.test(saveErr.message)) {
    ({ data: saved } = await save(base))
  }

  // Meteen alle agenda's van dit account als bezet meetellen. Wie er eentje
  // niet wil laten meetellen, vinkt hem nadien uit; standaard blokkeert alles
  // wat in dit account staat, want dat is de veilige kant van de vergissing.
  if (saved?.id) {
    const all = await listCalendars(saved.id as string)
    if (all.length > 0) await setBusyCalendars(saved.id as string, defaultBusyIds(all))
  }
}

/**
 * Opslaan welke agenda's als bezet tellen. Stil overslaan als de kolom nog niet
 * bestaat: de app moet ook vóór de migratie blijven werken (zie CLAUDE.md).
 */
export async function setBusyCalendars(connectionId: string, ids: string[]): Promise<void> {
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from('sales_calendar_connections')
    .update({ busy_calendar_ids: ids }).eq('id', connectionId)
  if (error && !/busy_calendar_ids|PGRST204|schema cache/i.test(error.message)) throw new Error(error.message)
}

/** Handtekeningvelden op de koppeling; los gehouden zodat een oudere database
 *  zonder die kolommen niet stukloopt (ze worden dan gewoon weggelaten). */
export type SignatureFields = {
  signature_image_url?: string | null
  signature_phone?: string | null
  signature_email?: string | null
}

type Connection = {
  id: string; calendar_id: string | null
  access_token: string | null; refresh_token: string | null; token_expires_at: string | null
}

/**
 * Geldig toegangstoken ophalen; vernieuwt automatisch als het verlopen is.
 * `connectionId` = de agenda (persoon). Alle aanroepen werken nu per agenda,
 * zodat Bram en Marco elk hun eigen tokens en agenda houden.
 */
async function accessToken(
  connectionId: string,
): Promise<{ token: string; calendarId: string; busyCalendarIds: string[] } | null> {
  const admin = createAdminSupabaseClient()
  // Bewust '*': busy_calendar_ids bestaat pas na de migratie, en een expliciete
  // kolomlijst zou dan de hele query laten falen.
  const { data } = await admin
    .from('sales_calendar_connections').select('*')
    .eq('id', connectionId).maybeSingle()
  const conn = data as (Connection & { busy_calendar_ids?: string[] | null }) | null
  if (!conn?.access_token) return null

  const calendarId = conn.calendar_id || 'primary'
  const busyCalendarIds = Array.isArray(conn.busy_calendar_ids) ? conn.busy_calendar_ids : []
  const expires = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0
  // Een minuut marge, zodat een net-nog-geldig token niet halverwege verloopt.
  if (expires - 60000 > Date.now()) {
    return { token: decryptSecret(conn.access_token), calendarId, busyCalendarIds }
  }

  const refresh = conn.refresh_token ? decryptSecret(conn.refresh_token) : ''
  if (!refresh) {
    await admin.from('sales_calendar_connections').update({ status: 'expired' }).eq('id', conn.id)
    return null
  }
  // Google kan de koppeling intrekken: de gebruiker trekt toegang in, of het
  // OAuth-project staat nog op "Testing" (dan vervalt een refresh token na 7
  // dagen). We zetten de koppeling dan op 'expired' in plaats van stil te
  // falen — anders lijkt de agenda gewoon leeg en weet niemand waarom.
  let tok: TokenResponse
  try {
    tok = await tokenRequest({
      refresh_token: refresh,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    })
  } catch {
    await admin.from('sales_calendar_connections').update({ status: 'expired' }).eq('id', conn.id)
    return null
  }
  if (!tok.access_token) {
    await admin.from('sales_calendar_connections').update({ status: 'expired' }).eq('id', conn.id)
    return null
  }
  await admin.from('sales_calendar_connections').update({
    access_token: encryptSecret(tok.access_token),
    token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
    status: 'connected',
  }).eq('id', conn.id)
  return { token: tok.access_token, calendarId, busyCalendarIds }
}

export type GoogleCalendar = {
  id: string
  summary: string
  primary: boolean
  /** owner | writer | reader | freeBusyReader */
  accessRole: string
}

/**
 * Feestdagen-, verjaardags- en vakantiefeeds staan in bijna elk Google-account
 * en vullen hele dagen. Zouden die als bezet tellen, dan kleurt de kalender
 * massaal grijs. Standaard laten we ze dus buiten beschouwing; wie ze tóch wil
 * meetellen, kan ze gewoon aanvinken.
 */
function isNoiseCalendar(id: string): boolean {
  return /holiday@group\.v\.calendar\.google\.com$|#contacts@group\.v\.calendar\.google\.com$|birthday/i.test(id)
}

/** Alle agenda's van het gekoppelde Google-account. */
export async function listCalendars(connectionId: string): Promise<GoogleCalendar[]> {
  const auth = await accessToken(connectionId)
  if (!auth) return []
  try {
    const res = await fetchMetLimiet(`${API}/users/me/calendarList?maxResults=250&minAccessRole=freeBusyReader`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    if (!res.ok) return []
    const json = await res.json() as {
      items?: { id?: string; summary?: string; summaryOverride?: string; primary?: boolean; accessRole?: string }[]
    }
    return (json.items ?? [])
      .filter((c): c is { id: string } & typeof c => !!c.id)
      .map((c) => ({
        id: c.id,
        summary: c.summaryOverride || c.summary || c.id,
        primary: !!c.primary,
        accessRole: c.accessRole ?? 'reader',
      }))
  } catch { return [] }
}

/** Welke agenda's tellen mee als bezet, met een verstandige standaardkeuze. */
export function defaultBusyIds(all: GoogleCalendar[]): string[] {
  return all.filter((c) => !isNoiseCalendar(c.id)).map((c) => c.id)
}

/**
 * Bezette momenten uit ALLE meegetelde agenda's van dit account — voedt het
 * grijs (§7). Eén Google-account heeft meestal meerdere agenda's; keken we
 * enkel naar de hoofdagenda, dan zou een afspraak in de agenda "Marco" hier
 * wit (boekbaar) blijken. Dat is precies de fout die je niet wil maken.
 */
export async function fetchBusy(connectionId: string, from: number, to: number): Promise<Interval[]> {
  const auth = await accessToken(connectionId)
  if (!auth) return []

  let ids = auth.busyCalendarIds ?? []
  if (ids.length === 0) {
    // Nog geen keuze opgeslagen (of de kolom bestaat nog niet): live opvragen.
    ids = defaultBusyIds(await listCalendars(connectionId))
  }
  // De schrijfagenda telt hoe dan ook mee, ook al zou hij niet aangevinkt zijn.
  if (!ids.includes(auth.calendarId)) ids = [auth.calendarId, ...ids]
  // freeBusy aanvaardt maximaal 50 agenda's per verzoek.
  ids = ids.slice(0, 50)

  try {
    const res = await fetchMetLimiet(`${API}/freeBusy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        items: ids.map((id) => ({ id })),
      }),
    })
    if (!res.ok) return []
    const json = await res.json() as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> }
    // Alles samengooien: bookableSegments() voegt overlappende blokken zelf samen.
    return Object.values(json.calendars ?? {}).flatMap((c) =>
      (c.busy ?? []).map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() })),
    )
  } catch {
    // Agenda onbereikbaar → geen bezet-informatie. We tonen dan enkel onze eigen
    // afspraken als bezet; de DB-constraint voorkomt hoe dan ook dubbele boeking.
    return []
  }
}

export type CreatedEvent = { eventId: string; meetUrl: string | null }

/** Event aanmaken in de agenda van de klant, optioneel met Google Meet (§7). */
export async function createEvent(connectionId: string, opts: {
  summary: string
  description?: string
  /** Adres. Hoort in het aparte location-veld en niet enkel in de tekst: enkel
   *  zo kan de closer vanuit zijn agenda rechtstreeks laten navigeren. */
  location?: string | null
  startsAt: number
  endsAt: number
  timezone: string
  attendeeEmail?: string | null
  withMeet?: boolean
}): Promise<CreatedEvent> {
  const auth = await accessToken(connectionId)
  if (!auth) throw new Error('Deze agenda is niet (meer) gekoppeld')

  const body: Record<string, unknown> = {
    summary: opts.summary,
    description: opts.description ?? '',
    ...(opts.location?.trim() ? { location: opts.location.trim() } : {}),
    start: { dateTime: new Date(opts.startsAt).toISOString(), timeZone: opts.timezone },
    end: { dateTime: new Date(opts.endsAt).toISOString(), timeZone: opts.timezone },
  }
  if (opts.attendeeEmail) body.attendees = [{ email: opts.attendeeEmail }]
  if (opts.withMeet) {
    body.conferenceData = { createRequest: { requestId: `ngm-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  }

  const params = new URLSearchParams({ conferenceDataVersion: opts.withMeet ? '1' : '0', sendUpdates: opts.attendeeEmail ? 'all' : 'none' })
  const res = await fetchMetLimiet(`${API}/calendars/${encodeURIComponent(auth.calendarId)}/events?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({})) as { id?: string; hangoutLink?: string; error?: { message?: string } }
  if (!res.ok || !json.id) throw new Error(json.error?.message ?? 'Google kon de afspraak niet aanmaken')
  return { eventId: json.id, meetUrl: json.hangoutLink ?? null }
}

/** Verplaatsen — houdt het Google-event gelijk aan onze afspraak. */
export async function moveEvent(connectionId: string, eventId: string, startsAt: number, endsAt: number, timezone: string): Promise<void> {
  const auth = await accessToken(connectionId)
  if (!auth) throw new Error('Deze agenda is niet (meer) gekoppeld')
  const res = await fetchMetLimiet(`${API}/calendars/${encodeURIComponent(auth.calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: { dateTime: new Date(startsAt).toISOString(), timeZone: timezone },
      end: { dateTime: new Date(endsAt).toISOString(), timeZone: timezone },
    }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(j.error?.message ?? 'Google kon de afspraak niet verplaatsen')
  }
}

/** Annuleren — geen wees-events laten staan (§7). */
export async function deleteEvent(connectionId: string, eventId: string): Promise<void> {
  const auth = await accessToken(connectionId)
  if (!auth) return
  // 404/410 = al weg; dat is geen fout voor ons.
  await fetchMetLimiet(`${API}/calendars/${encodeURIComponent(auth.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${auth.token}` },
  }).catch(() => {})
}

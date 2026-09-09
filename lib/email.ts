// Server-side mailverzending via Resend (REST, geen extra dependency).
// Vereist env: RESEND_API_KEY. Afzender vast op info@nextgenmedia.be (override
// via EMAIL_FROM). Zonder API-key faalt verzenden netjes met een duidelijke fout.

import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

export const EMAIL_FROM = process.env.EMAIL_FROM || 'NextGenMedia <info@nextgenmedia.be>'

/** Publieke basis-URL van de app, voor links in mails. */
export function baseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export type SendResult = { ok: boolean; id?: string; error?: string }

/** Verstuurt één mail. Geef `html` mee voor opgemaakte mails; anders wordt de
 *  tekst als simpele HTML verzonden. */
export async function sendEmail(opts: {
  to: string | string[]; subject: string; text: string; html?: string
  /** Antwoorden komen hier terecht i.p.v. bij de afzender. Gebruikt bij mails
   *  die wij namens iemand anders sturen (bv. afspraakherinneringen). */
  replyTo?: string | null
  /** Afzender overschrijven — nodig omdat wij voor twee bedrijven mailen.
   *  Het domein moet wél geverifieerd zijn bij Resend, anders weigert die. */
  from?: string | null
  /** Bijlagen. `path` is een publiek bereikbare URL; Resend haalt het bestand
   *  zelf op, zodat wij geen megabytes door een serverless functie duwen. */
  attachments?: { filename: string; path: string }[]
  /** ISO-tijdstip waarop de mail moet vertrekken. Resend houdt hem tot dan vast
   *  — maximaal 72 uur vooruit. Zo halen we een verzendmoment op de minuut
   *  zonder dat er elk kwartier een cron moet draaien. */
  scheduledAt?: string | null
  /** Sleutel van een ander merk; leeg = de standaardsleutel. */
  apiKey?: string | null
}): Promise<SendResult> {
  const apiKey = opts.apiKey || process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, error: 'Geen mailprovider geconfigureerd (RESEND_API_KEY ontbreekt).' }

  const html = opts.html ?? `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#111;white-space:pre-wrap">${escapeHtml(opts.text)}</div>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: opts.from || EMAIL_FROM,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        text: opts.text,
        html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
        ...(opts.scheduledAt ? { scheduled_at: opts.scheduledAt } : {}),
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.message || `Resend-fout (${res.status})` }
    return { ok: true, id: json?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Verzenden mislukt' }
  }
}

/** Uiterste horizon van Resend voor een ingeplande mail. */
export const SCHEDULE_HORIZON_MS = 72 * 3600 * 1000

/** Weigerde Resend omdat het AFZENDERDOMEIN niet geverifieerd is? */
function isDomeinFout(msg: string | null | undefined): boolean {
  return /is not verified|verify your domain|domain (is )?not (verified|found)|not authorized to send/i.test(msg ?? '')
}

/**
 * Als sendEmail, maar met een vangnet op de afzender.
 *
 * Wij mailen voor twee merken met (meestal) één Resend-sleutel. Vertrekt een
 * mail met afzender info@nextgensolutions.be terwijl dat domein niet onder de
 * gebruikte sleutel geverifieerd is, dan weigert Resend hem — en een
 * herinnering naar een prospect mag nooit stil sneuvelen op een
 * domeininstelling. Dan liever verzonden vanaf het hoofdadres, met de
 * displaynaam van het merk en het merkadres als antwoordadres, zodat een
 * reply alsnog op de juiste plek aankomt.
 *
 * `afzenderTeruggevallen` in het resultaat vertelt de oproeper dat dit
 * gebeurd is (bv. om het in een testmail-melding te tonen).
 */
export async function sendEmailMetAfzenderTerugval(
  opts: Parameters<typeof sendEmail>[0],
): Promise<SendResult & { afzenderTeruggevallen?: boolean }> {
  const eerste = await sendEmail(opts)
  if (eerste.ok || !opts.from || !isDomeinFout(eerste.error)) return eerste

  // Displaynaam van het merk behouden; adres wordt dat van het hoofddomein.
  const merkNaam = opts.from.match(/^([^<]+)</)?.[1]?.trim()
  const hoofdAdres = EMAIL_FROM.match(/<([^>]+)>/)?.[1] ?? EMAIL_FROM
  const merkAdres = opts.from.match(/<([^>]+)>/)?.[1] ?? opts.from

  const tweede = await sendEmail({
    ...opts,
    from: merkNaam ? `${merkNaam} <${hoofdAdres}>` : EMAIL_FROM,
    replyTo: opts.replyTo || merkAdres,
  })
  return tweede.ok ? { ...tweede, afzenderTeruggevallen: true } : tweede
}

/**
 * Een Resend-sleutel kan beperkt zijn tot "alleen verzenden". Versturen lukt
 * dan wel, maar een ingeplande mail intrekken of een status opvragen niet.
 * Die fout is niet op te lossen in de code — de sleutel moet ruimere rechten
 * krijgen — dus zeggen we dat met zoveel woorden.
 */
export const RESTRICTED_KEY_HINT =
  'De Resend-sleutel mag alleen mails versturen. Maak in Resend een sleutel met ' +
  '"Full access" aan en zet die als RESEND_API_KEY — anders kunnen we ingeplande ' +
  'mails niet intrekken en de bezorgstatus niet opvragen.'

/**
 * Welke Resend-sleutel hoort bij welk merk?
 *
 * NextGenSolutions mailt vanaf een eigen domein en heeft daarvoor een eigen
 * sleutel (RESEND_API_KEY_SOLUTIONS). Ontbreekt die, dan valt alles terug op de
 * gewone sleutel — dan vertrekt de mail nog steeds, alleen vanaf het andere
 * domein.
 *
 * BELANGRIJK: een mail intrekken of zijn status opvragen moet met DEZELFDE
 * sleutel gebeuren als waarmee hij verstuurd is. Vandaar dat deze keuze op één
 * plek staat en overal opnieuw uit het merk afgeleid wordt.
 */
export function resendKeyFor(pipelineKey: string | null | undefined): string | undefined {
  if (pipelineKey === 'nextgensolutions' && process.env.RESEND_API_KEY_SOLUTIONS) {
    return process.env.RESEND_API_KEY_SOLUTIONS
  }
  return process.env.RESEND_API_KEY
}

export function isRestrictedKeyError(msg: string | null | undefined): boolean {
  return /restricted to only send|only send emails|not authorized|insufficient/i.test(msg ?? '')
}

/**
 * Een ingeplande mail alsnog tegenhouden — bijvoorbeeld wanneer de afspraak
 * geannuleerd of verplaatst wordt. Faalt dit, dan melden we dat: een
 * herinnering voor een afgezegde afspraak is erger dan geen herinnering.
 */
export async function cancelScheduledEmail(id: string, key?: string | null): Promise<SendResult> {
  const apiKey = key || process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, error: 'Geen mailprovider geconfigureerd.' }
  if (!id) return { ok: false, error: 'Geen mail-id' }
  try {
    const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      const msg = json?.message || `Resend-fout (${res.status})`
      return { ok: false, error: isRestrictedKeyError(msg) ? RESTRICTED_KEY_HINT : msg }
    }
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Annuleren mislukt' }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** E-mailadressen van alle admins (voor automatische interne meldingen). */
export async function getAdminEmails(): Promise<string[]> {
  const admin = createAdminSupabaseClient()
  const out = new Set<string>()
  try {
    const { data: roles } = await admin.from('user_roles').select('user_id').eq('role', 'admin')
    const ids = new Set((roles ?? []).map((r: { user_id: string }) => r.user_id))
    if (ids.size > 0) {
      // listUsers is gepagineerd; founders zijn een handvol, één pagina volstaat.
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      for (const u of data?.users ?? []) {
        if (ids.has(u.id) && u.email) out.add(u.email)
      }
    }
  } catch { /* val terug op bedrijfsinbox */ }
  // Bedrijfsinbox altijd meenemen zodat meldingen nooit verloren gaan.
  out.add('info@nextgenmedia.be')
  return [...out]
}

/** Wat Resend over één mail weet. `lastEvent` is de echte status. */
export type EmailStatus = {
  id: string
  lastEvent: string | null      // scheduled | queued | sent | delivered | bounced | complained | canceled | ...
  to: string[]
  subject: string | null
  createdAt: string | null
  scheduledAt: string | null
}

/**
 * Status van één verzonden of ingeplande mail opvragen bij Resend.
 * Dit is de enige betrouwbare bron: onze eigen tabel weet alleen dát we hem
 * hebben aangeboden, niet of hij ook aangekomen is.
 */
export type EmailStatusResult =
  | { ok: true; status: EmailStatus }
  | { ok: false; restricted: boolean }

/** Wat een Resend-sleutel mag. */
export type SleutelRechten = 'ontbreekt' | 'volledig' | 'beperkt' | 'onbekend'

/**
 * Nagaan of een sleutel méér mag dan versturen, ZONDER een mail te sturen.
 *
 * We vragen een mail op met een id dat niet bestaat. Mag de sleutel lezen, dan
 * antwoordt Resend "niet gevonden" (404) — dat is precies wat we willen weten.
 * Mag hij het niet, dan komt er een 401/403 met "restricted to only send".
 *
 * Waarom dit bestaat: een beperkte sleutel verstuurt gewoon, dus alles lijkt te
 * werken — tot je een ingeplande mail wil intrekken of verzetten. Dan pas krijg
 * je de melding, en dat is te laat. Hiermee kan je het vooraf zien.
 */
export async function sleutelRechten(key?: string | null): Promise<SleutelRechten> {
  const apiKey = key || process.env.RESEND_API_KEY
  if (!apiKey) return 'ontbreekt'
  try {
    const res = await fetch('https://api.resend.com/emails/00000000-0000-0000-0000-000000000000', {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    })
    if (res.status === 404) return 'volledig'
    if (res.status === 401 || res.status === 403) return 'beperkt'
    const json = await res.json().catch(() => ({})) as { message?: string }
    if (isRestrictedKeyError(json?.message)) return 'beperkt'
    // 200 kan niet (dat id bestaat niet), en de rest kunnen we niet duiden.
    // Dan liever 'onbekend' dan een geruststelling die nergens op slaat.
    return res.ok ? 'volledig' : 'onbekend'
  } catch {
    return 'onbekend'
  }
}

export async function getEmailStatus(id: string, key?: string | null): Promise<EmailStatusResult> {
  const apiKey = key || process.env.RESEND_API_KEY
  if (!apiKey || !id) return { ok: false, restricted: false }
  try {
    const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      // Onderscheid maken tussen "mag niet" en "bestaat niet" — bij het eerste
      // is er iets in te stellen, bij het tweede niet.
      return { ok: false, restricted: isRestrictedKeyError(json?.message) || res.status === 401 || res.status === 403 }
    }
    const j = await res.json() as {
      id?: string; last_event?: string; to?: string[] | string
      subject?: string; created_at?: string; scheduled_at?: string
    }
    return {
      ok: true,
      status: {
        id: j.id ?? id,
        lastEvent: j.last_event ?? null,
        to: Array.isArray(j.to) ? j.to : j.to ? [j.to] : [],
        subject: j.subject ?? null,
        createdAt: j.created_at ?? null,
        scheduledAt: j.scheduled_at ?? null,
      },
    }
  } catch { return { ok: false, restricted: false } }
}

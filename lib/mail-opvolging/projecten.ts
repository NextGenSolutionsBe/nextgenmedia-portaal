// Nieuwe projecten uit de mail — pure regels (client-safe, getest in tests/mail-projecten.test.ts).
//
// De app leest de inkomende mails en vraagt de AI streng: is dit de start van
// een nieuw project? (een prijsvraag, een aanvraag via het websiteformulier,
// een prospect die wil samenwerken, een bestaande klant die iets nieuws wil).
// Enkel bij een duidelijk ja komt er een voorstel in het Command Center, met
// een korte samenvatting en de gegevens van de klant. Een mens beslist: Ja maakt
// een projectkaart in Opvolging, Nee laat het voorstel verdwijnen.

import { DIENSTEN, normaliseerDiensten, type Bedrijf, type DienstKey, type ProjectVerantwoordelijke } from '@/lib/opdrachten-kanban'

export type MailProjectStatus = 'voorstel' | 'ja' | 'nee' | 'al_op_bord'

/** Vanaf deze zekerheid tonen we een voorstel. Eronder: niets. */
export const DREMPEL = 0.7

/** Hoe ver we de eerste keer teruglezen, en hoe oud een mail mag zijn om nog te beoordelen. */
export const EERSTE_KEER_DAGEN = 7
export const MAX_LEEFTIJD_DAGEN = 21

export type Contact = { bedrijf: string | null; naam: string | null; email: string | null; telefoon: string | null; website: string | null; btw: string | null }

export type ProjectOordeel = {
  nieuw: boolean
  zekerheid: number
  lopend: boolean
  reden: string | null
  titel: string | null
  samenvatting: string | null
  project: string | null
  diensten: DienstKey[]
  ads: 'meta' | 'google' | 'beide' | null
  contact: Contact
}

// ── Voorfilter: wat lezen we zeker niet? ─────────────────────────────────────

const AUTOMATISCH_LOKAAL = /^(no-?reply|do-?not-?reply|donotreply|noreply-.+|mailer-daemon|postmaster|bounces?|bounce-.+|notifications?|notify|alerts?|newsletters?|nieuwsbrief|news|marketing|mailing|campaigns?|automated|auto-?confirm|system|robot|daemon|calendar-notification|invoices?|billing|facturen|factuur|facturatie|receipts?|accounting)([+._-].*)?$/i

/** Diensten die ons meldingen sturen (nooit een klant die iets vraagt). */
const PLATFORM_DOMEINEN = [
  'google.com', 'accounts.google.com', 'calendar-notification.google.com', 'facebookmail.com', 'meta.com', 'linkedin.com', 'tiktok.com', 'instagram.com',
  'clickup.com', 'tasks.clickup.com', 'stripe.com', 'metricool.com', 'canva.com', 'apple.com', 'microsoft.com', 'vercel.com', 'github.com', 'supabase.com', 'supabase.io',
  'resend.com', 'resend.dev', 'mailchimp.com', 'mcsv.net', 'hubspot.com', 'hubspotemail.net', 'sendgrid.net', 'amazonses.com', 'zoom.us', 'calendly.com', 'paypal.com',
  'mollie.com', 'level27.be', 'level27.eu', 'framer.com', 'webflow.com', 'wix.com', 'wordpress.com', 'shopify.com', 'notion.so', 'slack.com', 'adobe.com', 'figma.com',
  'docusign.net', 'yousign.com', 'billit.be', 'peppol.eu', 'teamleader.eu', 'exact.com', 'odoo.com', 'mailerlite.com', 'brevo.com', 'sendinblue.com', 'klaviyo.com',
]

/** Lijkt het op een melding van een websiteformulier? Dan lezen we het wel (de gegevens staan in de tekst). */
export function lijktFormulier(onderwerp: string | null | undefined): boolean {
  return /(formulier|form submission|new submission|nieuwe inzending|new form|contactaanvraag|contact request|offerteaanvraag|offerte aanvraag|prijsaanvraag|nieuwe aanvraag|websiteaanvraag|aanvraag via)/i.test(String(onderwerp ?? ''))
}

/** Kopregels uit een ruwe header-buffer ("List-Unsubscribe: …") naar een map met kleine letters. */
export function leesKoppen(ruw: string | null | undefined): Map<string, string> {
  const uit = new Map<string, string>()
  const regels = String(ruw ?? '').replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n')
  for (const r of regels) {
    const i = r.indexOf(':')
    if (i <= 0) continue
    const k = r.slice(0, i).trim().toLowerCase()
    if (!uit.has(k)) uit.set(k, r.slice(i + 1).trim())
  }
  return uit
}

/**
 * Een massamail of automatische mail? Dan beoordelen we ze niet. Geeft de reden
 * terug, of null als het een gewone mail van een mens lijkt. Een melding van
 * een websiteformulier laten we altijd door.
 */
export function massamail(p: { van: string | null; onderwerp: string | null; koppen: Map<string, string>; aantalOntvangers?: number }): string | null {
  if (lijktFormulier(p.onderwerp)) return null
  const van = String(p.van ?? '').toLowerCase()
  const [lokaal = '', domein = ''] = van.split('@')
  if (!van || !domein) return 'geen afzender'
  if (AUTOMATISCH_LOKAAL.test(lokaal)) return 'automatisch adres'
  if (PLATFORM_DOMEINEN.some((d) => domein === d || domein.endsWith(`.${d}`))) return 'melding van een platform'
  const k = p.koppen
  if (k.has('list-unsubscribe') || k.has('list-id')) return 'nieuwsbrief of mailinglijst'
  if (/bulk|list|junk/i.test(k.get('precedence') ?? '')) return 'massamail'
  const auto = (k.get('auto-submitted') ?? '').toLowerCase()
  if (auto && auto !== 'no') return 'automatisch verstuurd'
  if (k.has('x-autoreply') || k.has('x-autorespond') || /oof|autoreply/i.test(k.get('x-auto-response-suppress') ?? '')) return 'automatisch antwoord'
  if (/^(automatisch antwoord|automatic reply|auto(matic)?[- ]?reply|out of office|afwezig|absence)/i.test(String(p.onderwerp ?? '').trim())) return 'automatisch antwoord'
  if ((p.aantalOntvangers ?? 0) > 15) return 'naar veel ontvangers'
  return null
}

// ── Wat de AI teruggeeft, nagekeken ──────────────────────────────────────────

const DIENST_KEYS = DIENSTEN.map((d) => d.key) as DienstKey[]
const tekst = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return s ? s.slice(0, max) : null
}
const emailOfNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/^mailto:/, '') : ''
  return /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(s) ? s.slice(0, 200) : null
}

/** Het antwoord van de AI netjes maken: enkel geldige diensten en adressen, zekerheid tussen 0 en 1. */
export function naarOordeel(ruw: unknown): ProjectOordeel {
  const r = (ruw && typeof ruw === 'object' ? ruw : {}) as Record<string, unknown>
  const c = (r.contact && typeof r.contact === 'object' ? r.contact : {}) as Record<string, unknown>
  const z = Number(r.zekerheid)
  const diensten = normaliseerDiensten(Array.isArray(r.diensten) ? r.diensten : []).filter((d): d is DienstKey => DIENST_KEYS.includes(d as DienstKey)).slice(0, 3)
  const ads = r.ads === 'meta' || r.ads === 'google' || r.ads === 'beide' ? r.ads : null
  const telefoon = tekst(c.telefoon, 40)
  return {
    nieuw: r.nieuw_project === true,
    zekerheid: Number.isFinite(z) ? Math.max(0, Math.min(1, z)) : 0,
    lopend: r.hoort_bij_lopend_project === true,
    reden: tekst(r.reden, 200),
    titel: tekst(r.titel, 80),
    samenvatting: tekst(r.samenvatting, 600),
    project: tekst(r.project, 300),
    diensten,
    ads,
    contact: {
      bedrijf: tekst(c.bedrijf, 120), naam: tekst(c.naam, 120), email: emailOfNull(c.email),
      telefoon: telefoon && /\d{6,}/.test(telefoon.replace(/\D/g, '')) ? telefoon : null,
      website: tekst(c.website, 200), btw: tekst(c.btw, 30),
    },
  }
}

/** Tonen we dit als voorstel? Enkel een duidelijk nieuw project, los van wat al loopt. */
export function isVoorstel(o: ProjectOordeel | null | undefined): boolean {
  return !!o && o.nieuw && !o.lopend && o.zekerheid >= DREMPEL && !!o.samenvatting
}

// ── Voorstellen voor de kaart ────────────────────────────────────────────────

const BRAM: DienstKey[] = ['social_media', 'grafisch', 'foto_video', 'consultancy', 'founders']
const MARCO: DienstKey[] = ['webdesign', 'ngs']

/**
 * Wie wordt verantwoordelijke? Bram voor media en marketing (sociale media,
 * grafisch, foto en video, consultancy, Meta-advertenties), Marco voor IT
 * (websites, AI, Google-advertenties). Beide soorten of niets duidelijk: samen.
 */
export function voorstelVerantwoordelijke(diensten: string[], ads: ProjectOordeel['ads'] = null): ProjectVerantwoordelijke {
  let bram = false, marco = false
  for (const d of diensten) {
    if (BRAM.includes(d as DienstKey)) bram = true
    else if (MARCO.includes(d as DienstKey)) marco = true
    else if (d === 'advertising') {
      if (ads === 'meta') bram = true
      else if (ads === 'google') marco = true
      else { bram = true; marco = true }
    }
  }
  if (bram && !marco) return 'Bram'
  if (marco && !bram) return 'Marco'
  return 'Gezamenlijke lead'
}

/** Voor welk bedrijf: de mailbox waarin het binnenkwam, anders uit de diensten. */
export function bedrijfVoor(mailbox: string | null | undefined, diensten: string[]): Bedrijf {
  const m = String(mailbox ?? '').toLowerCase()
  if (m.endsWith('@nextgensolutions.be')) return 'nextgensolutions'
  if (m.endsWith('@foundersofflanders.be')) return 'foundersofflanders'
  if (diensten.includes('ngs') && !diensten.some((d) => d !== 'ngs')) return 'nextgensolutions'
  if (diensten.includes('founders') && !diensten.some((d) => d !== 'founders')) return 'foundersofflanders'
  return 'nextgenmedia'
}

/** Bedrijfsnaam vergelijken zonder rechtsvorm, hoofdletters of tekens ("Bakkerij Peeters BV" = "bakkerij peeters"). */
export function naamSleutel(v: string | null | undefined): string {
  return String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(bv|bvba|nv|vzw|cv|cvba|commv|comm\s*v|vof|srl|sa|sprl|asbl|bvio|gcv|ltd|gmbh|inc)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
}

/** Onderwerp zonder Re:/Fw:/Antw: (zelfde gesprek). */
export function onderwerpSleutel(v: string | null | undefined): string {
  let s = String(v ?? '').trim()
  for (let i = 0; i < 5; i++) s = s.replace(/^\s*(re|fw|fwd|tr|antw|aw|wg|doorst)\s*(\[\d+\])?\s*:\s*(\[\d+\]\s*)?/i, '')
  return s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
}

type Kaart = { id: string; client_id: string | null; klant_vrij: string | null; omschrijving: string | null; titel: string; status: string }

/**
 * Staat deze prospect al op het bord? (een lopende kaart met hetzelfde e-mailadres
 * in de omschrijving, of dezelfde bedrijfsnaam, zoals een websiteaanvraag die al
 * een kaart werd). Zelfde regel als /api/leads/website.
 */
export function kaartVoorProspect<K extends Kaart>(c: Pick<Contact, 'email' | 'bedrijf'> & { van?: string | null }, kaarten: K[]): K | null {
  const adressen = [c.email, c.van].filter((x): x is string => !!x).map((x) => x.toLowerCase())
  const sleutel = naamSleutel(c.bedrijf)
  return kaarten.find((k) => adressen.some((a) => String(k.omschrijving ?? '').toLowerCase().includes(a)) || (sleutel.length >= 3 && naamSleutel(k.klant_vrij) === sleutel)) ?? null
}

/** De omschrijving op de kaart: wie het is en hoe we hen bereiken (zelfde vorm als een websiteaanvraag). */
export function contactRegels(c: Contact): string {
  return [c.naam && `Contact: ${c.naam}`, c.email && `E-mail: ${c.email}`, c.telefoon && `Telefoon: ${c.telefoon}`, c.website && `Website: ${c.website}`, c.btw && `Btw: ${c.btw}`].filter(Boolean).join('\n')
}

/** De eerste notitie op de kaart: waar het vandaan komt en wat er gevraagd werd. */
export function kaartNotitie(p: { van: string | null; vanNaam: string | null; onderwerp: string | null; ontvangen: string; samenvatting: string | null; project: string | null }): string {
  const dag = new Date(p.ontvangen).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
  const wie = p.vanNaam && p.van ? `${p.vanNaam} (${p.van})` : p.vanNaam ?? p.van ?? 'onbekend'
  return [
    `Nieuw project uit de mail van ${wie} op ${dag}${p.onderwerp ? ` ("${p.onderwerp}")` : ''}.`,
    p.samenvatting,
    p.project ? `Project: ${p.project}` : null,
  ].filter(Boolean).join('\n\n')
}

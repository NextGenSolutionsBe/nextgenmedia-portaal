import { zoneNaarIso, STANDAARD_TIJDZONE } from '@/lib/meetings/model'

/**
 * Een agendabestand (.ics, text/calendar) uit een uitnodiging lezen: Teams,
 * Outlook, Google Agenda en Zoom sturen er bijna altijd een mee. Enkel wat we
 * nodig hebben om een voorstel te tonen: titel, begin, einde, plaats, link,
 * organisator, deelnemers en of het een annulering is.
 */

export type IcsEvent = {
  uid: string | null
  methode: string | null // REQUEST, CANCEL, PUBLISH …
  titel: string
  start_op: string | null
  eind_op: string | null
  heel_dag: boolean
  locatie: string | null
  beschrijving: string | null
  meet_url: string | null
  platform: 'teams' | 'meet' | 'zoom' | 'webex' | null
  organisator: { naam: string | null; email: string | null } | null
  deelnemers: { naam: string | null; email: string }[]
  geannuleerd: boolean
}

// Windows-namen van tijdzones (Outlook en Teams) naar IANA.
const WINDOWS_ZONES: Record<string, string> = {
  'romance standard time': 'Europe/Brussels',
  'w. europe standard time': 'Europe/Amsterdam',
  'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'utc': 'UTC',
  'coordinated universal time': 'UTC',
  'e. europe standard time': 'Europe/Chisinau',
  'fle standard time': 'Europe/Helsinki',
  'gtb standard time': 'Europe/Athens',
  'eastern standard time': 'America/New_York',
  'pacific standard time': 'America/Los_Angeles',
}

function geldigeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

export function zoneVan(tzid: string | null | undefined): string {
  if (!tzid) return STANDAARD_TIJDZONE
  const t = tzid.replace(/^"|"$/g, '').trim()
  const w = WINDOWS_ZONES[t.toLowerCase()]
  if (w) return w
  if (geldigeZone(t)) return t
  // "(UTC+01:00) Brussels, Copenhagen, Madrid, Paris" en varianten.
  if (/brussel|amsterdam|paris|berlin|madrid|copenhagen|rome|vienna/i.test(t)) return 'Europe/Brussels'
  return STANDAARD_TIJDZONE
}

/** Regels ontvouwen (een regel die met een spatie of tab begint hoort bij de vorige). */
function regels(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/).filter((r) => r.length > 0)
}

function ontsnap(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim()
}

type Eigenschap = { naam: string; params: Record<string, string>; waarde: string }

function eigenschap(r: string): Eigenschap | null {
  // NAAM;PARAM=x;PARAM2="a:b":waarde — de eerste dubbelpunt buiten aanhalingstekens.
  let inAanhaling = false, i = 0
  for (; i < r.length; i++) {
    const c = r[i]
    if (c === '"') inAanhaling = !inAanhaling
    else if (c === ':' && !inAanhaling) break
  }
  if (i >= r.length) return null
  const kop = r.slice(0, i), waarde = r.slice(i + 1)
  const delen = kop.split(';')
  const params: Record<string, string> = {}
  for (const p of delen.slice(1)) {
    const j = p.indexOf('=')
    if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, '')
  }
  return { naam: delen[0].toUpperCase(), params, waarde }
}

/** DTSTART/DTEND naar ISO (UTC). Een datum zonder uur = hele dag. */
export function icsTijd(e: Eigenschap): { iso: string; heelDag: boolean } | null {
  const v = e.waarde.trim()
  const d = v.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (d || e.params.VALUE === 'DATE') {
    const m = d ?? v.match(/^(\d{4})(\d{2})(\d{2})/)
    if (!m) return null
    return { iso: zoneNaarIso(`${m[1]}-${m[2]}-${m[3]}`, '00:00', STANDAARD_TIJDZONE), heelDag: true }
  }
  const t = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/)
  if (!t) return null
  if (t[7]) return { iso: new Date(Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +(t[6] ?? 0))).toISOString(), heelDag: false }
  return { iso: zoneNaarIso(`${t[1]}-${t[2]}-${t[3]}`, `${t[4]}:${t[5]}`, zoneVan(e.params.TZID)), heelDag: false }
}

const LINKS: { platform: NonNullable<IcsEvent['platform']>; re: RegExp }[] = [
  { platform: 'teams', re: /https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s<>"')\]]+/i },
  { platform: 'meet', re: /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?[^\s<>"')\]]*)?/i },
  { platform: 'zoom', re: /https:\/\/(?:[\w-]+\.)?zoom\.us\/(?:j|my|w)\/[^\s<>"')\]]+/i },
  { platform: 'webex', re: /https:\/\/[\w-]+\.webex\.com\/[^\s<>"')\]]+/i },
]

/** De vergaderlink in een tekst (Teams, Meet, Zoom, Webex), opgekuist. */
export function vergaderLink(...teksten: (string | null | undefined)[]): { url: string; platform: NonNullable<IcsEvent['platform']> } | null {
  for (const t of teksten) {
    if (!t) continue
    for (const l of LINKS) {
      const m = t.match(l.re)
      if (m) return { url: m[0].replace(/[.,;>]+$/, ''), platform: l.platform }
    }
  }
  return null
}

function adres(e: Eigenschap): { naam: string | null; email: string | null } {
  const mail = e.waarde.replace(/^mailto:/i, '').trim().toLowerCase()
  return { naam: e.params.CN ? ontsnap(e.params.CN).slice(0, 120) : null, email: /@/.test(mail) ? mail.slice(0, 200) : null }
}

/** Alle VEVENTs uit een agendabestand. */
export function leesIcs(ics: string): IcsEvent[] {
  const uit: IcsEvent[] = []
  let methode: string | null = null
  let huidig: Eigenschap[] | null = null
  let diepte = 0 // VALARM e.d. binnen een VEVENT overslaan
  for (const r of regels(ics)) {
    const e = eigenschap(r)
    if (!e) continue
    if (e.naam === 'METHOD' && !huidig) { methode = e.waarde.trim().toUpperCase(); continue }
    if (e.naam === 'BEGIN' && e.waarde.trim().toUpperCase() === 'VEVENT') { huidig = []; diepte = 0; continue }
    if (!huidig) continue
    if (e.naam === 'BEGIN') { diepte++; continue }
    if (e.naam === 'END' && diepte > 0) { diepte--; continue }
    if (e.naam === 'END' && e.waarde.trim().toUpperCase() === 'VEVENT') {
      const ev = naarEvent(huidig, methode)
      if (ev) uit.push(ev)
      huidig = null
      continue
    }
    if (diepte === 0) huidig.push(e)
  }
  return uit
}

function naarEvent(eig: Eigenschap[], methode: string | null): IcsEvent | null {
  const een = (n: string) => eig.find((e) => e.naam === n) ?? null
  const start = een('DTSTART') ? icsTijd(een('DTSTART')!) : null
  if (!start) return null
  let eind = een('DTEND') ? icsTijd(een('DTEND')!) : null
  if (!eind) {
    const duur = een('DURATION')?.waarde.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/)
    if (duur) eind = { iso: new Date(Date.parse(start.iso) + ((+(duur[1] ?? 0) * 24 + +(duur[2] ?? 0)) * 60 + +(duur[3] ?? 0)) * 60_000).toISOString(), heelDag: start.heelDag }
  }
  const beschrijving = een('DESCRIPTION') ? ontsnap(een('DESCRIPTION')!.waarde) : null
  const locatie = een('LOCATION') ? ontsnap(een('LOCATION')!.waarde) || null : null
  const teamsVeld = eig.find((e) => e.naam === 'X-MICROSOFT-SKYPETEAMSMEETINGURL')?.waarde
  const googleVeld = eig.find((e) => e.naam === 'X-GOOGLE-CONFERENCE')?.waarde
  const link = vergaderLink(teamsVeld, googleVeld, locatie, beschrijving)
  const status = een('STATUS')?.waarde.trim().toUpperCase()
  const org = een('ORGANIZER')
  const deelnemers = eig.filter((e) => e.naam === 'ATTENDEE').map(adres).filter((a): a is { naam: string | null; email: string } => !!a.email)
  return {
    uid: een('UID')?.waarde.trim().slice(0, 300) ?? null,
    methode,
    titel: (een('SUMMARY') ? ontsnap(een('SUMMARY')!.waarde) : '').slice(0, 300) || 'Meeting',
    start_op: start.iso,
    eind_op: eind?.iso ?? null,
    heel_dag: start.heelDag,
    locatie: locatie && link && locatie.includes(link.url) ? (/microsoft teams/i.test(locatie) ? null : locatie) : locatie,
    beschrijving: beschrijving ? kuisBeschrijving(beschrijving).slice(0, 4000) || null : null,
    meet_url: link?.url ?? null,
    platform: link?.platform ?? null,
    organisator: org ? adres(org) : null,
    deelnemers: deelnemers.slice(0, 50),
    geannuleerd: methode === 'CANCEL' || status === 'CANCELLED',
  }
}

/** Teams zet een blok met inbelnummers en "Meer informatie" onder elke uitnodiging: weg ermee. */
export function kuisBeschrijving(t: string): string {
  const knip = t.search(/_{20,}|Microsoft Teams (?:meeting|vergadering|Need help)|Join on your computer|Deelnemen via je computer|Join Zoom Meeting|Deelnemen aan Zoom-vergadering|Join with Google Meet|Deelnemen met Google Meet|-::~:~::~:~/i)
  const kort = (knip > 0 ? t.slice(0, knip) : knip === 0 ? '' : t)
  return kort.replace(/<[^>]+>/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

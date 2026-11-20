// Mail-opvolging — pure regels (client-safe, getest in tests/mail-opvolging.test.ts).
//
// Wat we opvolgen: enkel wat we al voorlegden. Een project komt pas in beeld
// na een gehouden meeting, een verstuurde offerte of een verstuurd contract.
// Daarna kijken we naar de mails tussen ons en die klant:
//   · de klant mailde en wij antwoordden nog niet  → "wacht op ons"
//   · wij mailden en de klant reageert niet        → "geen reactie" (na 3 werkdagen)
//   · meeting gehad en daarna nog niets gestuurd   → "na de meeting" (na 2 werkdagen)
//   · de klant lijkt akkoord te gaan of af te haken (AI-inschatting) → voorstel, een mens beslist
// Gewone communicatie zonder voorafgaande meeting of voorstel volgen we niet op.
// Geen mailconcepten: enkel wat er opgevolgd moet worden.

export const EIGEN_DOMEINEN = ['nextgenmedia.be', 'nextgensolutions.be', 'foundersofflanders.be']

/** Gratis en provider-domeinen: daar koppelen we nooit op domein, enkel op het volledige adres. */
export const ALGEMENE_DOMEINEN = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.be', 'hotmail.nl', 'hotmail.fr', 'outlook.com', 'outlook.be', 'outlook.nl', 'live.com', 'live.be', 'live.nl',
  'msn.com', 'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'yahoo.fr', 'yahoo.be', 'telenet.be', 'skynet.be', 'proximus.be', 'scarlet.be', 'base.be', 'orange.be',
  'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'protonmail.com', 'proton.me', 'kpnmail.nl', 'ziggo.nl', 'mail.be', 'pandora.be', 'aol.com',
])

export function normEmail(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase().replace(/^mailto:/, '')
  const m = s.match(/<([^>]+)>/)
  const e = (m ? m[1] : s).trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null
}

export function domeinVan(email: string | null | undefined): string | null {
  const e = normEmail(email)
  return e ? e.split('@')[1] : null
}

/** Domein uit een websiteadres ("https://www.bakkerij.be/contact" → "bakkerij.be"). */
export function domeinUitWebsite(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    const h = u.hostname.toLowerCase().replace(/^www\./, '')
    return /\./.test(h) ? h : null
  } catch { return null }
}

export function isEigen(email: string | null | undefined, eigen: Set<string> = new Set()): boolean {
  const e = normEmail(email)
  if (!e) return false
  if (eigen.has(e)) return true
  const d = e.split('@')[1]
  return EIGEN_DOMEINEN.some((x) => d === x || d.endsWith(`.${x}`))
}

export type Koppeling = { client_id: string | null; opdracht_id: string | null }
export type Adresboek = { adressen: Map<string, Koppeling>; domeinen: Map<string, string> }

/** Bij welke klant of welk project hoort een van deze adressen? Eerst het volledige adres, dan het domein. */
export function koppel(adressen: (string | null | undefined)[], boek: Adresboek): (Koppeling & { tegenpartij: string }) | null {
  const lijst = adressen.map(normEmail).filter((e): e is string => !!e)
  for (const e of lijst) {
    const k = boek.adressen.get(e)
    if (k) return { ...k, tegenpartij: e }
  }
  for (const e of lijst) {
    const d = e.split('@')[1]
    if (ALGEMENE_DOMEINEN.has(d)) continue
    const c = boek.domeinen.get(d)
    if (c) return { client_id: c, opdracht_id: null, tegenpartij: e }
  }
  return null
}

/** Enkel het nieuwe deel van een antwoord: zonder geciteerde tekst, handtekeningblokken en doorgestuurde koppen. */
export function nieuwDeel(tekst: string, max = 1500): string {
  const regels = tekst.replace(/\r\n/g, '\n').split('\n')
  const uit: string[] = []
  for (const r of regels) {
    const t = r.trim()
    if (/^(On|Op|Le|Am)\s.{4,250}\b(wrote|schreef|a écrit|schrieb)\b.*$/i.test(t)) break
    if (/^-{2,}\s*(Original Message|Oorspronkelijk bericht|Doorgestuurd bericht|Forwarded message)/i.test(t)) break
    if (/^(Van|From|De|Von):\s.+/i.test(t) && uit.length > 0) break
    if (/^_{5,}$/.test(t)) break
    if (t.startsWith('>')) continue
    uit.push(r)
  }
  return uit.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}

// ── Werkdagen ────────────────────────────────────────────────────────────────

/** Aantal volledige werkdagen (ma–vr) tussen twee momenten. Feestdagen tellen mee als werkdag. */
export function werkdagenTussen(van: string | Date, tot: string | Date): number {
  const a = new Date(van), b = new Date(tot)
  if (!(b > a)) return 0
  const dag = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  let n = 0
  for (let t = dag(a) + 86_400_000; t <= dag(b); t += 86_400_000) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) n++
  }
  return n
}

// ── Opvolging per project ────────────────────────────────────────────────────

export type AiSoort = 'akkoord' | 'vraag' | 'weigering' | 'uitstel' | 'anders'
export const AI_SOORT_LABEL: Record<AiSoort, string> = { akkoord: 'lijkt akkoord', vraag: 'stelt een vraag', weigering: 'haakt af', uitstel: 'vraagt uitstel', anders: 'antwoordde' }

export type Gebeurtenis = {
  /** Uniek en blijvend (mail-id, meeting-id …): "Opgevolgd" hangt eraan vast. */
  sleutel: string
  soort: 'meeting' | 'offerte' | 'contract' | 'uit' | 'in'
  op: string
  titel: string
  wie?: string | null
  ai?: AiSoort | null
  samenvatting?: string | null
  fragment?: string | null
}

export type OpvolgStatus = 'wacht_op_ons' | 'geen_reactie' | 'na_meeting' | 'akkoord' | 'weigering' | 'wacht_op_klant'
export type Opvolging = {
  status: OpvolgStatus
  sleutel: string
  sinds: string
  werkdagen: number
  dringend: boolean
  tekst: string
  /** Staat al in een ander blok van het Command Center (offerte of contract opvolgen). */
  elders: boolean
  actie: 'naar_geaccepteerd' | 'naar_verloren' | null
}

export const DREMPELS = { geenReactie: 3, geenReactieDringend: 7, naMeeting: 2, naMeetingDringend: 5, wachtOpOnsDringend: 1 }

const OPGEVOLGDE_FASEN = new Set(['potentieel', 'offerte', 'geaccepteerd', 'contract'])
const dagKort = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })
const wd = (n: number) => `${n} werkdag${n === 1 ? '' : 'en'}`

/**
 * Wat moet er voor dit project opgevolgd worden? Null = niets (nog niets
 * voorgelegd, al getekend of afgerond, of al als opgevolgd aangeduid).
 */
export function bepaalOpvolging(p: { kolom: string; gebeurtenissen: Gebeurtenis[]; afgehandeld?: Set<string>; nu?: Date }): Opvolging | null {
  if (!OPGEVOLGDE_FASEN.has(p.kolom)) return null
  const nu = p.nu ?? new Date()
  const lijst = [...p.gebeurtenissen].filter((g) => new Date(g.op) <= nu).sort((a, b) => a.op.localeCompare(b.op))
  const anker = lijst.findIndex((g) => g.soort === 'meeting' || g.soort === 'offerte' || g.soort === 'contract')
  if (anker < 0) return null
  const laatste = lijst[lijst.length - 1]
  if (p.afgehandeld?.has(laatste.sleutel)) return null
  const n = werkdagenTussen(laatste.op, nu)
  const basis = { sleutel: laatste.sleutel, sinds: laatste.op, werkdagen: n, elders: false }
  const wie = laatste.wie ? `${laatste.wie}` : 'De klant'

  if (laatste.soort === 'in') {
    if (laatste.ai === 'akkoord') {
      return { ...basis, status: 'akkoord', dringend: true, actie: p.kolom === 'potentieel' || p.kolom === 'offerte' ? 'naar_geaccepteerd' : null,
        tekst: `${wie} lijkt akkoord te gaan (mail van ${dagKort(laatste.op)}${laatste.samenvatting ? `: ${laatste.samenvatting}` : ''}). Zet de kaart verder of antwoord.` }
    }
    if (laatste.ai === 'weigering') {
      return { ...basis, status: 'weigering', dringend: true, actie: 'naar_verloren',
        tekst: `${wie} lijkt af te haken (mail van ${dagKort(laatste.op)}${laatste.samenvatting ? `: ${laatste.samenvatting}` : ''}).` }
    }
    const wat = laatste.ai && laatste.ai !== 'anders' ? ` en ${AI_SOORT_LABEL[laatste.ai]}` : ''
    return { ...basis, status: 'wacht_op_ons', dringend: n >= DREMPELS.wachtOpOnsDringend, actie: null,
      tekst: `${wie} mailde op ${dagKort(laatste.op)}${wat}${laatste.titel ? ` ("${laatste.titel}")` : ''}. Nog geen antwoord van ons${n ? `, ${wd(n)}` : ''}.${laatste.samenvatting ? ` ${laatste.samenvatting}` : ''}` }
  }
  if (laatste.soort === 'uit') {
    if (n < DREMPELS.geenReactie) return { ...basis, status: 'wacht_op_klant', dringend: false, actie: null, tekst: `Wacht op reactie op onze mail van ${dagKort(laatste.op)}${laatste.titel ? ` ("${laatste.titel}")` : ''}.` }
    return { ...basis, status: 'geen_reactie', dringend: n >= DREMPELS.geenReactieDringend, actie: null,
      tekst: `Geen reactie op onze mail van ${dagKort(laatste.op)}${laatste.titel ? ` ("${laatste.titel}")` : ''}, al ${wd(n)}. Volg op.` }
  }
  if (laatste.soort === 'offerte' || laatste.soort === 'contract') {
    const wat = laatste.soort === 'offerte' ? 'de offerte' : 'het contract'
    return { ...basis, elders: true, status: n >= DREMPELS.geenReactie ? 'geen_reactie' : 'wacht_op_klant', dringend: n >= DREMPELS.geenReactieDringend, actie: null,
      tekst: n >= DREMPELS.geenReactie ? `Geen reactie op ${wat} van ${dagKort(laatste.op)}, al ${wd(n)}. Volg op.` : `Wacht op reactie op ${wat} van ${dagKort(laatste.op)}.` }
  }
  // Laatste = een meeting.
  if (n < DREMPELS.naMeeting) return null
  return { ...basis, status: 'na_meeting', dringend: n >= DREMPELS.naMeetingDringend, actie: null,
    tekst: `Meeting op ${dagKort(laatste.op)}${laatste.titel ? ` ("${laatste.titel}")` : ''}. Sindsdien nog niets gestuurd, al ${wd(n)}.` }
}

/** Telt deze opvolging als "op te volgen" in het Command Center? */
export const moetOpvolgen = (o: Opvolging | null): o is Opvolging => !!o && !o.elders && o.status !== 'wacht_op_klant'

export const STATUS_LABEL: Record<OpvolgStatus, string> = {
  wacht_op_ons: 'Klant wacht op ons', geen_reactie: 'Geen reactie', na_meeting: 'Na de meeting', akkoord: 'Lijkt akkoord', weigering: 'Lijkt af te haken', wacht_op_klant: 'Wacht op de klant',
}

/**
 * Algemene contracten — pure regels (getest in tests/algemene-contracten.test.ts).
 *
 * Contracten van NextGenMedia zelf die geen klantovereenkomst zijn:
 * huurovereenkomsten, verzekeringen, commissieregelingen, partnerships, NDA's …
 * In mappen (standaard en eigen), met labels, te filteren en te zoeken.
 *
 * E-sign: een opgeladen PDF tekenen wij (zaakvoerder) met een getekende
 * handtekening; eronder komen naam en datum en uur in Belgische tijd. Wil de
 * andere partij ook tekenen, dan krijgt die een persoonlijke link per mail en
 * tekent die op de plek die wij aanduidden. Elke handtekening komt op een
 * nieuwe kopie; het opgeladen origineel blijft altijd ongewijzigd.
 */
import { controleerZone, type OnsZone } from '@/lib/contracten/tegenhandtekening'

export type Zone = OnsZone

export type AcStatus = 'wacht_op_ons' | 'wacht_op_partij' | 'getekend' | 'bewaard'

export type AlgemeenContract = {
  id: string
  map_id: string | null
  titel: string
  tegenpartij: string | null
  tegenpartij_email: string | null
  labels: string[]
  notitie: string | null
  begin_datum: string | null
  eind_datum: string | null
  bestand_naam: string | null
  bestand_grootte: number | null
  ons_nodig: boolean
  ondertekenaar: string | null
  ons_zone: Zone | null
  ons_getekend_op: string | null
  ons_getekend_door: string | null
  /** Wie van ons tekent (Marco, Bram, Chiara). Leeg = één van ons volstaat. */
  ons_tekenaars?: string[] | null
  /** De plaats van de handtekening per persoon, zolang die nog niet tekende. */
  ons_zones?: Record<string, Zone> | null
  /** Elke handtekening van ons apart (sinds 27 nov 2026). */
  ons_handtekeningen?: OnsHandtekening[] | null
  partij_nodig: boolean
  partij_zone: Zone | null
  partij_getekend_op: string | null
  partij_naam: string | null
  partij_geopend_op: string | null
  laatst_verstuurd_op: string | null
  gearchiveerd_op: string | null
  created_at: string
  created_by: string | null
  versie: number
}

export type Map = { id: string; naam: string; volgorde: number; parent_id?: string | null }

// ── Mappenstructuur (mappen in mappen) ──────────────────────────────────────

/** Hoe diep mappen mogen gaan: Verzekeringen / Auto / Bestelwagen. */
export const MAX_DIEPTE = 4

const ouderVan = (m: Map) => m.parent_id ?? null
const opVolgorde = (a: Map, b: Map) => a.volgorde - b.volgorde || a.naam.localeCompare(b.naam, 'nl')

/** De mappen direct in een map (null = bovenaan). */
export const kinderen = (mappen: Map[], ouder: string | null): Map[] => mappen.filter((m) => ouderVan(m) === ouder).sort(opVolgorde)

/** Het pad van bovenaan tot en met deze map (beschermd tegen een lus). */
export function padVan(mappen: Map[], id: string | null): Map[] {
  const pad: Map[] = []
  let huidig = id ? mappen.find((m) => m.id === id) : undefined
  while (huidig && pad.length < 20 && !pad.includes(huidig)) {
    pad.unshift(huidig)
    const o = ouderVan(huidig)
    huidig = o ? mappen.find((m) => m.id === o) : undefined
  }
  return pad
}

/** "Verzekeringen / Auto", of null zonder map. */
export const padNaam = (mappen: Map[], id: string | null): string | null => {
  const p = padVan(mappen, id)
  return p.length ? p.map((m) => m.naam).join(' / ') : null
}

/** Alle mappen onder deze map (niet de map zelf). */
export function nakomelingen(mappen: Map[], id: string): Set<string> {
  const uit = new Set<string>()
  const stapel = [id]
  while (stapel.length) {
    const x = stapel.pop()!
    for (const k of mappen) if (ouderVan(k) === x && !uit.has(k.id) && k.id !== id) { uit.add(k.id); stapel.push(k.id) }
  }
  return uit
}

/** Mag deze map in die andere (null = bovenaan)? Niet in zichzelf of een eigen submap, en niet te diep. */
export function magIn(mappen: Map[], id: string | null, ouder: string | null): boolean {
  if (ouder === null) return true
  if (!mappen.some((m) => m.id === ouder)) return false
  if (id && (ouder === id || nakomelingen(mappen, id).has(ouder))) return false
  const diepteOnder = id ? Math.max(0, ...Array.from(nakomelingen(mappen, id)).map((k) => padVan(mappen, k).length - padVan(mappen, id).length)) : 0
  return padVan(mappen, ouder).length + 1 + diepteOnder <= MAX_DIEPTE
}

/** Alle mappen in boomvolgorde, met diepte en volledig pad (voor keuzelijsten en de boom). */
export function boom(mappen: Map[]): { map: Map; diepte: number; pad: string }[] {
  const uit: { map: Map; diepte: number; pad: string }[] = []
  const loop = (ouder: string | null, diepte: number, prefix: string) => {
    if (diepte > MAX_DIEPTE + 2) return
    for (const m of kinderen(mappen, ouder)) {
      const pad = prefix ? `${prefix} / ${m.naam}` : m.naam
      uit.push({ map: m, diepte, pad })
      loop(m.id, diepte + 1, pad)
    }
  }
  loop(null, 0, '')
  return uit
}

/** Hoeveel (niet-gearchiveerde) contracten in deze map en alle submappen. */
export function aantalIn(contracten: Pick<AlgemeenContract, 'map_id' | 'gearchiveerd_op'>[], mappen: Map[], id: string): number {
  const alle = new Set([id, ...Array.from(nakomelingen(mappen, id))])
  return contracten.filter((c) => !c.gearchiveerd_op && c.map_id && alle.has(c.map_id)).length
}

/** De mappen waarmee de module start; eigen mappen komen erbij. */
export const STANDAARD_MAPPEN = ['Huurovereenkomsten', 'Verzekeringen', 'Commissieregelingen', 'Partnerships', "NDA's", 'Andere']

/** Wie namens NextGenMedia tekent (zelfde keuze als bij projecten). Oud veld, enkel nog voor contracten van vóór 27 nov 2026. */
export const ONDERTEKENAARS = ['Marco', 'Bram', 'Chiara', 'Gezamenlijke lead'] as const

// ── Onze handtekeningen (meerdere mensen) ───────────────────────────────────

/** Wie namens NextGen Agency BV kan tekenen. Elk tekent met het eigen account. */
export const PERSONEN = ['Marco', 'Bram', 'Chiara'] as const
export type Persoon = (typeof PERSONEN)[number]

export type OnsHandtekening = { persoon: string; naam: string; email: string | null; op: string; zone: Zone | null }

/** De persoon bij een naam of e-mail: "Chiara Walmagh" of "chiara@…" = Chiara. Onbekend = de voornaam zelf. */
export function persoonVan(naam: string | null | undefined): string | null {
  const v = String(naam ?? '').trim().split(/[\s@.]+/)[0] ?? ''
  if (!v) return null
  return PERSONEN.find((p) => p.toLowerCase() === v.toLowerCase()) ?? v.charAt(0).toUpperCase() + v.slice(1)
}

type OnsVelden = Pick<AlgemeenContract, 'ons_nodig' | 'ondertekenaar' | 'ons_getekend_op' | 'ons_getekend_door' | 'ons_zone'> & Partial<Pick<AlgemeenContract, 'ons_tekenaars' | 'ons_handtekeningen' | 'ons_zones' | 'gearchiveerd_op'>>

/** Alle handtekeningen van ons. Een handtekening van vóór 27 nov 2026 staat enkel in ons_getekend_* en telt mee. */
export function handtekeningenOns(c: OnsVelden): OnsHandtekening[] {
  if (c.ons_handtekeningen?.length) return c.ons_handtekeningen
  if (!c.ons_getekend_op) return []
  const naam = c.ons_getekend_door ?? 'NextGen Agency BV'
  return [{ persoon: persoonVan(naam) ?? naam, naam, email: null, op: c.ons_getekend_op, zone: c.ons_zone ?? null }]
}

/** Wie van ons moet tekenen. Leeg = één van ons volstaat (zo werkte het vóór 27 nov 2026, of niemand gekozen). */
export function tekenaarsOns(c: OnsVelden): string[] {
  if (c.ons_tekenaars?.length) return Array.from(new Set(c.ons_tekenaars))
  const o = c.ondertekenaar
  return o && (PERSONEN as readonly string[]).includes(o) ? [o] : []
}

const getekend = (h: OnsHandtekening[], p: string) => h.some((x) => x.persoon.toLowerCase() === p.toLowerCase())

/** Zijn al onze handtekeningen er? */
export function onsKlaar(c: OnsVelden, h: OnsHandtekening[] = handtekeningenOns(c)): boolean {
  const lijst = tekenaarsOns(c)
  return lijst.length ? lijst.every((p) => getekend(h, p)) : h.length > 0
}

/** Wie van ons moet nog tekenen (voor de taken). Niemand gekozen en nog niet getekend = Marco en Bram, zoals vroeger. */
export function wieMoetNog(c: OnsVelden): string[] {
  if (!c.ons_nodig || c.gearchiveerd_op) return []
  const h = handtekeningenOns(c)
  const lijst = tekenaarsOns(c)
  if (lijst.length) return lijst.filter((p) => !getekend(h, p))
  return h.length ? [] : ['Marco', 'Bram']
}

/** "Bram en Chiara", "Marco, Bram en Chiara". */
export const namenLijst = (l: string[]): string => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} en ${l[l.length - 1]}`)

/** Mag deze persoon (nog) tekenen? null = ja. Wie niet gekozen werd, mag ook tekenen en komt er dan bij. */
export function redenOnsNiet(c: OnsVelden, persoon?: string | null): string | null {
  if (c.gearchiveerd_op) return 'Dit contract is gearchiveerd.'
  if (!c.ons_nodig) return 'Voor dit contract is geen handtekening van ons nodig. Zet het aan bij de gegevens.'
  if (!persoon) return 'Je naam ontbreekt op je account. Vul ze in bij Mijn account.'
  if (getekend(handtekeningenOns(c), persoon)) return 'Je hebt dit contract al ondertekend.'
  return null
}

/** Waar de handtekening van deze persoon komt: de eigen plaats, anders naast de vorige handtekening, anders de standaardplek. */
export function zoneVoor(c: OnsVelden, persoon: string, paginas = 1): Zone {
  const eigen = c.ons_zones?.[persoon]
  if (eigen) return eigen
  const h = handtekeningenOns(c)
  if (!h.length && c.ons_zone) return c.ons_zone
  const vorige = [...h].reverse().find((x) => x.zone)?.zone
  if (vorige) return { ...vorige, x: vorige.x <= 45 ? vorige.x + 40 : Math.max(2, vorige.x - 40) }
  return standaardZone('ons', paginas)
}

/** Waar staat het contract? Eerst wij (als wij moeten tekenen), dan de andere partij. */
export function statusVan(c: Pick<AlgemeenContract, 'ons_nodig' | 'ons_getekend_op' | 'partij_nodig' | 'partij_getekend_op'>): AcStatus {
  if (c.ons_nodig && !c.ons_getekend_op) return 'wacht_op_ons'
  if (c.partij_nodig && !c.partij_getekend_op) return 'wacht_op_partij'
  return c.ons_nodig || c.partij_nodig ? 'getekend' : 'bewaard'
}

export const STATUS_INFO: Record<AcStatus, { label: string; cls: string }> = {
  wacht_op_ons: { label: 'Wacht op onze handtekening', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  wacht_op_partij: { label: 'Wacht op de andere partij', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  getekend: { label: 'Getekend', cls: 'bg-green-50 text-green-700 border-green-200' },
  bewaard: { label: 'Bewaard', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
}

/** Het label van de status, met de naam van de andere partij als we die kennen. */
export const statusLabel = (c: Parameters<typeof statusVan>[0] & { tegenpartij?: string | null } & Partial<OnsVelden>): string => {
  const s = statusVan(c)
  if (s === 'wacht_op_partij' && c.tegenpartij) return `Wacht op ${c.tegenpartij}`
  if (s === 'wacht_op_ons' && 'ondertekenaar' in c) {
    const nog = tekenaarsOns(c as OnsVelden).length ? wieMoetNog(c as OnsVelden) : []
    if (nog.length) return `Wacht op ${namenLijst(nog)}`
  }
  return STATUS_INFO[s].label
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
const DATUM = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tekst = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return s ? s.slice(0, max) : null
}

/** Labels: opgekuist, zonder dubbels (hoofdletters tellen niet), hoogstens 10 van 30 tekens. */
export function controleerLabels(v: unknown): string[] {
  const lijst = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  const uit: string[] = []
  for (const x of lijst) {
    const l = tekst(x, 30)
    if (l && !uit.some((u) => u.toLowerCase() === l.toLowerCase())) uit.push(l)
  }
  return uit.slice(0, 10)
}

export type ContractVelden = {
  titel: string; map_id: string | null; tegenpartij: string | null; tegenpartij_email: string | null
  labels: string[]; notitie: string | null; begin_datum: string | null; eind_datum: string | null
  ons_nodig: boolean; partij_nodig: boolean; ondertekenaar: string | null; ons_tekenaars: string[] | null
}

/**
 * De gegevens van een contract uit een verzoek. `deel` = enkel de velden die
 * meekomen (aanpassen); anders is de titel verplicht (nieuw).
 */
export function controleerVelden(b: Record<string, unknown>, deel = false): { velden: Partial<ContractVelden> } | { fout: string } {
  const v: Partial<ContractVelden> = {}
  const heeft = (k: string) => !deel || k in b
  if (heeft('titel')) {
    const t = tekst(b.titel, 200)
    if (!t) return { fout: 'Geef het contract een titel.' }
    v.titel = t
  }
  if (heeft('map_id')) {
    if (b.map_id !== null && b.map_id !== undefined && b.map_id !== '' && !(typeof b.map_id === 'string' && UUID.test(b.map_id))) return { fout: 'Ongeldige map.' }
    v.map_id = typeof b.map_id === 'string' && b.map_id ? b.map_id : null
  }
  if (heeft('tegenpartij')) v.tegenpartij = tekst(b.tegenpartij, 200)
  if (heeft('tegenpartij_email')) {
    const e = tekst(b.tegenpartij_email, 200)
    if (e && !EMAIL.test(e)) return { fout: 'Het e-mailadres van de andere partij klopt niet.' }
    v.tegenpartij_email = e ? e.toLowerCase() : null
  }
  if (heeft('labels')) v.labels = controleerLabels(b.labels)
  if (heeft('notitie')) v.notitie = typeof b.notitie === 'string' && b.notitie.trim() ? b.notitie.trim().slice(0, 4000) : null
  for (const k of ['begin_datum', 'eind_datum'] as const) {
    if (!heeft(k)) continue
    const d = b[k]
    if (d !== null && d !== undefined && d !== '' && !(typeof d === 'string' && DATUM.test(d))) return { fout: 'Ongeldige datum.' }
    v[k] = typeof d === 'string' && d ? d : null
  }
  if (v.begin_datum && v.eind_datum && v.eind_datum < v.begin_datum) return { fout: 'De einddatum ligt voor de begindatum.' }
  if (heeft('ons_nodig')) v.ons_nodig = b.ons_nodig !== false
  if (heeft('partij_nodig')) v.partij_nodig = b.partij_nodig === true
  if (heeft('ondertekenaar')) {
    const o = b.ondertekenaar
    if (o !== null && o !== undefined && o !== '' && !ONDERTEKENAARS.includes(o as (typeof ONDERTEKENAARS)[number])) return { fout: 'Kies Marco, Bram, Chiara of Gezamenlijke lead.' }
    v.ondertekenaar = typeof o === 'string' && o ? o : null
  }
  // Wie van ons tekent: Marco, Bram en/of Chiara. Leeg = één van ons. Het oude veld volgt mee.
  if ('ons_tekenaars' in b) {
    const l = Array.isArray(b.ons_tekenaars) ? b.ons_tekenaars : []
    if (l.some((x) => !(PERSONEN as readonly unknown[]).includes(x))) return { fout: 'Kies Marco, Bram en/of Chiara.' }
    const tekenaars = PERSONEN.filter((p) => l.includes(p))
    // Wie aangeduid is, moet tekenen: wie "Wij tekenen" aanzet, duidt minstens één persoon aan.
    if (!tekenaars.length && (v.ons_nodig ?? b.ons_nodig !== false)) return { fout: 'Duid aan wie van ons tekent (Marco, Bram en/of Chiara).' }
    v.ons_tekenaars = tekenaars.length ? tekenaars : null
    v.ondertekenaar = tekenaars[0] ?? null
  }
  return { velden: v }
}

/** Een mapnaam: 1 tot 60 tekens. */
export function controleerMapnaam(v: unknown): { naam: string } | { fout: string } {
  const n = tekst(v, 60)
  return n ? { naam: n } : { fout: 'Geef de map een naam.' }
}

/** Een zone uit de databank of een verzoek, of null. */
export const zoneOfNull = (v: unknown, paginas?: number): Zone | null => (v && typeof v === 'object' ? controleerZone(v, paginas) : null)

/** Standaardplekken: wij links onderaan op de laatste pagina, de andere partij rechts ernaast. */
export const standaardZone = (wie: 'ons' | 'partij', paginas = 1): Zone =>
  ({ page: Math.max(1, paginas), x: wie === 'ons' ? 8 : 55, y: 78, w: 200, h: 70 })

export type Filter = { map?: string | null; label?: string | null; status?: AcStatus | 'loopt_af' | null; zoek?: string | null; archief?: boolean }

/** Loopt binnen 60 dagen af (verzekering of huur vernieuwen), of is net verlopen. */
export function looptAf(c: Pick<AlgemeenContract, 'eind_datum'>, vandaag: string): boolean {
  if (!c.eind_datum) return false
  const d = (Date.parse(c.eind_datum) - Date.parse(vandaag)) / 86_400_000
  return d <= 60 && d >= -30
}

/** Filteren en zoeken (titel, andere partij, e-mail, labels, notitie, bestandsnaam). */
export function filter<T extends AlgemeenContract>(lijst: T[], f: Filter, vandaag: string, mapNaam?: (id: string | null) => string | null): T[] {
  const woorden = (f.zoek ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  return lijst.filter((c) => {
    if (!!f.archief !== !!c.gearchiveerd_op) return false
    if (f.map === 'zonder' ? c.map_id : f.map && c.map_id !== f.map) return false
    if (f.label && !c.labels.some((l) => l.toLowerCase() === f.label!.toLowerCase())) return false
    if (f.status === 'loopt_af' ? !looptAf(c, vandaag) : f.status && statusVan(c) !== f.status) return false
    if (woorden.length) {
      const hooi = [c.titel, c.tegenpartij, c.tegenpartij_email, c.notitie, c.bestand_naam, mapNaam?.(c.map_id), ...c.labels].filter(Boolean).join(' ').toLowerCase()
      if (!woorden.every((w) => hooi.includes(w))) return false
    }
    return true
  })
}

/** Alle labels die in gebruik zijn, alfabetisch, met hoe vaak. */
export function labelsInGebruik(lijst: Pick<AlgemeenContract, 'labels' | 'gearchiveerd_op'>[]): { label: string; aantal: number }[] {
  const m = new Map<string, { label: string; aantal: number }>()
  for (const c of lijst) {
    if (c.gearchiveerd_op) continue
    for (const l of c.labels) {
      const k = l.toLowerCase()
      const x = m.get(k) ?? { label: l, aantal: 0 }
      x.aantal++
      m.set(k, x)
    }
  }
  return Array.from(m.values()).sort((a, b) => a.label.localeCompare(b.label, 'nl'))
}

/** Een bestandsnaam voor de download: titel + "getekend". */
export function downloadNaam(c: Pick<AlgemeenContract, 'titel' | 'ons_getekend_op' | 'partij_getekend_op'> & Partial<Pick<AlgemeenContract, 'ons_handtekeningen'>>): string {
  const basis = c.titel.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'contract'
  return `${basis}${c.ons_getekend_op || c.partij_getekend_op || c.ons_handtekeningen?.length ? '-getekend' : ''}.pdf`
}

/** Mag de andere partij via de link (nog) tekenen? null = ja, anders waarom niet. */
export function redenPartijNiet(c: Pick<AlgemeenContract, 'partij_nodig' | 'partij_getekend_op' | 'gearchiveerd_op'>): string | null {
  if (c.gearchiveerd_op) return 'Dit document is niet meer beschikbaar.'
  if (!c.partij_nodig) return 'Voor dit document is geen handtekening van jou gevraagd.'
  if (c.partij_getekend_op) return 'Je hebt dit document al ondertekend.'
  return null
}


/** De regels onder een handtekening op de PDF: naam (en voor wie) en het moment van tekenen. */
export function blokRegels(o: { naam: string; namens?: string | null; datum: string }): string[] {
  return [o.namens ? `${o.naam} · ${o.namens}` : o.naam, o.datum]
}

/** Standaardtekst van de mail: ter ondertekening, of het getekende document. */
export function mailVoorstel(c: Pick<AlgemeenContract, 'titel' | 'tegenpartij' | 'partij_nodig' | 'partij_getekend_op' | 'ons_getekend_op'>): { onderwerp: string; tekst: string; knop: string } {
  const aanhef = `Beste${c.tegenpartij ? ` ${c.tegenpartij}` : ''},`
  if (c.partij_nodig && !c.partij_getekend_op) {
    return {
      onderwerp: `Ter ondertekening: ${c.titel}`,
      tekst: `${aanhef}\n\nHierbij het document "${c.titel}"${c.ons_getekend_op ? ', door ons al ondertekend' : ''}. Via de knop hieronder kan je het bekijken en digitaal ondertekenen, zonder af te drukken. Daarna kan je de getekende versie meteen downloaden.\n\nMet vriendelijke groet,\nNextGenMedia`,
      knop: 'Bekijken en ondertekenen',
    }
  }
  return {
    onderwerp: `Ondertekend: ${c.titel}`,
    tekst: `${aanhef}\n\nIn bijlage het ondertekende document "${c.titel}". Je kan het ook bekijken en downloaden via de knop hieronder.\n\nMet vriendelijke groet,\nNextGenMedia`,
    knop: 'Document bekijken',
  }
}

// ── Gegevens uit de PDF (AI-voorstel bij het opladen) ───────────────────────

export type AcVoorstel = {
  titel: string | null
  map_id: string | null
  tegenpartij: string | null
  tegenpartij_email: string | null
  begin_datum: string | null
  eind_datum: string | null
  labels: string[]
  /** Moet NextGen Agency BV tekenen, en wie van ons (zoals het in het document staat). */
  ons_nodig: boolean | null
  ons_tekenaars: string[]
  partij_nodig: boolean | null
  notitie: string | null
}

const LEEG_VOORSTEL: AcVoorstel = { titel: null, map_id: null, tegenpartij: null, tegenpartij_email: null, begin_datum: null, eind_datum: null, labels: [], ons_nodig: null, ons_tekenaars: [], partij_nodig: null, notitie: null }

const echteDatum = (v: unknown): string | null => {
  if (typeof v !== 'string' || !DATUM.test(v)) return null
  const d = new Date(`${v}T12:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null
}

/**
 * Het antwoord van de AI nakijken: enkel wat klopt komt mee. Een map enkel als die
 * bestaat (op pad of naam), wie van ons tekent enkel Marco, Bram of Chiara, eigen
 * bedrijf nooit als andere partij. Niets wordt bewaard: het scherm vult enkel lege velden in.
 */
export function leesAcVoorstel(text: string, mappen: Map[]): AcVoorstel {
  const a = text.indexOf('{'), z = text.lastIndexOf('}')
  if (a === -1 || z <= a) return { ...LEEG_VOORSTEL }
  let p: Record<string, unknown>
  try { p = JSON.parse(text.slice(a, z + 1)) } catch { return { ...LEEG_VOORSTEL } }
  const v: AcVoorstel = { ...LEEG_VOORSTEL }
  v.titel = tekst(p.titel, 200)
  const mapTekst = tekst(p.map, 200)?.toLowerCase()
  if (mapTekst) {
    const b = boom(mappen)
    v.map_id = b.find((x) => x.pad.toLowerCase() === mapTekst)?.map.id ?? b.find((x) => x.map.naam.toLowerCase() === mapTekst)?.map.id ?? null
  }
  const partij = tekst(p.tegenpartij, 200)
  v.tegenpartij = partij && !/^next\s*gen/i.test(partij) ? partij : null
  const e = tekst(p.tegenpartij_email, 200)?.toLowerCase() ?? null
  v.tegenpartij_email = e && EMAIL.test(e) && !/@nextgen(media|solutions|agency)\.be$/.test(e) ? e : null
  v.begin_datum = echteDatum(p.begin_datum)
  v.eind_datum = echteDatum(p.eind_datum)
  if (v.begin_datum && v.eind_datum && v.eind_datum < v.begin_datum) v.eind_datum = null
  v.labels = controleerLabels(Array.isArray(p.labels) ? p.labels.slice(0, 4) : [])
  v.ons_nodig = typeof p.ons_nodig === 'boolean' ? p.ons_nodig : null
  const wie = Array.isArray(p.ons_tekenaars) ? p.ons_tekenaars.map((x) => persoonVan(String(x))) : []
  v.ons_tekenaars = PERSONEN.filter((x) => wie.includes(x))
  if (v.ons_tekenaars.length && v.ons_nodig === null) v.ons_nodig = true
  v.partij_nodig = typeof p.partij_nodig === 'boolean' ? p.partij_nodig : null
  const n = typeof p.notitie === 'string' ? p.notitie.trim().slice(0, 600) : ''
  v.notitie = n || null
  return v
}

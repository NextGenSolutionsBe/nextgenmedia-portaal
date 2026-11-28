/**
 * Rollen, rechten en plug-and-play (verbeterplan fase 4, 27 nov 2026).
 * Pure regels, getest in tests/team-rollen.test.ts. Edge-veilig.
 *
 * Een rolsjabloon is een vertrekpunt voor een nieuw account: rol, modules,
 * bedrijf, startpagina en een onboarding-checklist. Toepassen zet die waarden
 * op het account; daarna kan je alles nog per persoon aanpassen. De bestaande
 * snelle sets (STAFF_PRESETS) blijven.
 */
import { ADMIN_MODULES } from '@/lib/staff'
import { MEDIA, SOLUTIONS } from '@/lib/bedrijven/model'

export { MEDIA, SOLUTIONS }
export type Bedrijf = typeof MEDIA | typeof SOLUTIONS
export const BEDRIJVEN: { key: Bedrijf; label: string }[] = [
  { key: MEDIA, label: 'NextGenMedia' },
  { key: SOLUTIONS, label: 'NextGenSolutions' },
]

export type StaffRol = 'beheerder' | 'medewerker' | 'alleen_lezen'
const ROLLEN: StaffRol[] = ['beheerder', 'medewerker', 'alleen_lezen']

export type RolSjabloon = {
  key: string
  naam: string
  omschrijving: string | null
  rol: StaffRol
  modules: string[]
  /** Leeg = alle bedrijven. */
  bedrijven: Bedrijf[]
  onboarding: string[]
  startpagina: string | null
  volgorde: number
  actief: boolean
  standaard: boolean
}

const ALGEMENE_STAPPEN = [
  'Inloggen en tweestapsverificatie instellen',
  'Mijn account: foto en naam nakijken',
  'Rondleiding in de app (Command Center, Agenda, je modules)',
  'ClickUp koppelen (Agenda → Instellingen → ClickUp)',
  'Beschikbaarheid invullen (Agenda → Instellingen)',
  'Werkinstructies van je rol lezen (Informatief)',
  'Personeelsdossier aanvullen (contract, documenten)',
]

/** De zeven startsjablonen. Ze staan ook als rijen in `rol_sjablonen` en zijn daar aan te passen. */
export const START_SJABLONEN: RolSjabloon[] = [
  {
    key: 'zaakvoerder', naam: 'Zaakvoerder', omschrijving: 'Alles zien en beheren. Een hoofdbeheerder blijft een apart admin-account.',
    rol: 'beheerder', modules: [], bedrijven: [], startpagina: '/admin', volgorde: 1, actief: true, standaard: true,
    onboarding: [...ALGEMENE_STAPPEN, 'Financieel overzicht en vesting doornemen'],
  },
  {
    key: 'operations', naam: 'Operations', omschrijving: 'Klanten, projecten, contracten, meetings en levering opvolgen.',
    rol: 'medewerker', modules: ['agenda', 'clients', 'contracts', 'aanvragen', 'offertes', 'opdrachten', 'meetings', 'opleveringen', 'shoots', 'content', 'uploads', 'formulieren', 'materiaal', 'email', 'info'],
    bedrijven: [], startpagina: '/admin', volgorde: 2, actief: true, standaard: true,
    onboarding: [...ALGEMENE_STAPPEN, 'Projecten en Op te volgen doornemen', 'Meeting Inplanner: een meeting plannen'],
  },
  {
    key: 'uitvoerder_solutions', naam: 'Uitvoerder Solutions', omschrijving: 'Werkt aan AI-automatisatie en software voor NextGenSolutions.',
    rol: 'medewerker', modules: ['agenda', 'ngs_levering', 'meetings', 'uploads', 'info'],
    bedrijven: [SOLUTIONS], startpagina: '/admin/nextgensolutions/levering', volgorde: 3, actief: true, standaard: true,
    onboarding: [...ALGEMENE_STAPPEN, 'Levering van NextGenSolutions doornemen (workflows, user stories, Care)', 'Briefing van 30 minuten met Marco over de werkwijze'],
  },
  {
    key: 'uitvoerder_media', naam: 'Uitvoerder Media', omschrijving: 'Content, shoots en opleveringen voor NextGenMedia.',
    rol: 'medewerker', modules: ['agenda', 'content', 'metricool', 'shoots', 'opleveringen', 'uploads', 'blogs', 'clients', 'info'],
    bedrijven: [MEDIA], startpagina: '/admin/agenda', volgorde: 4, actief: true, standaard: true,
    onboarding: [...ALGEMENE_STAPPEN, 'Contentkalender en Metricool doornemen', 'Shoot planner en opleveringen bekijken'],
  },
  {
    key: 'appointment_setter', naam: 'Appointment setter', omschrijving: 'Afspraken boeken voor de zaakvoerders.',
    rol: 'medewerker', modules: ['sales', 'meetings', 'agenda'], bedrijven: [], startpagina: '/admin/meetings', volgorde: 5, actief: true, standaard: true,
    onboarding: [...ALGEMENE_STAPPEN, 'Meeting Inplanner: een verkoopafspraak boeken'],
  },
  {
    key: 'lead_onderzoeker', naam: 'Lead-onderzoeker', omschrijving: 'Bedrijven opzoeken en aanvullen in Account-based marketing.',
    rol: 'medewerker', modules: ['opdrachten', 'agenda', 'info'], bedrijven: [], startpagina: '/admin/opdrachten', volgorde: 6, actief: true, standaard: true,
    onboarding: [...ALGEMENE_STAPPEN, 'Account-based marketing: importeren en aanvullen'],
  },
  {
    key: 'stagiair', naam: 'Stagiair', omschrijving: 'Leest mee en werkt aan wat in de agenda staat.',
    rol: 'medewerker', modules: ['agenda', 'info', 'uploads'], bedrijven: [], startpagina: '/admin/agenda', volgorde: 7, actief: true, standaard: true,
    onboarding: [...ALGEMENE_STAPPEN, 'Stageovereenkomst in het personeelsdossier', 'Eerste week: dagelijks Dag afsluiten'],
  },
]

const KEY = /^[a-z][a-z0-9_]{1,40}$/
const geldigeModules = () => new Set(ADMIN_MODULES.map((m) => m.key))
const isBedrijf = (v: unknown): v is Bedrijf => v === MEDIA || v === SOLUTIONS

/** Alleen gekende modules, in vaste volgorde, zonder dubbels. */
export function netteModules(lijst: unknown): string[] {
  const geldig = geldigeModules()
  const s = new Set((Array.isArray(lijst) ? lijst : []).filter((k): k is string => typeof k === 'string' && geldig.has(k)))
  return ADMIN_MODULES.map((m) => m.key).filter((k) => s.has(k))
}

/** Bedrijven voor een account: leeg = alle. Beide aangeduid = ook alle. */
export function netteBedrijven(lijst: unknown): Bedrijf[] {
  const s = new Set((Array.isArray(lijst) ? lijst : []).filter(isBedrijf))
  if (s.size >= BEDRIJVEN.length) return []
  return BEDRIJVEN.map((b) => b.key).filter((k) => s.has(k))
}

/** Is iemand beperkt tot één bedrijf? Dan is dat de vaste weergave (de schakelaar Alles/Media/Solutions is dicht). */
export function vastBedrijf(bedrijven: unknown): Bedrijf | null {
  const b = netteBedrijven(bedrijven)
  return b.length === 1 ? b[0] : null
}

export function bedrijvenLabel(bedrijven: unknown): string {
  const b = netteBedrijven(bedrijven)
  return b.length ? b.map((k) => BEDRIJVEN.find((x) => x.key === k)?.label ?? k).join(', ') : 'Alle bedrijven'
}

const netteStappen = (lijst: unknown): string[] =>
  Array.from(new Set((Array.isArray(lijst) ? lijst : []).map((s) => String(s ?? '').trim().slice(0, 160)).filter(Boolean))).slice(0, 40)

/** Een startpagina is een pad in de admin, nooit een link naar buiten. */
export function netteStartpagina(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^\/admin(\/[a-z0-9\-/]*)?$/i.test(s) ? s : null
}

/** Invoer van een sjabloon nakijken. Geeft het nette sjabloon of een fout in gewone taal. */
export function controleerSjabloon(b: Record<string, unknown>, bestaand?: RolSjabloon | null): { ok: true; sjabloon: RolSjabloon } | { ok: false; fout: string } {
  const naam = String(b.naam ?? '').trim().slice(0, 80)
  if (!naam) return { ok: false, fout: 'Geef het sjabloon een naam.' }
  const key = bestaand?.key ?? String(b.key ?? '').trim()
  if (!KEY.test(key)) return { ok: false, fout: 'Sleutel: kleine letters, cijfers en _ (bv. uitvoerder_media).' }
  const rol = ROLLEN.find((r) => r === b.rol) ?? 'medewerker'
  return {
    ok: true,
    sjabloon: {
      key, naam, omschrijving: String(b.omschrijving ?? '').trim().slice(0, 300) || null, rol,
      modules: netteModules(b.modules), bedrijven: netteBedrijven(b.bedrijven), onboarding: netteStappen(b.onboarding),
      startpagina: netteStartpagina(b.startpagina), volgorde: Number.isFinite(Number(b.volgorde)) ? Math.round(Number(b.volgorde)) : bestaand?.volgorde ?? 99,
      actief: b.actief !== false, standaard: bestaand?.standaard ?? false,
    },
  }
}

/** Een rij uit de databank netjes maken (ontbrekende velden = leeg). */
export function naarSjabloon(r: Record<string, unknown>): RolSjabloon {
  return {
    key: String(r.key), naam: String(r.naam ?? r.key), omschrijving: (r.omschrijving as string | null) ?? null,
    rol: ROLLEN.find((x) => x === r.rol) ?? 'medewerker', modules: netteModules(r.modules), bedrijven: netteBedrijven(r.bedrijven),
    onboarding: netteStappen(r.onboarding), startpagina: netteStartpagina(r.startpagina), volgorde: Number(r.volgorde) || 0,
    actief: r.actief !== false, standaard: r.standaard === true,
  }
}

/**
 * Wat een sjabloon op een account zet. Zaakvoerder zonder modules = alle zichtbare
 * modules (een werknemer heeft altijd een expliciete lijst).
 */
export function sjabloonToepassen(s: RolSjabloon, zichtbaar: string[]): { rol: StaffRol; permissions: string[]; bedrijven: Bedrijf[]; rol_sjabloon: string } {
  const permissions = s.modules.length ? s.modules : netteModules(zichtbaar)
  return { rol: s.rol, permissions, bedrijven: s.bedrijven, rol_sjabloon: s.key }
}

// ── Nieuw account in vier stappen ────────────────────────────────────────────

export const STAPPEN = ['Gegevens', 'Rol', 'Start en einde', 'Uitnodigen'] as const

export type NieuwAccount = {
  voornaam: string; achternaam: string; email: string; functie: string | null
  sjabloon: string | null; rol: StaffRol; permissions: string[]; bedrijven: Bedrijf[]
  start_datum: string | null; eind_datum: string | null; uitnodigen: boolean
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Fout per stap (0–3), of null als die stap in orde is. Het scherm gaat pas verder als de stap klopt. */
export function foutInStap(stap: number, a: Partial<NieuwAccount>): string | null {
  if (stap === 0) {
    if (!String(a.voornaam ?? '').trim()) return 'Voornaam is verplicht.'
    if (!EMAIL.test(String(a.email ?? '').trim())) return 'Vul een geldig e-mailadres in.'
  }
  if (stap === 1 && !(a.permissions ?? []).length) return 'Kies een sjabloon of minstens één module.'
  if (stap === 2) {
    if (a.start_datum && !DATUM.test(a.start_datum)) return 'Kies een geldige startdatum.'
    if (a.eind_datum && !DATUM.test(a.eind_datum)) return 'Kies een geldige einddatum.'
    if (a.start_datum && a.eind_datum && a.eind_datum < a.start_datum) return 'De einddatum ligt na de startdatum.'
  }
  return null
}

// ── Onboarding ───────────────────────────────────────────────────────────────

export type OnboardingStap = { id: string; titel: string; volgorde: number; gedaan_op: string | null; gedaan_door: string | null }

export function voortgang(stappen: Pick<OnboardingStap, 'gedaan_op'>[]): { gedaan: number; totaal: number; pct: number; klaar: boolean } {
  const totaal = stappen.length, gedaan = stappen.filter((s) => !!s.gedaan_op).length
  return { gedaan, totaal, pct: totaal ? Math.round((gedaan / totaal) * 100) : 0, klaar: totaal > 0 && gedaan === totaal }
}

/** Nieuwe stappen bij een bestaande lijst: wat er al staat (zelfde titel) komt niet dubbel. */
export function stappenErbij(bestaand: Pick<OnboardingStap, 'titel'>[], nieuw: string[]): string[] {
  const al = new Set(bestaand.map((s) => s.titel.trim().toLowerCase()))
  return netteStappen(nieuw).filter((t) => !al.has(t.toLowerCase()))
}

// ── Functieprofiel ───────────────────────────────────────────────────────────

export type Functieprofiel = { doel: string; taken: string[]; verantwoordelijkheden: string[]; rapporteert_aan: string; competenties: string[] }

/**
 * Functieprofielen van de nieuwe werking (28 nov 2026, uit de afspraken van de
 * vennoten). Per persoon voor Personeel, en per sjabloon: een nieuw account met
 * dat sjabloon krijgt het profiel in zijn dossier als daar nog niets staat.
 */
export const PROFIEL_VENNOTEN: Record<'marco' | 'bram' | 'chiara', Functieprofiel> = {
  marco: {
    doel: 'COO: de interne werking en de groei van NextGenSolutions.',
    taken: ['Mensen, processen, tools en structuur', 'Sales en groei van NextGenSolutions', 'Supportcalls van Care opnemen', 'Auditdagen ter plaatse'],
    verantwoordelijkheden: ['Domein Solutions', 'Domein Interne werking', 'Aanspreekpunt van Jonathan'],
    rapporteert_aan: 'Geen hiërarchie: beslist binnen het eigen domein',
    competenties: [],
  },
  bram: {
    doel: 'CFO: financiën, legal en de groei van NextGenMedia.',
    taken: ['Financiën, legal en contracten', "KPI's opvolgen", 'Investeren en besparen', 'Sales en groei van NextGenMedia'],
    verantwoordelijkheden: ['Domein Financiën & legal'],
    rapporteert_aan: 'Geen hiërarchie: beslist binnen het eigen domein',
    competenties: [],
  },
  chiara: {
    doel: 'Operationeel manager Media.',
    taken: ['Planning en timing', 'Strategie achter de content', 'Contentmanagement', 'Ad-hocwerk en meetings'],
    verantwoordelijkheden: ['Planning Media'],
    rapporteert_aan: 'Geen hiërarchie: beslist binnen het eigen domein',
    competenties: [],
  },
}
export const PROFIEL_VAN_SJABLOON: Record<string, Functieprofiel> = {
  uitvoerder_media: {
    doel: 'Uitvoerend Media.',
    taken: ['Posts', 'Videomontage', 'Visuals, folders en branding', 'Contentmanagement samen met Chiara', 'Later ook foto en video bij klanten'],
    verantwoordelijkheden: ['Uitvoering in Planning Media'],
    rapporteert_aan: 'Chiara (planning)',
    competenties: [],
  },
  uitvoerder_solutions: {
    doel: 'Uitvoerend Solutions.',
    taken: ['Workflows bouwen', 'Auditrapport schrijven', 'Opleveringsvideo maken', 'Nazorg'],
    verantwoordelijkheden: ['Bouw, video en nazorg per workflow'],
    rapporteert_aan: 'Marco',
    competenties: [],
  },
}
export const LEEG_PROFIEL: Functieprofiel = { doel: '', taken: [], verantwoordelijkheden: [], rapporteert_aan: '', competenties: [] }

const regels = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? '').split('\n')).map((s) => String(s ?? '').trim().slice(0, 300)).filter(Boolean).slice(0, 30)

export function controleerProfiel(b: unknown): Functieprofiel {
  const r = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
  return {
    doel: String(r.doel ?? '').trim().slice(0, 1000), taken: regels(r.taken), verantwoordelijkheden: regels(r.verantwoordelijkheden),
    rapporteert_aan: String(r.rapporteert_aan ?? '').trim().slice(0, 120), competenties: regels(r.competenties),
  }
}

export const profielLeeg = (p: Functieprofiel | null | undefined) =>
  !p || (!p.doel && !p.taken.length && !p.verantwoordelijkheden.length && !p.rapporteert_aan && !p.competenties.length)

// ── Studenten: 650 uur per kalenderjaar ──────────────────────────────────────

export const STUDENT_UREN = 650
export const STUDENT_WAARSCHUWING = 0.8

export type StudentStand = { uren: number; grens: number; over: number; pct: number; niveau: 'ok' | 'let_op' | 'over' }

/** Gewerkte uren tegenover 650 uur: let op vanaf 80%, over vanaf 100%. */
export function studentStand(minuten: number, grens = STUDENT_UREN): StudentStand {
  const uren = Math.round((minuten / 60) * 10) / 10
  const pct = Math.round((uren / grens) * 100)
  const niveau = uren >= grens ? 'over' : uren >= grens * STUDENT_WAARSCHUWING ? 'let_op' : 'ok'
  return { uren, grens, over: Math.max(0, Math.round((grens - uren) * 10) / 10), pct, niveau }
}

/** Telt een sessie mee voor dit kalenderjaar (Brusselse datum van de start)? */
export const inJaar = (startIso: string, jaar: number) => {
  const d = new Date(startIso)
  if (Number.isNaN(d.getTime())) return false
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric' }).format(d)) === jaar
}

// ── Offboarding ──────────────────────────────────────────────────────────────

export type OffboardingStand = {
  login: boolean
  openTaken: number
  openOnboarding: number
  icalLinks: number
  lopendeSessie: boolean
  eindDatum: string | null
}

/** Wat er bij offboarding nog openstaat, in gewone taal. Niets hiervan wordt verwijderd. */
export function offboardingPunten(s: OffboardingStand): { tekst: string; open: boolean }[] {
  return [
    { tekst: s.login ? 'Kan nog inloggen' : 'Inloggen is geblokkeerd', open: s.login },
    { tekst: s.openTaken ? `${s.openTaken} open ${s.openTaken === 1 ? 'taak' : 'taken'} in de agenda (blijven staan, geef ze door)` : 'Geen open taken in de agenda', open: s.openTaken > 0 },
    { tekst: s.icalLinks ? `${s.icalLinks} agenda-abonnement${s.icalLinks === 1 ? '' : 'en'} actief` : 'Geen agenda-abonnement', open: s.icalLinks > 0 },
    { tekst: s.lopendeSessie ? 'Nog ingeklokt' : 'Niet ingeklokt', open: s.lopendeSessie },
    { tekst: s.eindDatum ? `Einddatum ${s.eindDatum}` : 'Nog geen einddatum', open: !s.eindDatum },
  ]
}

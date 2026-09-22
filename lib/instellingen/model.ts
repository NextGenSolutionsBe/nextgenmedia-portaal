// Het model van de centrale instellingen — EDGE-VEILIG (geen server-only
// imports): gebruikt in de middleware, de zijbalk, de instellingenpagina en
// de API. Eén plek voor sleutels, standaardwaarden en de rekenregels voor
// zichtbaarheid en rechten.
//
// Veilige standaard: als instellingen niet geladen kunnen worden, gelden de
// standaardwaarden hieronder — en die zijn exact het gedrag van vóór deze
// pagina bestond. Een technische fout kan dus nooit alle tabbladen verbergen
// of rechten intrekken.

import { ADMIN_MODULES } from '@/lib/staff'
import { DISABLED_MODULE_KEYS } from '@/lib/features'

// ── Rollen ───────────────────────────────────────────────────────────────────

/** Rollen van interne accounts. Hoofdbeheerder = user_roles 'admin' (bestaand). */
export type Rol = 'hoofdbeheerder' | 'beheerder' | 'medewerker' | 'alleen_lezen'
export const ROLLEN: { key: Rol; label: string; uitleg: string }[] = [
  { key: 'hoofdbeheerder', label: 'Hoofdbeheerder', uitleg: 'De zaakvoerders (admin-accounts): altijd alle modules en alle rechten.' },
  { key: 'beheerder', label: 'Beheerder', uitleg: 'Werknemer met beheerrechten: mag instellingen en medewerkers beheren binnen zijn modules.' },
  { key: 'medewerker', label: 'Medewerker', uitleg: 'Werkt in de modules die aan hem zijn toegekend.' },
  { key: 'alleen_lezen', label: 'Alleen lezen', uitleg: 'Mag bekijken en exporteren, maar niets toevoegen, aanpassen of verwijderen.' },
]
/** Rollen die voor een werknemer (staff_members.rol) gekozen kunnen worden. */
export const STAFF_ROLLEN: Rol[] = ['beheerder', 'medewerker', 'alleen_lezen']

// ── Acties (rechten per module) ──────────────────────────────────────────────

export type Actie = 'bekijken' | 'toevoegen' | 'aanpassen' | 'verwijderen' | 'exporteren' | 'goedkeuren' | 'instellingen'
export const ACTIES: { key: Actie; label: string }[] = [
  { key: 'bekijken', label: 'Mag bekijken' },
  { key: 'toevoegen', label: 'Mag toevoegen' },
  { key: 'aanpassen', label: 'Mag aanpassen' },
  { key: 'verwijderen', label: 'Mag verwijderen of archiveren' },
  { key: 'exporteren', label: 'Mag exporteren' },
  { key: 'goedkeuren', label: 'Mag bevestigen of goedkeuren' },
  { key: 'instellingen', label: 'Mag instellingen beheren' },
]

// ── Modules (tabbladen) ──────────────────────────────────────────────────────

export type ModuleInfo = {
  key: string
  label: string
  /** Sectie in de navigatie. */
  sectie: string
  /** Hoofdpad van het tabblad. */
  href: string
  /** Essentieel: extra bevestiging vóór verbergen. */
  essentieel?: boolean
  /** Kan nooit verborgen worden (de enige weg terug). */
  vergrendeld?: boolean
  /** Uitgeschakeld in code (lib/features.ts): staat verborgen en kan hier niet aan. */
  uitgeschakeld?: boolean
  /** Enkel voor hoofdbeheerders, ongeacht instellingen. */
  adminOnly?: boolean
}

/**
 * Alle beheersbare tabbladen: de modules uit lib/staff.ts (zoals de middleware
 * ze kent) plus de vaste onderdelen die geen modulesleutel hadden. De labels
 * en secties volgen de zijbalk.
 */
const SECTIE_VAN: Record<string, string> = {
  clients: 'Klanten & content', contracts: 'Klanten & content', content: 'Klanten & content', metricool: 'Klanten & content', blogs: 'Klanten & content', uploads: 'Klanten & content', opdrachten: 'Klanten & content', formulieren: 'Klanten & content',
  kantoor: 'Kantoor', partners: 'Partners', assignments: 'Partners', settlements: 'Partners',
  sales: 'Verkoop', harrie_api: 'Verkoop',
  finance: 'Financieel', invoices: 'Financieel', vesting: 'Financieel', purchases: 'Financieel',
  email: 'Overig', info: 'Overig',
}
const HREF_VAN: Record<string, string> = {
  clients: '/admin/clients', contracts: '/admin/contracts', content: '/admin/services', metricool: '/admin/metricool', blogs: '/admin/blog-calendar', uploads: '/admin/uploads', opdrachten: '/admin/opdrachten', formulieren: '/admin/formulieren',
  kantoor: '/admin/kantoor', partners: '/admin/partners', assignments: '/admin/assignments', settlements: '/admin/settlements',
  sales: '/admin/sales/appointments', harrie_api: '/admin/sales/koppeling',
  finance: '/admin/revenue/omzet', invoices: '/admin/invoices', vesting: '/admin/vesting', purchases: '/admin/purchases',
  email: '/admin/email', info: '/admin/informatief',
}
const ESSENTIEEL = new Set(['invoices', 'contracts', 'purchases', 'werknemers', 'instellingen'])

export const MODULE_INSTELLINGEN_KEY = 'instellingen'
export const MODULE_WERKNEMERS_KEY = 'werknemers'
export const MODULE_DASHBOARD_KEY = 'dashboard'

export const MODULES: ModuleInfo[] = [
  { key: MODULE_DASHBOARD_KEY, label: 'Command Center', sectie: 'Start', href: '/admin', vergrendeld: true },
  ...ADMIN_MODULES.filter((m) => m.key !== 'harrie_api').map((m) => ({
    key: m.key, label: m.label, sectie: SECTIE_VAN[m.key] ?? 'Overig', href: HREF_VAN[m.key] ?? m.prefixes[0],
    essentieel: ESSENTIEEL.has(m.key), uitgeschakeld: DISABLED_MODULE_KEYS.includes(m.key),
  })),
  { key: MODULE_WERKNEMERS_KEY, label: 'Werknemers', sectie: 'Beheer', href: '/admin/werknemers', essentieel: true, adminOnly: true },
  { key: MODULE_INSTELLINGEN_KEY, label: 'Instellingen', sectie: 'Beheer', href: '/admin/instellingen', essentieel: true, vergrendeld: true },
]
export const moduleInfo = (key: string): ModuleInfo | undefined => MODULES.find((m) => m.key === key)

// ── Instellingen: sleutels, types, standaardwaarden ──────────────────────────

export type ModuleInstelling = { zichtbaar: boolean; rollen: Rol[]; volgorde?: number }
export type ModulesInstellingen = Record<string, ModuleInstelling>

export type RechtenInstellingen = Record<Rol, Record<string, Actie[]>>

export type Organisatie = {
  vennootschapsnaam: string; handelsnaam: string; ondernemingsnummer: string; btw_nummer: string
  maatschappelijke_zetel: string; facturatieadres: string; email: string; telefoon: string; website: string
  iban: string; bic: string; betalingstermijn_dagen: number; valuta: string; tijdzone: string; datumnotatie: string
}
export type FacturatieInstellingen = {
  standaard_btw_pct: number; betalingstermijn_dagen: number; standaard_omschrijving: string
  factuurnummer_prefix: string; factuurnummer_volgend: number; creditnota_prefix: string; creditnota_volgend: number
  betaalgegevens: string; standaard_status: 'te_versturen' | 'verstuurd'
  clickup_sync_aan: boolean
  /** Overschrijft de env CLICKUP_INVOICING_LIST_ID; enkel na validatie via de ClickUp-API. */
  clickup_lijst_id: string; clickup_lijst_pad: string; clickup_assignee_id: string; clickup_assignee_naam: string
  /** Wie de facturen opmaakt en verstuurt (planner, voorstellen). */
  verantwoordelijke_naam: string
}
export type DocumentenInstellingen = {
  logo_path: string; primaire_kleur: string; secundaire_kleur: string; voettekst: string; contactregel: string; bestandsnaam_patroon: string
}

export const STANDAARD_ORGANISATIE: Organisatie = {
  vennootschapsnaam: 'NextGenMedia', handelsnaam: 'NextGenMedia', ondernemingsnummer: '', btw_nummer: '',
  maatschappelijke_zetel: '', facturatieadres: '', email: 'info@nextgenmedia.be', telefoon: '', website: 'https://nextgenmedia.be',
  iban: '', bic: '', betalingstermijn_dagen: 30, valuta: 'EUR', tijdzone: 'Europe/Brussels', datumnotatie: 'dd/mm/jjjj',
}
export const STANDAARD_FACTURATIE: FacturatieInstellingen = {
  standaard_btw_pct: 21, betalingstermijn_dagen: 30, standaard_omschrijving: '',
  factuurnummer_prefix: 'F-', factuurnummer_volgend: 1, creditnota_prefix: 'CN-', creditnota_volgend: 1,
  betaalgegevens: '', standaard_status: 'te_versturen',
  clickup_sync_aan: false, clickup_lijst_id: '', clickup_lijst_pad: '', clickup_assignee_id: '', clickup_assignee_naam: '',
  verantwoordelijke_naam: 'Bram Reinquin',
}
export const STANDAARD_DOCUMENTEN: DocumentenInstellingen = {
  logo_path: '', primaire_kleur: '#fff848', secundaire_kleur: '#111111',
  voettekst: 'Dit document werd automatisch gegenereerd door het NextGenMedia-portaal.', contactregel: '',
  bestandsnaam_patroon: '{type}_{nummer}_{datum}',
}

/** Standaard: alles zichtbaar (behalve wat in code uit staat), voor alle rollen. */
export function standaardModules(): ModulesInstellingen {
  const uit: ModulesInstellingen = {}
  MODULES.forEach((m, i) => {
    uit[m.key] = {
      zichtbaar: !m.uitgeschakeld,
      rollen: m.adminOnly ? ['hoofdbeheerder'] : m.key === MODULE_INSTELLINGEN_KEY ? ['hoofdbeheerder', 'beheerder'] : ['hoofdbeheerder', 'beheerder', 'medewerker', 'alleen_lezen'],
      volgorde: i,
    }
  })
  return uit
}

/** Standaardrechten per rol — exact het gedrag van vóór de instellingenpagina. */
export function standaardRechten(): RechtenInstellingen {
  const alles: Actie[] = ['bekijken', 'toevoegen', 'aanpassen', 'verwijderen', 'exporteren', 'goedkeuren', 'instellingen']
  const werk: Actie[] = ['bekijken', 'toevoegen', 'aanpassen', 'verwijderen', 'exporteren']
  const lezen: Actie[] = ['bekijken', 'exporteren']
  const per = (acties: Actie[]) => Object.fromEntries(MODULES.map((m) => [m.key, acties])) as Record<string, Actie[]>
  const beheerder = per(alles)
  const medewerker = per(werk)
  const alleenLezen = per(lezen)
  // Beheer-onderdelen: werknemers blijft admin-only; instellingen mag een beheerder.
  medewerker[MODULE_WERKNEMERS_KEY] = []; medewerker[MODULE_INSTELLINGEN_KEY] = []
  alleenLezen[MODULE_WERKNEMERS_KEY] = []; alleenLezen[MODULE_INSTELLINGEN_KEY] = []
  beheerder[MODULE_WERKNEMERS_KEY] = ['bekijken']
  return { hoofdbeheerder: per(alles), beheerder, medewerker, alleen_lezen: alleenLezen }
}

export type AlleInstellingen = {
  organisatie: Organisatie
  modules: ModulesInstellingen
  rechten: RechtenInstellingen
  facturatie: FacturatieInstellingen
  documenten: DocumentenInstellingen
}
export const INSTELLINGEN_SLEUTELS = ['organisatie', 'modules', 'rechten', 'facturatie', 'documenten'] as const
export type InstellingenSleutel = (typeof INSTELLINGEN_SLEUTELS)[number]

export function standaardInstellingen(): AlleInstellingen {
  return { organisatie: { ...STANDAARD_ORGANISATIE }, modules: standaardModules(), rechten: standaardRechten(), facturatie: { ...STANDAARD_FACTURATIE }, documenten: { ...STANDAARD_DOCUMENTEN } }
}

/** Opgeslagen waarden over de standaard heen leggen; onbekende/stukke waarden vallen terug. */
export function samenvoegen(ruw: Partial<Record<InstellingenSleutel, unknown>> | null | undefined): AlleInstellingen {
  const std = standaardInstellingen()
  if (!ruw) return std
  const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
  const org = obj(ruw.organisatie); if (org) std.organisatie = { ...std.organisatie, ...(org as Partial<Organisatie>) }
  const fac = obj(ruw.facturatie); if (fac) std.facturatie = { ...std.facturatie, ...(fac as Partial<FacturatieInstellingen>) }
  const doc = obj(ruw.documenten); if (doc) std.documenten = { ...std.documenten, ...(doc as Partial<DocumentenInstellingen>) }
  const mods = obj(ruw.modules)
  if (mods) for (const k of Object.keys(std.modules)) {
    const m = obj(mods[k]); if (!m) continue
    const info = moduleInfo(k)
    // Vergrendelde of in code uitgeschakelde modules volgen nooit de opgeslagen waarde.
    const zichtbaar = info?.vergrendeld ? true : info?.uitgeschakeld ? false : (typeof m.zichtbaar === 'boolean' ? m.zichtbaar : std.modules[k].zichtbaar)
    // Het Command Center is voor iedereen: rollen zijn er niet in te perken.
    const rollen = k === MODULE_DASHBOARD_KEY ? std.modules[k].rollen : Array.isArray(m.rollen) ? (m.rollen.filter((r): r is Rol => ROLLEN.some((x) => x.key === r))) : std.modules[k].rollen
    std.modules[k] = { zichtbaar, rollen: rollen.includes('hoofdbeheerder') ? rollen : ['hoofdbeheerder', ...rollen], volgorde: typeof m.volgorde === 'number' ? m.volgorde : std.modules[k].volgorde }
  }
  const rechten = obj(ruw.rechten)
  if (rechten) for (const rol of ROLLEN.map((r) => r.key)) {
    if (rol === 'hoofdbeheerder') continue   // altijd alles
    const perModule = obj(rechten[rol]); if (!perModule) continue
    for (const k of Object.keys(std.rechten[rol])) {
      const a = perModule[k]
      if (Array.isArray(a)) std.rechten[rol][k] = a.filter((x): x is Actie => ACTIES.some((y) => y.key === x))
    }
  }
  return std
}

// ── Rekenregels: wie ziet en mag wat? ────────────────────────────────────────

export type Persoon = {
  rol: Rol
  /** Toegestane modulesleutels van een werknemer; null = hoofdbeheerder (alles). */
  modules: string[] | null
}

/** De HTTP-methode vertaald naar de actie die ervoor nodig is. */
export function actieVoorMethode(method: string, path: string): Actie {
  if (path.startsWith('/api/admin/export')) return 'exporteren'
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'bekijken'
  if (m === 'POST') return 'toevoegen'
  if (m === 'DELETE') return 'verwijderen'
  return 'aanpassen'
}

/**
 * Is een module voor deze persoon beschikbaar (globaal zichtbaar én toegestaan
 * voor de rol én — voor werknemers — in zijn modulelijst)? Verborgen wint van
 * alles; hoofdbeheerders zien alles wat zichtbaar is.
 */
export function moduleBeschikbaar(inst: AlleInstellingen, persoon: Persoon, moduleKey: string | null): boolean {
  if (!moduleKey) return true
  const m = inst.modules[moduleKey]
  const info = moduleInfo(moduleKey)
  if (!m) return persoon.rol === 'hoofdbeheerder' || (persoon.modules?.includes(moduleKey) ?? false)
  if (!m.zichtbaar && moduleKey !== MODULE_INSTELLINGEN_KEY) return false
  if (persoon.rol === 'hoofdbeheerder' || moduleKey === MODULE_DASHBOARD_KEY) return true
  if (info?.adminOnly) return false
  if (!m.rollen.includes(persoon.rol)) return false
  if (moduleKey === MODULE_INSTELLINGEN_KEY) return inst.rechten[persoon.rol]?.[MODULE_INSTELLINGEN_KEY]?.includes('instellingen') ?? false
  if (moduleKey === MODULE_DASHBOARD_KEY) return true
  return persoon.modules === null || persoon.modules.includes(moduleKey)
}

/** Mag deze persoon deze actie in deze module? Hoofdbeheerder altijd. */
export function magActie(inst: AlleInstellingen, persoon: Persoon, moduleKey: string, actie: Actie): boolean {
  if (persoon.rol === 'hoofdbeheerder') return true
  if (!moduleBeschikbaar(inst, persoon, moduleKey)) return false
  return inst.rechten[persoon.rol]?.[moduleKey]?.includes(actie) ?? false
}

/** De rol van een werknemersrij (staff_members.rol), veilig. */
export function rolVanStaff(rol: unknown): Rol {
  return rol === 'beheerder' || rol === 'alleen_lezen' ? rol : 'medewerker'
}

export const ROL_LABEL = Object.fromEntries(ROLLEN.map((r) => [r.key, r.label])) as Record<Rol, string>

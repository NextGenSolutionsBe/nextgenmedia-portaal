// Generiek rechtenmodel voor klant-subaccounts. Herbruikbaar door het hele
// platform (contracten, social media, website, blogs, taken, bestanden).
// Pure module — geen server-only imports, veilig in client- én servercomponenten.

import { FEATURES } from '@/lib/features'

export const PORTAL_MODULES = ['social_media', 'metricool', 'cms', 'website', 'contracts', 'blogs', 'tasks', 'files', 'meetings', 'diensten', 'consultancy', 'founders', 'nieuws', 'partners', 'events', 'opleveringen', 'offertes'] as const
export type PortalModule = (typeof PORTAL_MODULES)[number]

// Acties per module (de "actie-rechten").
export const MODULE_ACTIONS: Record<PortalModule, string[]> = {
  social_media: ['view', 'edit', 'feedback', 'approve_scripts'],
  metricool:    ['view'],
  cms:          ['view', 'edit', 'publish'],
  website:      ['view', 'request_maintenance'],
  contracts:    ['view', 'sign', 'download'],
  blogs:        ['view', 'edit'],
  tasks:        ['view', 'complete'],
  files:        ['view', 'upload'],
  meetings:     ['view', 'book'],
  diensten:     ['view', 'aanvragen'],
  consultancy:  ['view', 'aanvragen'],
  founders:     ['view', 'aanvragen'],
  nieuws:       ['view'],
  partners:     ['view'],
  events:       ['view', 'inschrijven'],
  opleveringen: ['view', 'download', 'feedback'],
  offertes:     ['view', 'download'],
}

export const MODULE_LABELS: Record<PortalModule, string> = {
  social_media: 'Social Media',
  metricool:    'Metricool',
  cms:          'Website-CMS',
  website:      'Website',
  contracts:    'Contracten',
  blogs:        'Blogs',
  tasks:        'Taken',
  files:        'Bestanden aanleveren',
  meetings:     'Meeting boeken',
  diensten:     'Diensten aanvragen',
  consultancy:  'Consultancy aanvragen',
  founders:     'Founders of Flanders',
  nieuws:       'Nieuws',
  partners:     'Onze partners',
  events:       'Workshops & events',
  opleveringen: 'Opleveringen (video\'s, ontwerpen, foto\'s en documenten bekijken, downloaden en feedback)',
  offertes:     'Offertes (bekijken, downloaden en aanvaarden)',
}

// Welke modules hebben een werkende pagina/route. Een module die hier op false
// staat wordt nergens getoond en geeft 404 in de guard — niet misleidend tonen
// alsof het al werkt. 'metricool'/'cms' tonen enkel als de klant óók gekoppeld
// is (gating in layout/nav).
export const MODULE_IMPLEMENTED: Record<PortalModule, boolean> = {
  social_media: true,
  metricool:    true,
  cms:          true,
  website:      true,
  contracts:    true,
  blogs:        FEATURES.blogs,   // tijdelijk uit — zie lib/features.ts
  tasks:        true,
  files:        true,             // /portal/bestanden — aanleveren van beeldmateriaal
  meetings:     true,             // /portal/meetings — gratis meeting boeken + Mijn meetings
  diensten:     true,             // /portal/diensten — dienst aanvragen (geen boeking) + Mijn aanvragen
  consultancy:  true,             // /portal/consultancy — consultancy aanvragen + Mijn aanvragen
  founders:     true,             // /portal/founders — voorbeeldvideo's + founder video aanvragen (via Aanvragen)
  nieuws:       false,  // verborgen op vraag (2 nov 2026): de app is een werkomgeving, geen marketingkanaal; code en gegevens blijven (/portal/nieuws)
  partners:     true,             // /portal/partners — onze bedrijven met uitleg en socials
  events:       false,  // verborgen op vraag (2 nov 2026): de app is een werkomgeving, geen marketingkanaal; code en gegevens blijven (/portal/events)
  opleveringen: true,             // /portal/opleveringen — video's, ontwerpen, foto's en documenten bekijken, downloaden, feedback en revisierondes (3 dagen beschikbaar)
  offertes:     true,             // /portal/offertes — verstuurde offertes bekijken, downloaden en (via de offertepagina) aanvaarden
}

/**
 * Modules die standaard AAN staan voor elk account met toegang tot de klantapp,
 * ook voor subaccounts waarvan de rechten van vóór de module dateren. Zo'n
 * module staat pas uit als iemand ze uitdrukkelijk uitvinkt (opgeslagen als
 * false). Meeting boeken en diensten of consultancy aanvragen horen bij elke klant.
 */
export const STANDAARD_AAN: readonly PortalModule[] = ['meetings', 'diensten', 'consultancy', 'founders', 'nieuws', 'partners', 'events', 'opleveringen', 'offertes']

export const ACTION_LABELS: Record<string, string> = {
  view: 'Bekijken',
  feedback: 'Feedback geven',
  approve_scripts: 'Scripts goedkeuren',
  request_maintenance: 'Onderhoud aanvragen',
  sign: 'Ondertekenen',
  download: 'Downloaden',
  edit: 'Bewerken',
  publish: 'Publiceren',
  complete: 'Voltooien',
  upload: 'Uploaden',
  book: 'Boeken, verplaatsen en annuleren',
  aanvragen: 'Aanvragen indienen en offertes beslissen',
  inschrijven: 'Inschrijven en uitschrijven',
}

export type Permissions = Partial<Record<PortalModule, Record<string, boolean>>>

/** Volledige rechten (alle modules, alle acties = true). */
export function fullPermissions(): Permissions {
  const out: Permissions = {}
  for (const m of PORTAL_MODULES) {
    out[m] = Object.fromEntries(MODULE_ACTIONS[m].map((a) => [a, true]))
  }
  return out
}

/** Alleen-lezen (enkel 'view' overal). */
function viewOnly(): Permissions {
  const out: Permissions = {}
  for (const m of PORTAL_MODULES) out[m] = { view: true }
  return out
}

function only(modules: PortalModule[]): Permissions {
  const out: Permissions = {}
  for (const m of modules) out[m] = Object.fromEntries(MODULE_ACTIONS[m].map((a) => [a, true]))
  return out
}

export type PresetKey = 'eigenaar' | 'marketing' | 'website' | 'financieel' | 'readonly'

export const PRESETS: { key: PresetKey; label: string; description: string; permissions: () => Permissions }[] = [
  { key: 'eigenaar',   label: 'Eigenaar',          description: 'Alle rechten',                       permissions: fullPermissions },
  // Marketing levert in de praktijk óók het beeldmateriaal aan; zonder 'files'
  // zou zo iemand foto's alleen per mail kwijt kunnen.
  { key: 'marketing',  label: 'Marketing',         description: 'Social Media + Metricool + Blogs + Taken + Bestanden', permissions: () => only(['social_media', 'metricool', 'blogs', 'tasks', 'files']) },
  { key: 'website',    label: 'Websitebeheerder',  description: 'Website-CMS + Website + Taken',        permissions: () => only(['cms', 'website', 'tasks']) },
  { key: 'financieel', label: 'Financieel',        description: 'Contracten en offertes bekijken + downloaden', permissions: () => ({ contracts: { view: true, sign: false, download: true }, offertes: { view: true, download: true } }) },
  { key: 'readonly',   label: 'Alleen lezen',      description: 'Alles bekijken, niets aanpassen',     permissions: viewOnly },
]

export function presetPermissions(key: PresetKey): Permissions {
  return (PRESETS.find((p) => p.key === key) ?? PRESETS[0]).permissions()
}

/**
 * Rechten zoals ze gelden: een standaard-aan-module die nergens vermeld staat,
 * krijgt alle acties. Staat ze er (ook met false), dan geldt wat er staat.
 */
export function metStandaard(permissions: Permissions | null | undefined): Permissions {
  const out: Permissions = { ...(permissions ?? {}) }
  for (const m of STANDAARD_AAN) {
    if (!out[m]) out[m] = Object.fromEntries(MODULE_ACTIONS[m].map((a) => [a, true]))
  }
  return out
}

/** Heeft deze permissions-set een bepaald recht? Lege/onbekende module → false. */
export function can(permissions: Permissions | null | undefined, module: PortalModule, action = 'view'): boolean {
  if (!permissions) return false
  return permissions[module]?.[action] === true
}

/** Saneert binnenkomende permissions tot enkel geldige modules/acties + booleans. */
export function sanitizePermissions(input: unknown): Permissions {
  const out: Permissions = {}
  if (!input || typeof input !== 'object') return out
  const obj = input as Record<string, unknown>
  for (const m of PORTAL_MODULES) {
    const mod = obj[m]
    if (mod && typeof mod === 'object') {
      const actions: Record<string, boolean> = {}
      for (const a of MODULE_ACTIONS[m]) {
        const v = (mod as Record<string, unknown>)[a]
        if (v === true) actions[a] = true
        // Bij een standaard-aan-module is "uit" een bewuste keuze: bewaren.
        else if (v === false && STANDAARD_AAN.includes(m)) actions[a] = false
      }
      if (Object.keys(actions).length > 0) out[m] = actions
    }
  }
  return out
}

/** Korte samenvatting van toegekende (en gebouwde) modules, bv. "Social Media, Contracten". */
export function permissionSummary(permissions: Permissions | null | undefined): string {
  if (!permissions) return '—'
  const live = PORTAL_MODULES.filter((m) => MODULE_IMPLEMENTED[m])
  const mods = live.filter((m) => can(metStandaard(permissions), m, 'view'))
  if (mods.length === 0) return 'Geen toegang'
  if (mods.length === live.length) return 'Alle modules'
  return mods.map((m) => MODULE_LABELS[m]).join(', ')
}

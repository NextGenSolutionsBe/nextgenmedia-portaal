// Interne werknemers (rol 'employee') + per-module zichtbaarheid binnen de admin.
// Edge-veilig (geen server-only imports): gebruikt in middleware, sidebar én UI.
//
// Admin = ziet alles. Werknemer = enkel modules in staff_members.permissions.
// 'werknemers' (staff-beheer) is ALTIJD admin-only en nooit een togglebare module.

import { DISABLED_MODULE_KEYS } from '@/lib/features'

export type AdminModule = {
  key: string
  label: string
  prefixes: string[]   // /admin-paden die bij deze module horen
}

// Prefixen bevatten zowel pagina-paden (/admin/…) als API-paden (/api/admin/…):
// de middleware gebruikt pathToModule om werknemers óók op API-niveau per module
// af te schermen (pagina verbergen zonder API-gate is schijnveiligheid).
export const ADMIN_MODULES: AdminModule[] = [
  { key: 'clients',     label: 'Klanten',              prefixes: ['/admin/clients', '/api/admin/clients', '/api/admin/tasks'] },
  { key: 'contracts',   label: 'Contracten',           prefixes: ['/admin/contracts', '/api/admin/contracts', '/api/admin/contract-templates'] },
  { key: 'content',     label: 'Content / Diensten',   prefixes: ['/admin/services', '/api/admin/social-content', '/api/admin/shoot-feedback', '/api/admin/shoot-ideas', '/api/admin/webdesign'] },
  { key: 'metricool',   label: 'Metricool',            prefixes: ['/admin/metricool', '/api/admin/metricool'] },
  { key: 'blogs',       label: 'Blogs',                prefixes: ['/admin/blog-calendar', '/admin/blogaccounts', '/admin/blogs', '/api/admin/blogs', '/api/admin/blog-accounts', '/api/admin/blog-seo', '/api/admin/blog-settings', '/api/admin/framer'] },
  { key: 'partners',    label: 'Partners',             prefixes: ['/admin/partners', '/api/admin/partners'] },
  { key: 'assignments', label: 'Opdrachten',           prefixes: ['/admin/assignments', '/api/admin/assignments'] },
  { key: 'settlements', label: 'Settlements',          prefixes: ['/admin/settlements'] },
  { key: 'finance',     label: 'Financiën'          , prefixes: ['/admin/revenue', '/api/admin/revenue', '/api/admin/costs', '/api/admin/fiscal-settings'] },
  { key: 'sales',       label: 'Verkoop',              prefixes: ['/admin/sales', '/api/admin/sales'] },
  { key: 'aanbestedingen', label: 'Aanbestedingen',    prefixes: ['/admin/aanbestedingen', '/api/admin/aanbestedingen'] },
  { key: 'invoices',    label: 'Facturen',             prefixes: ['/admin/invoices', '/api/admin/invoices'] },
  { key: 'vesting',     label: 'Vesting',              prefixes: ['/admin/vesting', '/api/admin/vesting'] },
  { key: 'purchases',   label: 'Aankopen',             prefixes: ['/admin/purchases', '/api/admin/purchases'] },
  { key: 'uploads',     label: 'Klantuploads',         prefixes: ['/admin/uploads', '/api/admin/uploads'] },
  { key: 'opdrachten',  label: 'Opdrachten (klanten)', prefixes: ['/admin/opdrachten', '/api/admin/opdrachten'] },
  { key: 'email',       label: 'E-mailcenter',         prefixes: ['/admin/email', '/api/admin/email'] },
  { key: 'info',        label: 'Informatief',          prefixes: ['/admin/informatief', '/admin/onboarding', '/admin/maandplanning', '/api/admin/month-planning', '/api/admin/month-planning-clients'] },
]

/** Modules die ZICHTBAAR/toewijsbaar zijn in de UI. ADMIN_MODULES blijft bewust
 *  compleet (pathToModule moet alle paden blijven mappen); uitgeschakelde features
 *  worden hier eruit gefilterd én in de middleware hard geblokkeerd. */
export const VISIBLE_ADMIN_MODULES: AdminModule[] = ADMIN_MODULES.filter((m) => !DISABLED_MODULE_KEYS.includes(m.key))

/** API-paden die élke actieve werknemer mag gebruiken (module-neutrale pickers).
 *  Bevat enkel niet-gevoelige lijstdata (bv. klantnamen voor dropdowns). */
export const STAFF_API_WHITELIST = [
  '/api/admin/clients-list',
  // Shell-brede endpoints: globale zoek + notificaties. Deze routes filteren ZELF
  // per module (lib/actor-modules.ts), dus een werknemer ziet enkel eigen data.
  '/api/admin/search',
  '/api/admin/notifications',
]

/** Gevoelige API-paden die ALTIJD admin-only blijven, ook al valt het pad binnen
 *  een module-prefix (wachtwoorden, portaaltoegang, subaccounts, koppel-beheer,
 *  diagnose). Substring-match op het pad. Klant-DELETE blijft daarnaast op
 *  route-niveau admin-only. */
export const STAFF_API_DENY_SUBSTRINGS = [
  '/credentials',
  '/grant-access',
  '/users',
  '/api/admin/metricool/link',
  '/api/admin/metricool/diag',
  '/api/admin/email/diag',
  '/api/admin/email/report-now',
]

export function isStaffApiDenied(path: string): boolean {
  return STAFF_API_DENY_SUBSTRINGS.some((s) => path.includes(s))
}

// Endpoints die in MEERDERE dashboards opduiken. Principe: toegang tot een
// dashboard = alle acties in dat dashboard werken — ook als het onderliggende
// endpoint "van" een andere module lijkt. Een werknemer mag zo'n endpoint dus
// gebruiken als hij ÉÉN van de vermelde modules heeft. Eerste match wint.
const SHARED_API: Array<{ test: (p: string) => boolean; modules: string[] }> = [
  // Klant-subresources die in het content-dashboard (social-media) én de klant-hub
  // opduiken. Strikt op /api/admin/clients/<id>/(clickup-sync|shoot-briefings) —
  // opdracht-sync (/api/admin/assignments/.../clickup-sync) valt hier bewust buiten.
  { test: (p) => /^\/api\/admin\/clients\/[^/]+\/(clickup-sync|shoot-briefings|framer)(\/|\?|$)/.test(p), modules: ['content', 'clients'] },
  // Mail-composer: content (scripts/shoot), klanten (hub), contracten, blogs, partners.
  {
    test: (p) => p.startsWith('/api/admin/email/send') || p.startsWith('/api/admin/email/context') || p.startsWith('/api/admin/email/templates'),
    modules: ['email', 'content', 'clients', 'contracts', 'blogs', 'partners'],
  },
]

/**
 * Module(s) die toegang geven tot een admin-API-pad. Meestal één; gedeelde
 * endpoints geven een lijst (werknemer passeert met één ervan). null = niet
 * gemapt (default-deny voor werknemers).
 */
export function modulesForApiPath(path: string): string[] | null {
  for (const s of SHARED_API) if (s.test(path)) return s.modules
  const single = pathToModule(path)
  return single ? [single] : null
}

/** Module-key voor een /admin-pad (langste prefix wint), of null = niet gegate. */
export function pathToModule(path: string): string | null {
  let best: { key: string; len: number } | null = null
  for (const m of ADMIN_MODULES) {
    for (const p of m.prefixes) {
      if (path === p || path.startsWith(p + '/') || path.startsWith(p + '?')) {
        if (!best || p.length > best.len) best = { key: m.key, len: p.length }
      }
    }
  }
  return best?.key ?? null
}

export function sanitizeModules(input: unknown): string[] {
  const valid = new Set(ADMIN_MODULES.map((m) => m.key))
  return Array.isArray(input) ? input.filter((k): k is string => typeof k === 'string' && valid.has(k)) : []
}

export function canSeeModule(perms: string[] | null | undefined, key: string | null): boolean {
  if (!key) return true       // ongegate pad (bv. /admin command center)
  return !!perms && perms.includes(key)
}

export type StaffPreset = { key: string; label: string; modules: string[] }
export const STAFF_PRESETS: StaffPreset[] = [
  { key: 'content', label: 'Content/Social', modules: ['clients', 'content', 'metricool', 'blogs', 'info'] },
  { key: 'sales', label: 'Sales/Klanten', modules: ['clients', 'contracts', 'invoices', 'info'] },
  { key: 'operations', label: 'Operations', modules: ['clients', 'content', 'blogs', 'assignments', 'partners', 'info'] },
  { key: 'no_finance', label: 'Alles behalve financieel', modules: ['clients', 'contracts', 'content', 'blogs', 'partners', 'assignments', 'email', 'info'] },
  { key: 'readonly', label: 'Beperkt (klanten + content)', modules: ['clients', 'content'] },
  // Appointment setter: werkt uitsluitend in de Verkoop-module (pipeline +
  // agenda) en ziet verder niets van het platform.
  { key: 'setter', label: 'Appointment setter (enkel Verkoop)', modules: ['sales'] },
  // Volgt overheidsopdrachten op met een eigen zoekfilter.
  { key: 'aanbestedingen', label: 'Aanbestedingen (enkel overheidsopdrachten)', modules: ['aanbestedingen'] },
]

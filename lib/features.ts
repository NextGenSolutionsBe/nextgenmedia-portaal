// Centrale feature-flags — Edge-veilig (geen server-only imports): gebruikt in
// middleware, sidebar én UI.
//
// Doel: een module tijdelijk UIT zetten zonder code te verwijderen. Alle pagina's,
// routes en logica blijven bestaan; enkel zichtbaarheid + toegang worden gestuurd.
// Terugzetten = de betreffende vlag op `true` zetten, meer niet.

export const FEATURES = {
  /** Partners, Opdrachten, Settlements + het volledige partnerportaal. */
  partners: false,
  /** Blogs: admin (projecten/kalender) én het klantportaal. */
  blogs: false,
} as const

/** Module-keys (lib/staff.ts) die verborgen zijn zolang de vlag uit staat. */
export const DISABLED_MODULE_KEYS: string[] = [
  ...(FEATURES.partners ? [] : ['partners', 'assignments', 'settlements']),
  ...(FEATURES.blogs ? [] : ['blogs']),
]

/** Pad-prefixen die volledig geblokkeerd worden (pagina's én API's), voor
 *  IEDEREEN inclusief admin — zodat een uitgezette module ook niet via een
 *  directe URL bereikbaar is. */
export const DISABLED_PATH_PREFIXES: string[] = [
  ...(FEATURES.partners ? [] : [
    '/admin/partners', '/api/admin/partners',
    '/admin/assignments', '/api/admin/assignments',
    '/admin/settlements', '/api/admin/settlements',
    '/partner', '/api/partner',
  ]),
  ...(FEATURES.blogs ? [] : [
    '/admin/blogs', '/admin/blogaccounts', '/admin/blog-calendar',
    '/api/admin/blogs', '/api/admin/blog-accounts', '/api/admin/blog-seo', '/api/admin/blog-settings',
    '/portal/blogs', '/api/portal/blogs',
    '/api/cron/blog-generate',
  ]),
]

/** Valt dit pad onder een uitgeschakelde feature? */
export function isDisabledPath(path: string): boolean {
  return DISABLED_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))
}

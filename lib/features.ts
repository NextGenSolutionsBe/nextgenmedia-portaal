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
  /**
   * De REST-koppeling met Harrie (/api/harrie/* plus het sleutelscherm).
   *
   * UIT, want Harrie praat nu RECHTSTREEKS met Supabase: hij leest de view
   * `harrie_pipeline` en schrijft één rij in `harrie_events`, waarna een trigger
   * de faseregels toepast. Dat is één schakel minder tussen hem en de data.
   *
   * De code blijft staan. Wil je ooit terug naar een eigen API met een eigen
   * token — bijvoorbeeld omdat een derde partij niet in Supabase mag — dan zet
   * je deze vlag op `true` en werkt alles weer.
   */
  harrieApi: false,
} as const

/** Module-keys (lib/staff.ts) die verborgen zijn zolang de vlag uit staat. */
export const DISABLED_MODULE_KEYS: string[] = [
  ...(FEATURES.partners ? [] : ['partners', 'assignments', 'settlements']),
  ...(FEATURES.blogs ? [] : ['blogs']),
  ...(FEATURES.harrieApi ? [] : ['harrie_api']),
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
  ...(FEATURES.harrieApi ? [] : [
    '/api/harrie',
    '/admin/sales/koppeling', '/api/admin/sales/harrie',
  ]),
]

/** Valt dit pad onder een uitgeschakelde feature? */
export function isDisabledPath(path: string): boolean {
  return DISABLED_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))
}

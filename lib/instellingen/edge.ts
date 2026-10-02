// Instellingen lezen in de MIDDLEWARE (edge-runtime): geen React cache, geen
// server-only imports. Een korte in-geheugen cache per edge-instantie houdt
// het aantal databaselezingen laag; bij een fout of tijdsoverschrijding
// gelden de standaardwaarden — nooit "alles dicht" door een storing.

import { samenvoegen, standaardInstellingen, type AlleInstellingen, type InstellingenSleutel } from './model'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

const CACHE_MS = 5_000
let cache: { tot: number; waarde: AlleInstellingen } | null = null

/** Cache leegmaken (na een wijziging vanuit dezelfde instantie). */
export function vergeetInstellingenCache(): void { cache = null }

export async function leesInstellingenEdge(db: Db, tijdslimietMs = 2500): Promise<AlleInstellingen> {
  if (cache && cache.tot > Date.now()) return cache.waarde
  let klok: ReturnType<typeof setTimeout> | undefined
  try {
    const lezing = Promise.resolve(db.from('app_settings').select('key, value')).then((r: { data: { key: string; value: unknown }[] | null; error: unknown }) => r)
    const uitkomst = await Promise.race([
      lezing,
      new Promise<null>((los) => { klok = setTimeout(() => los(null), tijdslimietMs) }),
    ])
    if (!uitkomst || uitkomst.error) return cache?.waarde ?? standaardInstellingen()
    const ruw: Partial<Record<InstellingenSleutel, unknown>> = {}
    for (const r of uitkomst.data ?? []) (ruw as Record<string, unknown>)[r.key] = r.value
    const waarde = samenvoegen(ruw)
    cache = { tot: Date.now() + CACHE_MS, waarde }
    return waarde
  } catch {
    return cache?.waarde ?? standaardInstellingen()
  } finally {
    if (klok) clearTimeout(klok)
  }
}

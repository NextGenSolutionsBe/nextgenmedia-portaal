// Kleur per type in de contentkalender: bewaren, lezen, en werken vóór de migratie.
// Uitvoeren: npx tsx tests/kalender-stijl-server.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import Module from 'module'

const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown }
const origineel = M._load
M._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req === 'server-only') return {}
  return origineel.call(this, req, parent, isMain)
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { stijlActie, leesKalenderStijl, StijlFout } = require('../lib/content/kalender-stijl-server') as typeof import('../lib/content/kalender-stijl-server')

/** Nepdatabank met content_labels en content_kalender_stijl; `zonderTypeKolom` = vóór de migratie. */
function nepAdmin(opties: { zonderTypeKolom?: boolean } = {}) {
  const stijl: Record<string, any> = {}
  const labels: any[] = [{ id: 'l1', client_id: 'k1', naam: 'Nieuwbouw', kleur: '#22c55e' }]
  const geenKolom = { message: 'column content_kalender_stijl.type_kleuren does not exist' }
  return {
    stijl,
    from(tabel: string) {
      const filters: Record<string, unknown> = {}
      let kolommen = ''
      const q: any = {
        select(k: string) { kolommen = k; return q },
        eq(k: string, v: unknown) { filters[k] = v; return q },
        order() { return Promise.resolve({ data: labels.filter((l) => l.client_id === filters.client_id), error: null }) },
        async maybeSingle() {
          if (opties.zonderTypeKolom && kolommen.includes('type_kleuren')) return { data: null, error: geenKolom }
          const rij = stijl[String(filters.client_id)]
          if (!rij) return { data: null, error: null }
          const uit: Record<string, unknown> = {}
          for (const k of kolommen.split(',').map((x) => x.trim())) uit[k] = rij[k]
          return { data: uit, error: null }
        },
        async upsert(rij: any) {
          if (opties.zonderTypeKolom && 'type_kleuren' in rij) return { error: geenKolom }
          stijl[rij.client_id] = { fase_kleuren: {}, type_kleuren: {}, ...stijl[rij.client_id], ...rij }
          return { error: null }
        },
      }
      void tabel
      return q
    },
  }
}

async function main() {
  let ok = 0

  // Typekleuren bewaren: onbekende types en ongeldige kleuren vallen weg, fasekleuren blijven.
  {
    const a = nepAdmin()
    await stijlActie(a, 'k1', { actie: 'kleuren', kleuren: { approved: '#14b8a6' } }, 'Bram')
    const { stijl } = await stijlActie(a, 'k1', { actie: 'type_kleuren', kleuren: { reel: '#A855F7', post: 'rood', video: '#000000' } }, 'Bram')
    assert.deepEqual(stijl!.typeKleuren, { reel: '#a855f7' })
    assert.deepEqual(stijl!.faseKleuren, { approved: '#14b8a6' })
    assert.equal(stijl!.labels.length, 1)
    // Fasekleur aanpassen raakt de typekleuren niet.
    const na = await stijlActie(a, 'k1', { actie: 'kleuren', kleuren: { draft: '#6b7280' } }, 'Bram')
    assert.deepEqual(na.stijl!.typeKleuren, { reel: '#a855f7' })
    ok++
  }

  // Vóór de migratie: de kalender leest gewoon (zonder typekleuren), bewaren geeft een duidelijke melding.
  {
    const a = nepAdmin({ zonderTypeKolom: true })
    a.stijl.k1 = { fase_kleuren: { scheduled: '#3b82f6' } }
    const s = await leesKalenderStijl(a, 'k1')
    assert.deepEqual(s.faseKleuren, { scheduled: '#3b82f6' })
    assert.deepEqual(s.typeKleuren, {})
    await assert.rejects(stijlActie(a, 'k1', { actie: 'type_kleuren', kleuren: { reel: '#a855f7' } }, null), (e: unknown) => e instanceof StijlFout && (e as InstanceType<typeof StijlFout>).status === 503)
    ok++
  }

  console.log(`kalender-stijl-server: ${ok} tests geslaagd`)
}
main().catch((e) => { console.error(e); process.exit(1) })

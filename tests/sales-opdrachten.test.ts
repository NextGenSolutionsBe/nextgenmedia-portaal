// Tests voor opdrachten op leads (pure logica) + de opruiming van de oude Opdrachten-module.
// Uitvoeren: npx tsx tests/sales-opdrachten.test.ts
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseBedragCents, somOpdrachten, leadWaardeCents, kolomSamenvatting, pipelineTotalen,
  opdrachtSamenvatting, opdrachtRegel, leesOpdrachtInvoer, OUDE_STATUS_NAAR_FASE,
} from '../lib/sales/opdrachten-model'
import { STAGE_KEYS } from '../lib/sales/stages'
import { ADMIN_MODULES, sanitizeModules, pathToModule } from '../lib/staff'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ok ${naam}`) }
const root = join(__dirname, '..')

console.log('Sales — opdrachten op leads')

test('1. Bedrag lezen: Belgische notatie, decimalen, euroteken; onzin en negatief → null', () => {
  assert.equal(parseBedragCents('3.250'), 325000)
  assert.equal(parseBedragCents('3250'), 325000)
  assert.equal(parseBedragCents('3.250,50'), 325050)
  assert.equal(parseBedragCents('3250,5'), 325050)
  assert.equal(parseBedragCents('12.5'), 1250)
  assert.equal(parseBedragCents('1.234.567'), 123456700)
  assert.equal(parseBedragCents('€ 1 250'), 125000)
  assert.equal(parseBedragCents('0'), 0)
  assert.equal(parseBedragCents(99.99), 9999)
  assert.equal(parseBedragCents('-5'), null)
  assert.equal(parseBedragCents('abc'), null)
  assert.equal(parseBedragCents('1,2,3'), null)
  assert.equal(parseBedragCents(''), null)
})

test('2. Waarde van een lead: som van de opdrachten, anders de dealwaarde', () => {
  assert.equal(somOpdrachten([{ bedrag_cents: 100 }, { bedrag_cents: 250 }, { bedrag_cents: -5 }, { bedrag_cents: null }]), 350)
  assert.equal(leadWaardeCents({ opdrachten: [{ bedrag_cents: 300000 }, { bedrag_cents: 25000 }], deal_waarde_cents: 999 }), 325000)
  assert.equal(leadWaardeCents({ opdrachten: [], deal_waarde_cents: 495000 }), 495000)
  assert.equal(leadWaardeCents({ deal_waarde_cents: null }), 0)
  assert.equal(leadWaardeCents({ opdrachten: [{ bedrag_cents: 0 }], deal_waarde_cents: 5000 }), 0, 'opdrachten gaan voor, ook met 0')
})

test('3. Per kolom en bovenaan: open pijplijn zonder gewonnen/verloren', () => {
  const leads = [
    { stage_key: 'outbound', waarde_cents: 100000 },
    { stage_key: 'voorstel', waarde_cents: 250000 },
    { stage_key: 'voorstel', waarde_cents: 0 },
    { stage_key: 'gewonnen', waarde_cents: 400000 },
    { stage_key: 'verloren', waarde_cents: 50000 },
  ]
  assert.deepEqual(kolomSamenvatting(leads.filter((l) => l.stage_key === 'voorstel')), { aantal: 2, waardeCents: 250000 })
  assert.deepEqual(kolomSamenvatting([]), { aantal: 0, waardeCents: 0 })
  assert.deepEqual(pipelineTotalen(leads), { openCents: 350000, gewonnenCents: 400000, verlorenCents: 50000, openAantal: 3 })
})

test('4. Kaarttekst, tijdlijnregel en invoercontrole', () => {
  assert.equal(opdrachtSamenvatting([]), null)
  assert.equal(opdrachtSamenvatting([{ titel: 'Website' }]), 'Website')
  assert.equal(opdrachtSamenvatting([{ titel: 'Website' }, { titel: 'SEO' }, { titel: 'Logo' }]), 'Website +2')
  assert.match(opdrachtRegel('toegevoegd', 'Website', 325000), /^Opdracht toegevoegd: Website — €\s?3\.250$/)
  const ok = leesOpdrachtInvoer({ titel: ' Website ', bedrag: '3.250' }, true)
  assert.ok(ok.ok && ok.invoer.titel === 'Website' && ok.invoer.bedrag_cents === 325000)
  const zonderBedrag = leesOpdrachtInvoer({ titel: 'Shoot' }, true)
  assert.ok(zonderBedrag.ok && zonderBedrag.invoer.bedrag_cents === 0)
  assert.equal(leesOpdrachtInvoer({ bedrag: '100' }, true).ok, false, 'titel verplicht')
  assert.equal(leesOpdrachtInvoer({ titel: 'x', bedrag: 'veel' }, true).ok, false)
  assert.equal(leesOpdrachtInvoer({ titel: 'x', bedrag: '99999999' }, true).ok, false, 'boven de grens')
  const deel = leesOpdrachtInvoer({ bedrag: '500' }, false)
  assert.ok(deel.ok && deel.invoer.titel === undefined && deel.invoer.bedrag_cents === 50000)
})

test('5. Migratie-mapping: elke oude status naar een bestaande kolom, en gelijk aan de SQL', () => {
  const oude = ['open', 'voorstel_gevraagd', 'voorstel_bezig', 'voorstel_klaar', 'voorstel_voorgelegd', 'interesse', 'geen_interesse',
    'contract_verstuurd', 'getekend', 'bezig', 'wacht', 'opgeleverd', 'te_factureren', 'factuur_verstuurd', 'betaald', 'afgerond', 'geannuleerd']
  for (const s of oude) {
    assert.ok(OUDE_STATUS_NAAR_FASE[s], `status ${s} heeft een fase`)
    assert.ok((STAGE_KEYS as string[]).includes(OUDE_STATUS_NAAR_FASE[s]), `${s} → bestaande kolom`)
  }
  const sql = readFileSync(join(root, 'supabase/migrations/99999999_SYNC_ALL.sql'), 'utf8')
  const blok = sql.slice(sql.indexOf('-- ── Pipeline-opdrachten + beltijd (22 sep 2026)'))
  assert.ok(blok.length > 100, 'migratieblok staat in SYNC_ALL')
  for (const [status, fase] of Object.entries(OUDE_STATUS_NAAR_FASE)) {
    const m = new RegExp(`WHEN '${status}'[^\\n]*THEN '(\\w+)'`).exec(blok)
      ?? new RegExp(`'${status}'[^\\n]*\\)\\s*THEN '(\\w+)'`).exec(blok)
    assert.ok(m, `SQL mapt ${status}`)
    assert.equal(m![1], fase, `SQL ${status} → ${fase}`)
  }
})

test('6. Oude Opdrachten-module is weg; opgeslagen rechten met "opdrachten" breken niets', () => {
  for (const f of ['lib/opdrachten.ts', 'app/api/admin/opdrachten/route.ts', 'app/admin/opdrachten/opdrachten-client.tsx', 'app/api/admin/badges/route.ts']) {
    assert.ok(!existsSync(join(root, f)), `${f} hoort weg te zijn`)
  }
  assert.match(readFileSync(join(root, 'app/admin/opdrachten/page.tsx'), 'utf8'), /redirect\('\/admin\/sales\/pipeline'\)/)
  assert.ok(!ADMIN_MODULES.some((m) => m.key === 'opdrachten'))
  assert.deepEqual(sanitizeModules(['sales', 'opdrachten', 'clients']), ['sales', 'clients'])
  assert.equal(pathToModule('/admin/sales/pipeline'), 'sales')
  assert.equal(pathToModule('/api/admin/sales/beltijd'), 'sales')
  assert.equal(pathToModule('/api/admin/sales/leads/x/opdrachten'), 'sales')
  // Partneropdrachten (assignments) blijven ongemoeid.
  assert.ok(ADMIN_MODULES.some((m) => m.key === 'assignments'))
})

console.log(`\n${n} tests geslaagd.`)

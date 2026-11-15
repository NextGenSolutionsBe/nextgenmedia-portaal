// Slim invullen uit het contract (gekozen facturen nakijken en toevoegen) en het
// bestelbonnummer uit een bijgevoegde bestelbon.
// Uitvoeren: npx tsx tests/slim-invullen.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import Module from 'module'

const gelogd: string[] = []
const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown }
const origineel = M._load
M._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req === 'server-only') return {}
  if (req === 'next/cache') return { revalidatePath: () => {} }
  if (req === '@/lib/audit') return { logAudit: async (a: { action: string }) => { gelogd.push(a.action) } }
  if (req === '@/lib/contract-audit') return { logContractEvent: async (_a: unknown, _id: string, e: string) => { gelogd.push(e) } }
  return origineel.call(this, req, parent, isMain)
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { leesGekozenFacturen, voegFacturenToe } = require('../lib/facturatie/contract-plan-server') as typeof import('../lib/facturatie/contract-plan-server')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { leesAntwoord, bruikbaarNummer } = require('../lib/contracten/bestelbon-ai') as typeof import('../lib/contracten/bestelbon-ai')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { maakPlan } = require('../lib/facturatie/contract-plan') as typeof import('../lib/facturatie/contract-plan')

let n = 0
const test = async (naam: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log(`  ✓ ${naam}`) }

/** Nepdatabank met een unieke voorstel_sleutel, zoals in de echte tabel. */
function nepAdmin(t: Record<string, any[]>) {
  return {
    storage: {},
    from(tabel: string) {
      let rijen = [...(t[tabel] ??= [])]
      let patch: any = null
      const q: any = {
        select: () => q, eq: (k: string, w: any) => { rijen = rijen.filter((r) => r[k] === w); return q },
        in: (k: string, w: any[]) => { rijen = rijen.filter((r) => w.includes(r[k])); return q },
        is: (k: string, w: any) => { rijen = rijen.filter((r) => (r[k] ?? null) === w); return q },
        maybeSingle: async () => ({ data: rijen[0] ?? null, error: null }),
        single: async () => ({ data: rijen[0] ?? null, error: null }),
        insert: (rij: any) => {
          if (tabel === 'invoices' && t.invoices.some((x) => x.voorstel_sleutel === rij.voorstel_sleutel)) {
            return { select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) }
          }
          const nieuw = { id: `${tabel}-${t[tabel].length + 1}`, ...rij }
          t[tabel].push(nieuw); rijen = [nieuw]
          return { select: () => ({ single: async () => ({ data: nieuw, error: null }) }), then: (ok: any) => Promise.resolve({ error: null }).then(ok) }
        },
        update: (p: any) => { patch = p; return q },
        then: (ok: any, nok: any) => {
          if (patch) for (const r of rijen) Object.assign(r, patch)
          return Promise.resolve({ data: rijen, error: null }).then(ok, nok)
        },
      }
      return q
    },
  } as any
}

const factuur = (o: Partial<Record<string, unknown>> = {}) => ({ sleutel: '2026-12', periode: '2026-12', van: '2026-12-01', tot: '2026-12-31', datum: '2026-12-01', titel: 'Sociale media management (december 2026)', omschrijving: 'Beheer van de sociale media.', bedrag: 979, btw: 21, eenheid: 'maand', post: 0, ...o })

async function main() {
  console.log('\nSlim invullen en bestelbon\n')

  await test('Gekozen facturen: titel, datum, bedrag en btw worden nagekeken', () => {
    assert.equal(leesGekozenFacturen([]).fout, 'Kies minstens één factuur.')
    assert.match(leesGekozenFacturen([factuur({ titel: ' ' })]).fout ?? '', /titel/)
    assert.match(leesGekozenFacturen([factuur({ datum: '1/12/2026' })]).fout ?? '', /datum/)
    assert.match(leesGekozenFacturen([factuur({ bedrag: 0 })]).fout ?? '', /bedrag/)
    assert.match(leesGekozenFacturen([factuur({ sleutel: 'x y' })]).fout ?? '', /Onbekende/)
    const ok = leesGekozenFacturen([factuur({ bedrag: '979.456', titel: '  Sociale   media ' })])
    assert.equal(ok.fout, null)
    assert.equal(ok.facturen[0].bedrag, 979.46)
    assert.equal(ok.facturen[0].titel, 'Sociale media')
  })

  await test('Toevoegen: te factureren met bestelbon van het contract, twee keer = geen dubbels', async () => {
    const t: Record<string, any[]> = { contracts: [{ id: 'c1', title: 'SMM 2026', client_id: 'k1', bestelbon_nummer: 'PO-77', service_slug: 'social-media' }], invoices: [], invoice_lines: [], invoice_wijzigingen: [] }
    const admin = nepAdmin(t)
    const r1 = await voegFacturenToe(admin, 'c1', [factuur(), factuur({ sleutel: '2027-01', datum: '2027-01-01', titel: 'Sociale media management (januari 2027)' })])
    assert.deepEqual(r1, { toegevoegd: 2, overgeslagen: 0 })
    assert.equal(t.invoices[0].status, 'te_versturen')
    assert.equal(t.invoices[0].klant_referentie, 'PO-77')
    assert.equal(t.invoices[0].voorstel_sleutel, 'c1:2026-12')
    assert.equal(t.invoices[0].amount_incl, 1184.59)
    assert.equal(t.invoice_lines[0].omschrijving, 'Beheer van de sociale media.')
    const r2 = await voegFacturenToe(admin, 'c1', [factuur()])
    assert.deepEqual(r2, { toegevoegd: 0, overgeslagen: 1 })
    assert.ok(gelogd.includes('facturen_gepland'))
  })

  await test('Zonder klant op het contract: duidelijke fout', async () => {
    const admin = nepAdmin({ contracts: [{ id: 'c2', title: 'Los', client_id: null }], invoices: [] })
    await assert.rejects(voegFacturenToe(admin, 'c2', [factuur()]), /Koppel eerst een klant/)
  })

  await test('Omschrijving uit het contract met de periode erin', () => {
    const p = maakPlan({ contractTitel: 'Contract', getekendOp: null, btwPct: 21, moment: 'eerste', posten: [{ naam: 'Hosting', soort: 'terugkerend', frequentie: 'kwartaal', bedrag: 60, perioden: 2, start: '2027-01-01', inbegrepen: ['Hosting en SSL'], omschrijving: 'Hosting van de website met SSL en dagelijkse back-ups.' }] })
    assert.equal(p.facturen[0].titel, 'Hosting Q1 2027')
    assert.equal(p.facturen[0].omschrijving, 'Hosting van de website met SSL en dagelijkse back-ups voor de periode Q1 2027.')
    assert.equal(p.facturen[1].omschrijving, 'Hosting van de website met SSL en dagelijkse back-ups voor de periode Q2 2027.')
  })

  await test('Bestelbonnummer: enkel overnemen bij een bestelbon met genoeg zekerheid', () => {
    assert.equal(bruikbaarNummer(leesAntwoord('```json\n{"is_bestelbon": true, "nummer": " PO  2026-0815 ", "zekerheid": 0.92}\n```')), 'PO 2026-0815')
    assert.equal(bruikbaarNummer(leesAntwoord('{"is_bestelbon": true, "nummer": "4500123", "zekerheid": 0.4}')), null, 'twijfel')
    assert.equal(bruikbaarNummer(leesAntwoord('{"is_bestelbon": false, "nummer": "F-2026-12", "zekerheid": 0.9}')), null, 'een factuur')
    assert.equal(bruikbaarNummer(leesAntwoord('geen json')), null)
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })

// Bestelbonnummer uit een bijgevoegde bestelbon: op het contract en op de te versturen facturen, nooit over een bestaand nummer.
// Uitvoeren: npx tsx tests/bestelbon-bijlage.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import Module from 'module'

let lezing: any = { nummer: 'PO-2026-0815', isBestelbon: true, zekerheid: 0.95 }
const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown }
const origineel = M._load
M._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req === 'server-only') return {}
  if (req === 'next/cache') return { revalidatePath: () => {} }
  if (req === '@/lib/audit') return { logAudit: async () => {} }
  if (req === '@/lib/contract-audit') return { logContractEvent: async () => {} }
  if (req === '@/lib/contracten/bestelbon-ai') {
    return {
      kanBestelbonLezen: (m: string) => m === 'application/pdf' || m === 'image/png',
      leesBestelbonnummer: async () => lezing,
      bruikbaarNummer: (l: any) => (l.isBestelbon && l.nummer && l.zekerheid >= 0.6 ? l.nummer : null),
    }
  }
  return origineel.call(this, req, parent, isMain)
}
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bestelbonUitBijlage } = require('../lib/contracten/bestelbon-server') as typeof import('../lib/contracten/bestelbon-server')

function nepAdmin(t: Record<string, any[]>) {
  return {
    storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([37, 80, 68, 70])]), error: null }) }) },
    from(tabel: string) {
      let rijen = [...(t[tabel] ?? [])]
      let patch: any = null
      const q: any = {
        select: () => q, eq: (k: string, w: any) => { rijen = rijen.filter((r) => r[k] === w); return q },
        in: (k: string, w: any[]) => { rijen = rijen.filter((r) => w.includes(r[k])); return q },
        is: (k: string, w: any) => { rijen = rijen.filter((r) => (r[k] ?? null) === w); return q },
        maybeSingle: async () => ({ data: rijen[0] ?? null, error: null }),
        update: (p: any) => { patch = p; return q },
        then: (ok: any, nok: any) => { if (patch) for (const r of rijen) Object.assign(r, patch); return Promise.resolve({ data: rijen, error: null }).then(ok, nok) },
      }
      return q
    },
  } as any
}
const bijlage = { id: 'b1', pad: 'bijlagen/c1/x.pdf', naam: 'bestelbon.pdf', mime: 'application/pdf' }

async function main() {
  let n = 0
  console.log('\nBestelbon uit de bijlage\n')

  const t: Record<string, any[]> = {
    contracts: [{ id: 'c1', title: 'Website', bestelbon_nummer: null }],
    invoices: [
      { id: 'f1', contract_id: 'c1', status: 'te_versturen', klant_referentie: null },
      { id: 'f2', contract_id: 'c1', status: 'te_versturen', klant_referentie: 'EIGEN-1' },
      { id: 'f3', contract_id: 'c1', status: 'verstuurd', klant_referentie: null },
    ],
  }
  assert.equal(await bestelbonUitBijlage(nepAdmin(t), 'c1', bijlage), 'PO-2026-0815')
  assert.equal(t.contracts[0].bestelbon_nummer, 'PO-2026-0815')
  assert.deepEqual(t.invoices.map((f) => f.klant_referentie), ['PO-2026-0815', 'EIGEN-1', null], 'enkel te versturen facturen zonder nummer')
  n++; console.log('  ✓ Nummer op het contract en op de te versturen facturen zonder nummer')

  lezing = { nummer: 'ANDER', isBestelbon: true, zekerheid: 0.99 }
  assert.equal(await bestelbonUitBijlage(nepAdmin(t), 'c1', bijlage), null)
  assert.equal(t.contracts[0].bestelbon_nummer, 'PO-2026-0815')
  n++; console.log('  ✓ Een nummer dat er al staat, blijft staan')

  const t2: Record<string, any[]> = { contracts: [{ id: 'c2', title: 'X', bestelbon_nummer: null }], invoices: [] }
  lezing = { nummer: 'F-2026-12', isBestelbon: false, zekerheid: 0.9 }
  assert.equal(await bestelbonUitBijlage(nepAdmin(t2), 'c2', { ...bijlage, mime: 'application/pdf' }), null)
  assert.equal(await bestelbonUitBijlage(nepAdmin(t2), 'c2', { ...bijlage, mime: 'application/zip' }), null)
  assert.equal(t2.contracts[0].bestelbon_nummer, null)
  n++; console.log('  ✓ Geen bestelbon of geen pdf/foto: niets')

  console.log(`\n${n} tests geslaagd\n`)
}
main().catch((e) => { console.error(e); process.exit(1) })

// Nog te tekenen als taak (regels, vesting, uitgaven, tegentekenen) en de verantwoordelijke van een contract.
// Uitvoeren: npx tsx tests/te-tekenen.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import Module from 'module'

// Server-only modules vervangen door nep-versies (enkel wat teTekenenOverzicht gebruikt).
const nep = {
  regels: { versie: { id: 'r1', versie: 1, regels: ['Regel'], created_at: null, created_by: null }, handtekeningen: [] as any[] },
  vennoten: { regels: null as any, handtekeningen: [] as any[], uitgaven: [] as any[], akkoorden: [] as any[] },
  vesting: { akkoordContract: new Map<string, any>(), akkoordRegistratie: new Map<string, any>() },
}
const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown }
const origineel = M._load
M._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req === 'server-only') return {}
  if (req === '@/lib/vesting-regels-server') return { laadVestingRegels: async () => ({ ...nep.regels, namen: {}, ik: null }) }
  if (req === '@/lib/vesting-data-server') return { laadVestingData: async () => nep.vesting }
  if (req === '@/lib/vennoot-uitgaven-server') return { laadVennotenData: async () => ({ ...nep.vennoten, namen: {}, ik: null }) }
  return origineel.call(this, req, parent, isMain)
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { tegentekenTaken, hoortBij, isVoor } = require('../lib/te-tekenen') as typeof import('../lib/te-tekenen')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { wieTekentTegen } = require('../lib/contracten/verantwoordelijke') as typeof import('../lib/contracten/verantwoordelijke')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { teTekenenOverzicht } = require('../lib/te-tekenen-server') as typeof import('../lib/te-tekenen-server')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { vestingRegelsTekst } = require('../lib/regels-akkoord') as typeof import('../lib/regels-akkoord')

let n = 0
const test = async (naam: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log(`  ✓ ${naam}`) }

// Kleine nepdatabank: enkel select/in/is/order/limit/eq/maybeSingle zoals hier gebruikt.
function nepAdmin(t: Record<string, any[]>) {
  return {
    from(tabel: string) {
      let rijen = [...(t[tabel] ?? [])]
      const q: any = {
        // contract_signatures!inner(id): enkel rijen met een handtekening van de klant (zoals PostgREST).
        select: (k?: string) => { if (k?.includes('contract_signatures!inner')) rijen = rijen.filter((r) => (t.contract_signatures ?? []).some((s) => s.contract_id === r.id)); return q },
        in: (k: string, w: any[]) => { rijen = rijen.filter((r) => w.includes(r[k])); return q },
        is: (k: string, w: any) => { rijen = rijen.filter((r) => (r[k] ?? null) === w); return q },
        eq: (k: string, w: any) => { rijen = rijen.filter((r) => r[k] === w); return q },
        order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: rijen[0] ?? null, error: null }),
        then: (ok: any, nok: any) => Promise.resolve({ data: rijen, error: null }).then(ok, nok),
      }
      return q
    },
  } as any
}

const VENNOTEN = { key: 'vesting_vennoten', value: { marco: { naam: 'Marco Castermans', user_ids: ['m'] }, bram: { naam: 'Bram Reinquin', user_ids: ['b'] }, chiara: { naam: 'Chiara Walmagh', user_ids: ['c'] } } }

async function main() {
  console.log('\nNog te tekenen\n')

  await test('Wie tekent tegen: de verantwoordelijke; gezamenlijk of niemand = Marco en Bram', () => {
    assert.deepEqual(wieTekentTegen('Marco'), ['Marco'])
    assert.deepEqual(wieTekentTegen('Bram Reinquin'), ['Bram'])
    assert.deepEqual(wieTekentTegen('Gezamenlijke lead'), ['Marco', 'Bram'])
    assert.deepEqual(wieTekentTegen(null), ['Marco', 'Bram'])
    assert.deepEqual(wieTekentTegen('Chiara'), ['Chiara'])
  })

  await test('Tegentekenen: per persoon één taak met de lijst, recentste eerst, link blijft bij die persoon', () => {
    const nu = new Date('2026-11-15T12:00:00Z')
    const taken = tegentekenTaken([
      { id: 'a', titel: 'Website', klant: 'Bakkerij Peeters', signed_at: '2026-11-14T10:00:00Z', verantwoordelijke: 'Bram' },
      { id: 'b', titel: 'SMM', klant: 'Garage Vos', signed_at: '2026-11-01T10:00:00Z', verantwoordelijke: 'Marco' },
      { id: 'c', titel: 'AI', klant: 'Era Nobis', signed_at: '2026-11-15T09:00:00Z', verantwoordelijke: null },
    ], nu)
    assert.deepEqual(taken.map((t) => [t.voor[0], t.lijst!.map((c) => c.id)]), [['Marco', ['c', 'b']], ['Bram', ['c', 'a']]])
    const marco = taken[0]
    assert.equal(marco.wat, '2 contracten tegentekenen')
    assert.equal(marco.href, '/admin/contracts/c/tegentekenen?van=Marco')
    assert.equal(marco.dringend, true, 'Garage Vos tekende al 2 weken geleden')
    assert.match(marco.sub ?? '', /1 nog zonder verantwoordelijke/)
    assert.equal(taken[1].dringend, false)
    assert.match(taken[1].lijst![0].sub ?? '', /nog geen verantwoordelijke/)
    assert.deepEqual(tegentekenTaken([]), [])
  })

  await test('Ronde "?van=": eigen contracten plus gezamenlijk en zonder verantwoordelijke', () => {
    assert.ok(hoortBij('Bram', 'Bram'))
    assert.ok(!hoortBij('Bram', 'Marco'))
    assert.ok(hoortBij('Bram', 'Gezamenlijke lead'))
    assert.ok(hoortBij('Bram', null))
    assert.ok(hoortBij('Chiara', 'Chiara'))
    assert.ok(!hoortBij('Chiara', 'Bram'))
    assert.ok(hoortBij(null, 'Marco'), 'zonder ?van= alles')
  })

  await test('Filter per persoon op voornaam (ClickUp-lid "Bram Reinquin")', () => {
    assert.ok(isVoor({ voor: ['Bram', 'Chiara'] }, 'Bram Reinquin'))
    assert.ok(!isVoor({ voor: ['Marco'] }, 'Bram'))
    assert.ok(!isVoor({ voor: ['Marco'] }, null))
  })

  await test('Overzicht: regels bij wie nog niet tekende, vesting per vennoot, tegentekenen bij de verantwoordelijke', async () => {
    nep.regels.handtekeningen = [{ vennoot: 'bram', naam: 'Bram', getekend_op: '2026-11-15', inhoud_tekst: vestingRegelsTekst(nep.regels.versie), handtekening: '' }]
    const stand = (getekend: string[]) => ({ stand: { per: Object.fromEntries(['marco', 'bram', 'chiara'].map((k) => [k, { stand: getekend.includes(k) ? 'getekend' : 'open' }])) } })
    nep.vesting.akkoordContract = new Map([['v1', stand(['marco'])], ['v2', stand([])]])
    nep.vesting.akkoordRegistratie = new Map([['r1', stand(['marco', 'bram'])]])
    const admin = nepAdmin({
      app_settings: [VENNOTEN],
      contracts: [
        { id: 'k1', title: 'Website', client_id: 'cl1', signed_at: '2026-11-14T10:00:00Z', status: 'signed', tegengetekend_op: null },
        { id: 'k2', title: 'Test', client_id: 'test', signed_at: '2026-11-14T10:00:00Z', status: 'signed', tegengetekend_op: null },
        { id: 'k3', title: 'Al getekend', client_id: 'cl1', signed_at: '2026-11-10T10:00:00Z', status: 'signed', tegengetekend_op: '2026-11-11' },
        // Handmatig op getekend gezet of als getekende pdf opgeladen: geen tegentekenopdracht.
        { id: 'k4', title: 'Op getekend gezet', client_id: 'cl1', signed_at: '2026-11-15T10:00:00Z', status: 'signed', tegengetekend_op: null },
      ],
      contract_signatures: [{ contract_id: 'k1' }, { contract_id: 'k2' }, { contract_id: 'k3' }],
      clients: [{ id: 'cl1', company_name: 'Bakkerij Peeters' }, { id: 'test', company_name: 'test' }],
      opdrachten: [{ contract_id: 'k1', verantwoordelijke: 'Bram' }, { contract_id: 'k4', verantwoordelijke: 'Bram' }],
    })
    const items = await teTekenenOverzicht(admin)
    const per = (id: string) => items.find((i) => i.id === id)
    assert.deepEqual(per('tegentekenen:Bram')?.lijst?.map((c) => c.id), ['k1'], 'testklant, al tegengetekend en niet door de klant in de app getekend niet')
    assert.equal(per('tegentekenen:Marco'), undefined)
    assert.deepEqual(per('regels_vesting:1')?.voor, ['Marco', 'Chiara'])
    assert.equal(per('vesting:marco')?.wat, 'Vesting tekenen: 1 contract')
    assert.equal(per('vesting:bram')?.wat, 'Vesting tekenen: 2 contracten')
    assert.equal(per('vesting:chiara')?.wat, 'Vesting tekenen: 2 contracten en 1 inkomst of kost')
    assert.deepEqual(per('vesting:chiara')?.voor, ['Chiara'])
  })

  await test('Een onderdeel dat faalt, laat de rest staan', async () => {
    const admin = nepAdmin({ app_settings: [VENNOTEN], contracts: [], clients: [], opdrachten: [] })
    const kapot = nep.vesting
    nep.vesting = null as any // laadVestingData geeft dan iets onbruikbaars
    const items = await teTekenenOverzicht(admin)
    nep.vesting = kapot
    assert.ok(items.some((i) => i.soort === 'regels_vesting'))
    assert.ok(!items.some((i) => i.soort === 'vesting'))
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })

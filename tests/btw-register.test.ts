// Btw-nummer opzoeken in het Europese register (VIES): naam en adres netjes uitlezen.
//
//   npx tsx tests/btw-register.test.ts

import assert from 'node:assert/strict'
import { netteNaam, leesVies, zoekInBtwRegister } from '../lib/btw-register'

let n = 0
const test = async (naam: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log(`  ✓ ${naam}`) }

async function main() {
  console.log('\nBtw-register (VIES)\n')

  await test('1. Naam: rechtsvorm achteraan, hoofdletters netjes, eigen schrijfwijze blijft', () => {
    assert.equal(netteNaam('SA DPU PROXIMUS'), 'Proximus SA DPU')
    assert.equal(netteNaam('BV BAKKERIJ PEETERS'), 'Bakkerij Peeters BV')
    assert.equal(netteNaam('NV D\'IETEREN-MOTORS'), 'D\'Ieteren-Motors NV')
    assert.equal(netteNaam('NextGenMedia'), 'NextGenMedia')
    assert.equal(netteNaam('---'), null)
    assert.equal(netteNaam(''), null)
  })

  await test('2. Adres: straat, postcode en gemeente uit het VIES-adres', () => {
    const g = leesVies('BE0202239951', { isValid: true, name: 'SA DPU PROXIMUS', address: 'Boulevard du Roi AlbertII 27\n1030 Schaerbeek' })
    assert.deepEqual(g, { btw: 'BE0202239951', geldig: true, naam: 'Proximus SA DPU', straat: 'Boulevard du Roi AlbertII 27', postcode: '1030', gemeente: 'Schaerbeek', land: 'België' })
    const ongeldig = leesVies('BE0123456749', { isValid: false, name: '---', address: '---' })
    assert.equal(ongeldig.geldig, false)
    assert.equal(ongeldig.naam, null)
  })

  await test('3. Opzoeken: juiste URL, ongeldig nummer meteen geweigerd, register plat = duidelijke melding', async () => {
    let gevraagd = ''
    const ok = (async (u: string) => { gevraagd = String(u); return new Response(JSON.stringify({ isValid: true, userError: 'VALID', name: 'BV TEST', address: 'Kerkstraat 1\n3500 Hasselt' }), { status: 200 }) }) as unknown as typeof fetch
    const g = await zoekInBtwRegister('be 0202.239.951', ok)
    assert.equal(gevraagd, 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/BE/vat/0202239951')
    assert.equal(g.naam, 'Test BV')
    assert.equal(g.gemeente, 'Hasselt')
    await assert.rejects(zoekInBtwRegister('BE0123456789', ok), /BTW/i)
    const plat = (async () => new Response(JSON.stringify({ userError: 'MS_UNAVAILABLE' }), { status: 200 })) as unknown as typeof fetch
    await assert.rejects(zoekInBtwRegister('BE0202239951', plat), /niet bereikbaar/)
    const fout = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch
    await assert.rejects(zoekInBtwRegister('BE0202239951', fout), /antwoordt niet/)
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })

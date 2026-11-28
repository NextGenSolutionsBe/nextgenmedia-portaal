// Btw-nummer opzoeken in het Europese register (VIES): naam en adres netjes uitlezen.
//
//   npx tsx tests/btw-register.test.ts

import assert from 'node:assert/strict'
import { netteNaam, leesVies, zoekInBtwRegister } from '../lib/btw-register'
import { normalizeBtw, validateBtw, btwIsVolledig } from '../lib/btw'

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

  await test('4. Slim lezen: spaties, punten, streepjes, labels en ontbrekende BE', () => {
    for (const x of ['BE1016.637.895', 'BE 1016 637 895', 'be1016-637-895', '1016.637.895', '1016637895', 'BTW BE 1016.637.895', 'Btw-nr.: BE1016637895', 'VAT no BE1016637895', 'Ondernemingsnummer 1016.637.895', 'TVA: BE 1016 637 895', ' BE1016637895 ', 'BE1O16637895', 'BE\u00a01016\u00a0637\u00a0895']) {
      assert.equal(normalizeBtw(x), 'BE1016637895', x)
      assert.equal(validateBtw(x).ok, true, x)
    }
    assert.equal(normalizeBtw('0202.239.951'), 'BE0202239951')
    assert.equal(normalizeBtw('BE 202.239.951'), 'BE0202239951') // oud nummer van 9 cijfers
    assert.equal(normalizeBtw('NL863489011B01'), 'NL863489011B01')
    assert.equal(validateBtw('NL 8634.89011.B01').value, 'NL863489011B01')
  })

  await test('5. Duidelijke fout en geen opzoeking terwijl je nog typt', () => {
    assert.match(validateBtw('BE1016637894').error ?? '', /controlegetal/)
    assert.match(validateBtw('BE10166378').error ?? '', /hier staan er 8/)
    assert.equal(btwIsVolledig('BE101663789'), false) // 9 cijfers: misschien nog bezig
    assert.equal(btwIsVolledig('BE1016.637.89'), false)
    assert.equal(btwIsVolledig('BE1016.637.895'), true)
    assert.equal(btwIsVolledig('BE1016637894'), false)
    assert.equal(btwIsVolledig('NL863489011B01'), true)
  })

  await test('6. Register druk: één keer opnieuw, dan pas een fout', async () => {
    let n = 0
    const eerstDruk = (async () => { n++; return n === 1 ? new Response(JSON.stringify({ userError: 'MS_MAX_CONCURRENT_REQ' }), { status: 200 }) : new Response(JSON.stringify({ isValid: true, userError: 'VALID', name: 'BV TEST', address: 'Kerkstraat 1\n3500 Hasselt' }), { status: 200 }) }) as unknown as typeof fetch
    const g = await zoekInBtwRegister('BE0202239951', eerstDruk)
    assert.equal(n, 2)
    assert.equal(g.naam, 'Test BV')
    await assert.rejects(zoekInBtwRegister('CH123456789', eerstDruk), /niet in het Europese btw-register/)
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })

// Eenmalige archiefverzending van alle contracten: de regels die ervoor zorgen
// dat er nooit een dubbele mail vertrekt, dat elk gevraagd veld in de mail
// staat en dat het overzicht achteraf klopt.
//
//   npx tsx tests/contract-legal-verzending.test.ts

import assert from 'node:assert/strict'
import {
  onderwerpVan, tekstVan, teVersturen, alVerstuurd, samenvatting, ontvangerVan, datumNl,
  GEEN_CERTIFICAAT_ZIN, LEGAL_VERZENDING_STANDAARD,
  type ContractInfo, type VerzendRij,
} from '../lib/contracten/legal-verzending'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

const contract = (over: Partial<ContractInfo> = {}): ContractInfo => ({
  id: 'c1', klantNaam: 'Garage Vantilt', titel: 'Samenwerkingsovereenkomst', contracttype: 'Foto/videografiecontract',
  status: 'signed', signedAt: '2026-08-27T14:49:51Z', startDatum: '2026-09-01', eindDatum: null, ...over,
})
const rij = (over: Partial<VerzendRij> = {}): VerzendRij => ({
  contract_id: 'c1', status: 'verstuurd', certificaat: true, fout: null, verstuurd_op: '2026-09-23T10:00:00Z', pogingen: 1, ...over,
})

console.log('\nContracten → archiefadres\n')

test('1. Onderwerp: Contract – klant – contractnaam – contracttype', () => {
  assert.equal(onderwerpVan(contract()), 'Contract – Garage Vantilt – Samenwerkingsovereenkomst – Foto/videografiecontract')
  assert.equal(onderwerpVan(contract({ klantNaam: null, titel: null, contracttype: null })), 'Contract – Zonder klant – Contract – Niet toegewezen')
})

test('2. De mail vermeldt elk gevraagd veld', () => {
  const t = tekstVan(contract(), { certificaat: true })
  for (const zin of ['Klantnaam: Garage Vantilt', 'Contractnaam: Samenwerkingsovereenkomst', 'Contracttype: Foto/videografiecontract', 'Contractstatus: Getekend', 'Datum van ondertekening: 27/08/2026', 'Startdatum: 01/09/2026', 'Einddatum: —']) {
    assert.ok(t.includes(zin), `ontbreekt: ${zin}`)
  }
})

test('3. Zonder certificaat staat de gevraagde zin in de mail', () => {
  const zonder = tekstVan(contract({ status: 'draft', signedAt: null }), { certificaat: false })
  assert.ok(zonder.includes(GEEN_CERTIFICAAT_ZIN))
  assert.ok(zonder.includes('Datum van ondertekening: —'))
  assert.ok(!tekstVan(contract(), { certificaat: true }).includes(GEEN_CERTIFICAAT_ZIN))
})

test('4. De mail zegt dat dit eenmalig is', () => {
  assert.ok(tekstVan(contract(), { certificaat: true }).includes('geen automatische of terugkerende mailing'))
})

test('5. Een succesvol verstuurd contract gaat nooit opnieuw mee', () => {
  const lijst = [contract({ id: 'a' }), contract({ id: 'b' }), contract({ id: 'c' })]
  const rijen = [rij({ contract_id: 'a' }), rij({ contract_id: 'b', status: 'mislukt', fout: 'Resend 429' })]
  const todo = teVersturen(lijst, rijen).map((c) => c.id)
  assert.deepEqual(todo, ['b', 'c'])
  assert.equal(alVerstuurd(rij()), true)
  assert.equal(alVerstuurd(rij({ status: 'mislukt' })), false)
  assert.equal(alVerstuurd(null), false)
})

test('6. Rondes: max beperkt één aanroep, de rest volgt later', () => {
  const lijst = ['a', 'b', 'c', 'd', 'e'].map((id) => contract({ id }))
  assert.deepEqual(teVersturen(lijst, [], 2).map((c) => c.id), ['a', 'b'])
  assert.deepEqual(teVersturen(lijst, [rij({ contract_id: 'a' }), rij({ contract_id: 'b' })], 2).map((c) => c.id), ['c', 'd'])
  assert.equal(teVersturen(lijst, lijst.map((c) => rij({ contract_id: c.id }))).length, 0)
})

test('7. Overzicht: verstuurd, mislukt, nog te doen en zonder certificaat', () => {
  const lijst = [contract({ id: 'a' }), contract({ id: 'b', klantNaam: 'AITO', titel: 'Contract SMM' }), contract({ id: 'c' }), contract({ id: 'd' })]
  const s = samenvatting(lijst, [
    rij({ contract_id: 'a' }),
    rij({ contract_id: 'b', certificaat: false }),
    rij({ contract_id: 'c', status: 'mislukt', fout: 'Geen pdf', certificaat: false }),
  ])
  assert.equal(s.totaal, 4)
  assert.equal(s.verstuurd, 2)
  assert.equal(s.mislukt, 1)
  assert.equal(s.nogTeDoen, 1)
  assert.deepEqual(s.zonderCertificaat, ['AITO — Contract SMM'])
  assert.deepEqual(s.mislukteContracten, [{ id: 'c', naam: 'Garage Vantilt — Samenwerkingsovereenkomst', fout: 'Geen pdf' }])
})

test('8. Ontvanger: standaard info@nextgenmedia.be, onzin valt terug', () => {
  assert.equal(ontvangerVan(null), LEGAL_VERZENDING_STANDAARD)
  assert.equal(LEGAL_VERZENDING_STANDAARD, 'info@nextgenmedia.be')
  assert.equal(ontvangerVan('  Legal@Voorbeeld.BE '), 'legal@voorbeeld.be')
  assert.equal(ontvangerVan('geen adres'), LEGAL_VERZENDING_STANDAARD)
})

test('9. Datums in de mail zijn Belgisch leesbaar', () => {
  assert.equal(datumNl('2026-09-01'), '01/09/2026')
  assert.equal(datumNl('2026-08-27T14:49:51Z'), '27/08/2026')
  assert.equal(datumNl(null), '—')
})

console.log(`\n${n} tests geslaagd\n`)

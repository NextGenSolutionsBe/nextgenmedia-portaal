// NextGenSolutions: pipeline, waarde, omzet per maand en cijfers.
// Uitvoeren: npx tsx tests/ngs.test.ts
import assert from 'node:assert/strict'
import {
  controleerDeal, dealWaarde, verplaatsing, omzetPerMaand, lopendeMrr, cijfersVoor, periodeVan, verschuif, maandenTussen,
  volgendeOpvolging, wanneer, sorteerKolom, type Deal,
} from '../lib/ngs/model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nNextGenSolutions\n')

const deal = (x: Partial<Deal>): Deal => ({
  id: 'd', bedrijf: 'Acme', contactpersoon: null, email: null, telefoon: null, titel: null, diensten: [], fase: 'afspraak', fase_sinds: '2026-11-01T10:00:00Z',
  afspraak_op: null, waarde_eenmalig: null, waarde_maandelijks: null, looptijd_maanden: null, start_datum: null, bron: null, verantwoordelijke: null,
  gewonnen_op: null, verloren_op: null, verloren_reden: null, created_at: '2026-10-01T10:00:00Z', created_by: null, ...x,
})

test('Deal invoeren: bedrijf verplicht, bedragen zoals mensen ze typen, enkel bekende diensten', () => {
  const ok = controleerDeal({ bedrijf: '  Kilowot ', email: 'jan@kilowot.be', waarde_eenmalig: '4.500', waarde_maandelijks: '79,50', looptijd_maanden: '24', diensten: ['website', 'seo', 'raketten'], bron: 'inbound' })
  assert.ok(ok.ok)
  if (ok.ok) {
    assert.equal(ok.waarde.bedrijf, 'Kilowot')
    assert.equal(ok.waarde.waarde_eenmalig, 4500)
    assert.equal(ok.waarde.waarde_maandelijks, 79.5)
    assert.deepEqual(ok.waarde.diensten, ['website', 'seo'])
  }
  assert.equal(controleerDeal({ bedrijf: '' }).ok, false)
  assert.equal(controleerDeal({ bedrijf: 'X', email: 'geen-mail' }).ok, false)
  assert.equal(controleerDeal({ bedrijf: 'X', looptijd_maanden: '0' }).ok, false)
})

test('Waarde: eenmalig + maandbedrag × looptijd, zonder looptijd één jaar', () => {
  assert.equal(dealWaarde({ waarde_eenmalig: 4500, waarde_maandelijks: 79.5, looptijd_maanden: 24 }), 6408)
  assert.equal(dealWaarde({ waarde_eenmalig: null, waarde_maandelijks: 100, looptijd_maanden: null }), 1200)
})

test('Verplaatsen: won zet datum en start, lost vraagt een reden, terug naar open maakt alles leeg', () => {
  const w = verplaatsing({ start_datum: null }, 'won', {}, '2026-11-22', 'nu')
  assert.ok(w.ok && w.patch.gewonnen_op === '2026-11-22' && w.patch.start_datum === '2026-11-22')
  const w2 = verplaatsing({ start_datum: '2027-01-01' }, 'won', { datum: '2026-11-20' }, '2026-11-22', 'nu')
  assert.ok(w2.ok && w2.patch.start_datum === '2027-01-01', 'een gekozen start blijft')
  assert.equal(verplaatsing({ start_datum: null }, 'lost', {}, '2026-11-22', 'nu').ok, false)
  const l = verplaatsing({ start_datum: null }, 'lost', { reden: 'Te duur' }, '2026-11-22', 'nu')
  assert.ok(l.ok && l.patch.verloren_reden === 'Te duur')
  const o = verplaatsing({ start_datum: null }, 'opvolgen', {}, '2026-11-22', 'nu')
  assert.ok(o.ok && o.patch.gewonnen_op === null && o.patch.verloren_op === null)
  assert.equal(verplaatsing({ start_datum: null }, 'won', { datum: '2026-12-01' }, '2026-11-22', 'nu').ok, false, 'niet in de toekomst')
  assert.equal(verplaatsing({ start_datum: null }, 'onbekend', {}, '2026-11-22', 'nu').ok, false)
})

test('Omzet per maand: eenmalig in de maand van gewonnen, maandbedrag zolang de looptijd loopt', () => {
  const d = deal({ fase: 'won', gewonnen_op: '2026-10-15', waarde_eenmalig: 3000, waarde_maandelijks: 100, looptijd_maanden: 3, start_datum: '2026-11-01' })
  const o = omzetPerMaand([d, deal({ fase: 'lost', verloren_op: '2026-10-10', waarde_eenmalig: 999 })], maandenTussen('2026-10', '2027-02'))
  assert.deepEqual(o.map((m) => `${m.maand}:${m.totaal}`), ['2026-10:3000', '2026-11:100', '2026-12:100', '2027-01:100', '2027-02:0'])
  assert.equal(lopendeMrr([d], '2026-11-22'), 100)
  assert.equal(lopendeMrr([d], '2027-02-01'), 0, 'looptijd voorbij')
})

test('Cijfers: winrate, gemiddelde, open pipeline gewogen, per dienst en redenen', () => {
  const deals = [
    deal({ id: 'a', fase: 'won', gewonnen_op: '2026-11-05', waarde_eenmalig: 6000, diensten: ['website', 'seo'], bron: 'inbound', created_at: '2026-10-06T10:00:00Z' }),
    deal({ id: 'b', fase: 'lost', verloren_op: '2026-11-10', verloren_reden: 'Te duur', bron: 'outbound' }),
    deal({ id: 'c', fase: 'voorstel', waarde_eenmalig: 10000 }),
    deal({ id: 'd', fase: 'opvolgen', waarde_maandelijks: 500, looptijd_maanden: 12 }),
    deal({ id: 'e', fase: 'won', gewonnen_op: '2026-09-01', waarde_eenmalig: 1000 }),
  ]
  const c = cijfersVoor(deals, periodeVan('maand', '2026-11'))
  assert.equal(c.gewonnen.aantal, 1)
  assert.equal(c.gewonnen.waarde, 6000)
  assert.equal(c.winrate, 0.5)
  assert.equal(c.doorlooptijd, 30)
  assert.equal(c.pipelineWaarde, 16000)
  assert.equal(c.gewogen, 10000 * 0.4 + 6000 * 0.6)
  assert.deepEqual(c.perDienst, [{ dienst: 'website', aantal: 1, waarde: 3000 }, { dienst: 'seo', aantal: 1, waarde: 3000 }])
  assert.deepEqual(c.redenen, [{ reden: 'Te duur', aantal: 1 }])
  assert.equal(cijfersVoor(deals, null).gewonnen.aantal, 2, 'alles')
})

test('Periodes en opvolgen: kwartaal, eerstvolgende open taak, wanneer', () => {
  assert.equal(periodeVan('kwartaal', '2026-11').label, 'Q4 2026')
  assert.equal(verschuif(periodeVan('kwartaal', '2026-11'), 1).label, 'Q1 2027')
  const v = volgendeOpvolging([
    { deal_id: 'x', deadline: '2026-11-30' }, { deal_id: 'x', deadline: '2026-11-25' },
    { deal_id: 'x', deadline: '2026-11-20', clickup_status_type: 'closed' }, { deal_id: 'y', deadline: null },
  ])
  assert.equal(v.get('x'), '2026-11-25')
  assert.equal(v.has('y'), false)
  assert.deepEqual(wanneer('2026-11-22', '2026-11-22'), { tekst: 'vandaag', telaat: false, vandaag: true })
  assert.equal(wanneer('2026-11-19', '2026-11-22').tekst, '3 dagen te laat')
  const kolom = sorteerKolom([deal({ id: '1', fase: 'opvolgen' }), deal({ id: '2', fase: 'opvolgen' })], 'opvolgen', new Map([['2', '2026-11-23']]))
  assert.deepEqual(kolom.map((d) => d.id), ['2', '1'])
})

console.log(`\n${n} tests geslaagd\n`)

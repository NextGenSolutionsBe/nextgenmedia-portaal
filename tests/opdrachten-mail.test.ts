// Opvolgmail vanuit de projectkaart: voorstellen en het beste voorstel.
// Uitvoeren: npx tsx tests/opdrachten-mail.test.ts
import assert from 'node:assert/strict'
import { projectMailVoorstellen, standaardVoorstel, voornaamVan, isProjectMailSoort, type ProjectMailInfo } from '../lib/opdrachten-mail'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nOpvolgmail projectkaart\n')

const basis: ProjectMailInfo = { contact: 'Vincent Peters', klant: 'PeppedUp', onderwerp: 'sociale media', afzender: 'Bram', merkNaam: 'NextGenMedia', contract: null, offerte: null, meeting: null, status: null }

test('voornaam en aanhef', () => {
  assert.equal(voornaamVan('vincent peters'), 'Vincent')
  assert.equal(voornaamVan('info@pepmints.eu'), null)
  assert.equal(voornaamVan(null), null)
  const zonder = projectMailVoorstellen({ ...basis, contact: null })
  assert.ok(zonder[0].tekst.startsWith('Hallo,'))
})

test('zonder contract of offerte: even polsen, samen zitten en eigen mail', () => {
  const l = projectMailVoorstellen(basis)
  assert.deepEqual(l.map((v) => v.id), ['opvolging', 'samenzitten', 'eigen'])
  assert.equal(standaardVoorstel(basis), 'opvolging')
  const o = l[0]
  assert.ok(o.tekst.startsWith('Dag Vincent,'))
  assert.match(o.tekst, /hoe het staat met sociale media/)
  assert.match(o.tekst, /Groeten,\nBram\nNextGenMedia$/)
  assert.equal(o.knop, null)
})

test('open contract: herinnering met de tekenlink, en dat is het voorstel', () => {
  const i = { ...basis, contract: { titel: 'Social Media Contract', link: 'https://app/sign/abc', verstuurdOp: '2026-11-02T10:00:00Z', verlooptOp: '2026-12-02' } }
  const l = projectMailVoorstellen(i)
  assert.equal(l[0].id, 'contract')
  assert.equal(l[0].onderwerp, 'Herinnering: Social Media Contract')
  assert.match(l[0].tekst, /Op 2 november stuurde ik je het contract voor sociale media/)
  assert.match(l[0].tekst, /geldig tot 2 december/)
  assert.equal(l[0].link, 'https://app/sign/abc')
  assert.equal(standaardVoorstel(i), 'contract')
})

test('open offerte en een meeting', () => {
  const i = { ...basis, offerte: { titel: 'Offerte reels', link: 'https://app/offerte/x', verstuurdOp: '2026-11-10T09:00:00Z', geldigTot: null }, meeting: { titel: 'Kennismaking', op: '2026-11-05T14:00:00Z' } }
  const l = projectMailVoorstellen(i)
  assert.deepEqual(l.map((v) => v.id), ['offerte', 'meeting', 'opvolging', 'samenzitten', 'eigen'])
  assert.equal(l[0].knop, 'Offerte bekijken')
  assert.equal(standaardVoorstel(i), 'offerte')
  assert.equal(standaardVoorstel({ ...basis, meeting: i.meeting, status: 'na_meeting' }), 'meeting')
  assert.equal(standaardVoorstel({ ...basis, meeting: i.meeting, status: 'geen_reactie' }), 'opvolging')
})

test('geen {{ }}-codes in de voorstellen en geldige soorten', () => {
  const l = projectMailVoorstellen({ ...basis, contract: { titel: 'C', link: 'l', verstuurdOp: null, verlooptOp: null }, offerte: { titel: 'O', link: 'l', verstuurdOp: null, geldigTot: null }, meeting: { titel: 'M', op: '2026-11-05T14:00:00Z' } })
  for (const v of l) { assert.ok(!/\{\{/.test(v.tekst + v.onderwerp)); assert.ok(isProjectMailSoort(v.id)) }
  assert.ok(!isProjectMailSoort('iets'))
})

console.log(`\n${n} tests geslaagd\n`)

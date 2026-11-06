// Projecten ↔ offertes: welke kaart, wanneer de groene label, de taak na een bevestiging.
// Uitvoeren: npx tsx tests/opdrachten-offertes.test.ts
import assert from 'node:assert/strict'
import { contractTaak, kiesKaartVoorOfferte, moetNaarOfferte, offerteBevestigdLabel, taakVoorWie, toonVolgendeStapNaOfferte, werkdagenLater } from '../lib/opdrachten-offerte-model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

console.log('\nProjecten — offertes\n')

test('Een nieuwe offerte komt op de lopende kaart van de klant (Opvolging of Offerte, zonder contract)', () => {
  const kaarten = [
    { id: 'oud', status: 'open', contract_id: null, created_at: '2026-10-01T10:00:00Z' },
    { id: 'nieuw', status: 'voorstel_voorgelegd', contract_id: null, created_at: '2026-11-01T10:00:00Z' },
    { id: 'contract', status: 'contract_verstuurd', contract_id: 'c1', created_at: '2026-11-03T10:00:00Z' },
    { id: 'bezig', status: 'bezig', contract_id: null, created_at: '2026-11-04T10:00:00Z' },
    { id: 'verloren', status: 'geen_interesse', contract_id: null, created_at: '2026-11-04T11:00:00Z' },
  ]
  assert.equal(kiesKaartVoorOfferte(kaarten), 'nieuw')
  assert.equal(kiesKaartVoorOfferte(kaarten.filter((k) => k.id !== 'nieuw' && k.id !== 'oud')), null)   // dan een nieuwe kaart
})

test('Enkel vanuit Opvolging schuift een kaart naar Offerte gestuurd; verder op het bord blijft ze staan', () => {
  assert.equal(moetNaarOfferte('open'), true)
  assert.equal(moetNaarOfferte('voorstel_bezig'), true)
  assert.equal(moetNaarOfferte('voorstel_voorgelegd'), false)
  assert.equal(moetNaarOfferte('contract_verstuurd'), false)
  assert.equal(moetNaarOfferte('bezig'), false)
})

test('Groene label "Offerte bevestigd" enkel zolang er nog geen contract of uitvoering is', () => {
  assert.equal(offerteBevestigdLabel('geaccepteerd', 'offerte'), true)
  assert.equal(offerteBevestigdLabel('geaccepteerd', 'potentieel'), true)
  assert.equal(offerteBevestigdLabel('geaccepteerd', 'contract'), false)
  assert.equal(offerteBevestigdLabel('geaccepteerd', 'uitvoering'), false)
  assert.equal(offerteBevestigdLabel('verstuurd', 'offerte'), false)
  assert.equal(offerteBevestigdLabel(null, 'offerte'), false)
  assert.equal(offerteBevestigdLabel('geaccepteerd', 'geaccepteerd'), false, 'de kolom zegt het al')
})

test('Kaartvenster: contract aanmaken of in gang zetten zolang de kaart in Offerte geaccepteerd staat', () => {
  assert.equal(toonVolgendeStapNaOfferte('geaccepteerd', 'geaccepteerd'), true)
  assert.equal(toonVolgendeStapNaOfferte(null, 'geaccepteerd'), true, 'ook een kaart die met de hand naar Offerte geaccepteerd ging')
  assert.equal(toonVolgendeStapNaOfferte('geaccepteerd', 'offerte'), true)
  assert.equal(toonVolgendeStapNaOfferte('geaccepteerd', 'contract'), false)
  assert.equal(toonVolgendeStapNaOfferte('verstuurd', 'offerte'), false)
})

test('De taak: contract opmaken of in gang zetten, binnen twee werkdagen, bij de verantwoordelijke', () => {
  const t = contractTaak({ klant: 'Apex', titel: 'Webshop', bedrag: 4950, door: 'Jan Peeters', op: '2026-11-04T10:00:00Z' })
  assert.equal(t.omschrijving, 'Contract opmaken of in gang zetten – Apex')
  assert.match(t.notitie, /Webshop/)
  assert.match(t.notitie, /Jan Peeters/)
  assert.equal(werkdagenLater('2026-11-04', 2), '2026-11-06')   // woensdag → vrijdag
  assert.equal(werkdagenLater('2026-11-06', 2), '2026-11-10')   // vrijdag → dinsdag
  assert.deepEqual(taakVoorWie('Marco', 'bram@nextgenmedia.be'), { naam: 'Marco' })
  assert.deepEqual(taakVoorWie('Gezamenlijke lead', 'bram@nextgenmedia.be'), { email: 'bram@nextgenmedia.be' })
  assert.deepEqual(taakVoorWie(null, null), { naam: 'Bram' })
})

console.log(`\n${n} tests geslaagd\n`)

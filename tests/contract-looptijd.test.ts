// Looptijdstatus van contracten: los van de ondertekening, met categorieën
// die elkaar niet tegenspreken (stopgezet verschijnt nooit bij opvolging).
//
//   npx tsx tests/contract-looptijd.test.ts

import assert from 'node:assert/strict'
import {
  looptijdVan, nogTeOndertekenen, opvolgRedenen, opvolgingNodig, inCategorie, telCategorieen,
  verdeling, verdelingTekst, valideerWijziging, type LooptijdContract,
} from '../lib/contracten/looptijd'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
const NU = new Date('2026-09-23T12:00:00Z')

const c = (over: Partial<LooptijdContract> = {}): LooptijdContract => ({
  status: 'signed', looptijd_status: 'lopend', client_id: 'k1', start_date: '2026-06-01', end_date: null,
  sent_at: '2026-06-01T10:00:00Z', created_at: '2026-06-01T09:00:00Z', heeftPdf: true, ...over,
})

console.log('\nContracten — looptijdstatus\n')

test('1. Zonder of met onbekende status → lopend', () => {
  assert.equal(looptijdVan(null), 'lopend')
  assert.equal(looptijdVan(''), 'lopend')
  assert.equal(looptijdVan('onzin'), 'lopend')
  assert.equal(looptijdVan('Stopgezet'), 'stopgezet')
})

test('2. Lopend kan niet-ondertekend zijn (statussen staan los)', () => {
  const x = c({ status: 'sent', looptijd_status: 'lopend' })
  assert.equal(inCategorie(x, 'lopend', NU), true)
  assert.equal(nogTeOndertekenen(x), true)
})

test('3. Nog te ondertekenen sluit afgerond, stopgezet en verlopen uit', () => {
  for (const l of ['afgerond', 'stopgezet', 'verlopen']) assert.equal(nogTeOndertekenen(c({ status: 'sent', looptijd_status: l })), false, l)
  assert.equal(nogTeOndertekenen(c({ status: 'signed' })), false)
  assert.equal(nogTeOndertekenen(c({ status: 'cancelled' })), false)
  assert.equal(nogTeOndertekenen(c({ status: 'draft' })), true)
})

test('4. Stopgezette contracten verschijnen nooit bij opvolging', () => {
  const x = c({ status: 'sent', looptijd_status: 'stopgezet', start_date: null, client_id: null, end_date: '2026-09-25' })
  assert.deepEqual(opvolgRedenen(x, NU), [])
  assert.equal(opvolgingNodig(x, NU), false)
})

test('5. Opvolging: niet ondertekend, te lang uit, einddatum dichtbij, gegevens ontbreken', () => {
  assert.ok(opvolgRedenen(c({ status: 'sent', sent_at: '2026-09-20T00:00:00Z' }), NU).includes('Nog niet ondertekend'))
  assert.ok(opvolgRedenen(c({ status: 'viewed', sent_at: '2026-09-01T00:00:00Z' }), NU).some((r) => r.startsWith('Handtekening blijft uit')))
  assert.ok(opvolgRedenen(c({ end_date: '2026-10-10' }), NU).some((r) => r.startsWith('Einddatum over')))
  assert.ok(opvolgRedenen(c({ end_date: '2026-09-01' }), NU).includes('Einddatum voorbij — status nakijken'))
  assert.ok(opvolgRedenen(c({ start_date: null, client_id: null, heeftPdf: false }), NU).includes('Ontbrekend: klant, startdatum, document'))
  assert.deepEqual(opvolgRedenen(c(), NU), [])
})

test('6. Aantallen per categorie kloppen en volgen een statuswijziging', () => {
  const lijst = [
    c({ looptijd_status: 'lopend' }),
    c({ looptijd_status: 'lopend', status: 'sent' }),
    c({ looptijd_status: 'afgerond' }),
    c({ looptijd_status: 'stopgezet', status: 'sent' }),
    c({ looptijd_status: 'verlopen' }),
  ]
  const t = telCategorieen(lijst, NU)
  assert.equal(t.alle, 5)
  assert.equal(t.lopend, 2)
  assert.equal(t.afgerond, 1)
  assert.equal(t.stopgezet, 1)
  assert.equal(t.verlopen, 1)
  assert.equal(t.te_ondertekenen, 1)
  assert.equal(t.opvolging, 1)
  lijst[1].looptijd_status = 'stopgezet'
  const na = telCategorieen(lijst, NU)
  assert.equal(na.lopend, 1)
  assert.equal(na.stopgezet, 2)
  assert.equal(na.te_ondertekenen, 0)
  assert.equal(na.opvolging, 0)
})

test('7. Verdeling per klantmap + leesbare tekst', () => {
  const v = verdeling([c(), c(), c({ looptijd_status: 'afgerond' }), c({ looptijd_status: 'stopgezet' })])
  assert.deepEqual(v, { lopend: 2, afgerond: 1, stopgezet: 1, verlopen: 0 })
  assert.equal(verdelingTekst(v), '2 lopend · 1 afgerond · 1 stopgezet')
})

test('8. Statuswijziging: validatie, en stopdatum/reden enkel bij stopgezet', () => {
  assert.equal(valideerWijziging({ looptijd_status: 'gepauzeerd' }).ok, false)
  const s = valideerWijziging({ looptijd_status: 'stopgezet', stop_datum: '2026-09-30', stop_reden: ' klant stopt ' })
  assert.ok(s.ok && s.stopDatum === '2026-09-30' && s.stopReden === 'klant stopt')
  const l = valideerWijziging({ looptijd_status: 'afgerond', stop_datum: '2026-09-30', stop_reden: 'x' })
  assert.ok(l.ok && l.stopDatum === null && l.stopReden === null)
  assert.equal(valideerWijziging({ looptijd_status: 'stopgezet', stop_datum: '30/09/2026' }).ok, false)
  const leeg = valideerWijziging({ looptijd_status: 'stopgezet' })
  assert.ok(leeg.ok && leeg.stopDatum === null && leeg.stopReden === null)
})

console.log(`\n${n} tests geslaagd\n`)

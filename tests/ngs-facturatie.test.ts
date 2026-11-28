import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verrekening, vervaldag, betaaltermijn, auditRegels, workflowRegels, totaalVan } from '../lib/ngs/facturatie'

test('verrekening: audit gaat af van de eerste workflow, nooit negatief', () => {
  assert.deepEqual(verrekening(1040, 4200), { verrekend: 1040, teFactureren: 3160 })
  assert.deepEqual(verrekening(1040, 800), { verrekend: 800, teFactureren: 0 })
  assert.deepEqual(verrekening(null, 4200), { verrekend: 0, teFactureren: 4200 })
  assert.deepEqual(verrekening(-50, 4200), { verrekend: 0, teFactureren: 4200 })
})

test('regels: workflow met verrekening telt op tot het te factureren bedrag', () => {
  const r = workflowRegels('Offertes opmaken', 'Generator', 4200, 1040)
  assert.equal(r.length, 2)
  assert.equal(r[1].prijs, -1040)
  assert.equal(totaalVan(r), 3160)
  assert.equal(workflowRegels('X', null, 4200, 0).length, 1)
  assert.match(auditRegels(3, 1335)[0].omschrijving, /3 processen/)
  assert.equal(totaalVan(auditRegels(1, 745)), 745)
})

test('betaaltermijn: van het bedrijf, anders de algemene', () => {
  assert.equal(betaaltermijn(30, 14), 30)
  assert.equal(betaaltermijn(null, 14), 14)
  assert.equal(betaaltermijn(999, 14), 14)
  assert.equal(vervaldag('2026-11-28', 30), '2026-12-28')
})

test('namens wie we tekenen: de vennootschap met de handelsnaam', async () => {
  const { namensVoor, bedrijfVoorMerk } = await import('../lib/contracten/tegenhandtekening')
  assert.equal(namensVoor('nextgensolutions'), 'NextGen Agency BV, handelsnaam NextGenSolutions')
  assert.equal(namensVoor(null), 'NextGen Agency BV, handelsnaam NextGenMedia')
  assert.equal(namensVoor('algemeen'), 'NextGen Agency BV')
  assert.equal(bedrijfVoorMerk('nextgensolutions'), 'NextGenSolutions')
})

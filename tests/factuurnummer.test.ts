import assert from 'node:assert/strict'
import { volgendFactuurnummer, leesFactuurnummer, zelfdeFactuurnummer, naFactuurnummer, hoogsteFactuurnummer, maakFactuurnummer } from '../lib/facturatie/factuurnummer'

// Doorlopend binnen het jaar: na 2026-123 komt 2026-124.
assert.equal(volgendFactuurnummer(['2026-106', '2026-123', '2026-74', '2026-102', null, ''], 2026), '2026-124')
// Nieuw jaar: 2027-001, ook al staan er 2026-nummers.
assert.equal(volgendFactuurnummer(['2026-123'], 2027), '2027-001')
// Startnummer uit de instellingen gaat voor als het hoger ligt (zelfde jaar).
assert.equal(volgendFactuurnummer(['2026-123'], 2026, '2026-130'), '2026-130')
assert.equal(volgendFactuurnummer(['2026-123'], 2026, '2026-100'), '2026-124')
assert.equal(volgendFactuurnummer(['2026-123'], 2027, '2026-130'), '2027-001')
assert.equal(volgendFactuurnummer([], 2027, '2027-005'), '2027-005')
// Vreemde nummers tellen niet mee.
assert.equal(volgendFactuurnummer(['F-0012', 'abc', '2026-'], 2026), '2026-001')
// Lezen en vergelijken.
assert.deepEqual(leesFactuurnummer(' 2026-074 '), { jaar: 2026, volgnr: 74 })
assert.equal(leesFactuurnummer('2026-0'), null)
assert.equal(zelfdeFactuurnummer('2026-074', '2026-74'), true)
assert.equal(zelfdeFactuurnummer('2026-74', '2026-75'), false)
assert.equal(naFactuurnummer('2026-124'), '2026-125')
assert.equal(naFactuurnummer('2026-999'), '2026-1000')
assert.equal(maakFactuurnummer(2027, 1), '2027-001')
assert.equal(hoogsteFactuurnummer('2026-124', '2026-126'), '2026-126')
assert.equal(hoogsteFactuurnummer(null, '2026-126'), '2026-126')
assert.equal(hoogsteFactuurnummer('2027-001', '2026-130'), '2027-001')
console.log('factuurnummer: ok')

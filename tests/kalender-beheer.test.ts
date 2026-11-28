// Contentkalender beheren door klant — per klant instelbaar.
//
//   npx tsx tests/kalender-beheer.test.ts

import assert from 'node:assert/strict'
import { magKalenderBeheren, magNaarStatus, klantOvergangen, publicatie } from '../lib/content/kalender-beheer'
import { klantPatch } from '../lib/content/klant-bewerking'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nKalenderbeheer door klant\n')

const UIT = { kalender_beheer: false, kalender_beheer_wie: 'alle', kalender_beheer_eigenaar: true }
test('1. Standaard uit: niemand van de klant beheert (huidige werking blijft)', () => {
  assert.equal(magKalenderBeheren(UIT, { isOwner: true, kanEdit: true }), false)
  assert.equal(magKalenderBeheren(null, { isOwner: true, kanEdit: true }), false)
})
test('Aan voor alle gebruikers, of enkel geselecteerde (eigenaar-vinkje + subaccounts met recht)', () => {
  const alle = { ...UIT, kalender_beheer: true }
  assert.equal(magKalenderBeheren(alle, { isOwner: false, kanEdit: false }), true)
  const sel = { ...UIT, kalender_beheer: true, kalender_beheer_wie: 'geselecteerd', kalender_beheer_eigenaar: false }
  assert.equal(magKalenderBeheren(sel, { isOwner: true, kanEdit: true }), false)
  assert.equal(magKalenderBeheren(sel, { isOwner: false, kanEdit: true }), true)
  assert.equal(magKalenderBeheren(sel, { isOwner: false, kanEdit: false }), false)
  assert.equal(magKalenderBeheren({ ...sel, kalender_beheer_eigenaar: true }, { isOwner: true, kanEdit: false }), true)
})
test('Statussen: goedkeuring en feedback worden niet overgeslagen; eigen concept zelf inplannen; gepubliceerd markeren', () => {
  assert.deepEqual(klantOvergangen('ready_for_review'), []); assert.deepEqual(klantOvergangen('changes_requested'), [])
  assert.equal(magNaarStatus('draft', 'scheduled'), true); assert.equal(magNaarStatus('approved', 'published'), true); assert.equal(magNaarStatus('scheduled', 'published'), true)
  assert.equal(magNaarStatus('draft', 'ready_for_review'), false); assert.equal(magNaarStatus('ready_for_review', 'approved'), false)
})
test('Publicatiegegevens: datum (niet in de toekomst), kanaal van het item, geldige link', () => {
  const p = publicatie({ published_at: '2026-10-12', published_platform: 'meta', published_url: 'https://instagram.com/p/abc' }, '2026-10-12', ['meta', 'tiktok'])
  assert.equal(p.published_platform, 'meta'); assert.equal(p.published_url, 'https://instagram.com/p/abc')
  assert.equal(publicatie({}, '2026-10-12', []).published_at.slice(0, 10), '2026-10-12')
  assert.throws(() => publicatie({ published_at: '2026-10-13' }, '2026-10-12', []), /toekomst/)
  assert.throws(() => publicatie({ published_platform: 'youtube' }, '2026-10-12', ['meta']), /kanaal/)
  assert.throws(() => publicatie({ published_url: 'javascript:alert(1)' }, '2026-10-12', []), /link/)
})
test('Tijdstip bewerken', () => {
  assert.equal(klantPatch({ planned_time: '09:30' }).planned_time, '09:30'); assert.equal(klantPatch({ planned_time: '' }).planned_time, null)
  assert.throws(() => klantPatch({ planned_time: '25:00' }), /tijdstip/)
})
console.log(`\n${n} tests geslaagd\n`)

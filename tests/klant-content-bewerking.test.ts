// Klant past zelf de contentplanner aan.
//
//   npx tsx tests/klant-content-bewerking.test.ts

import assert from 'node:assert/strict'
import { klantPatch, gewijzigdeVelden, klantNieuw, magKlantVerwijderen } from '../lib/content/klant-bewerking'
import { MODULE_ACTIONS, PRESETS, fullPermissions, can } from '../lib/portal-permissions'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nKlant past content aan\n')

test('Titel, caption, script, media-notities, datum, type en kanalen mogen', () => {
  const p = klantPatch({ title: ' Nieuwe titel ', caption: 'Tekst', script: 'Hook\nCTA', media_notes: '', planned_date: '2026-11-03', content_type: 'reel', platforms: ['instagram', 'linkedin'] })
  assert.equal(p.title, 'Nieuwe titel'); assert.equal(p.script, 'Hook\nCTA'); assert.equal(p.media_notes, null)
  assert.equal(p.planned_date, '2026-11-03'); assert.equal(p.content_type, 'reel')
  assert.ok(p.platforms!.includes('meta')); assert.equal(p.platform, p.platforms![0])
})

test('Status, klant, ClickUp en interne notities worden genegeerd', () => {
  const p = klantPatch({ title: 'x', status: 'published', client_id: 'ander', clickup_task_id: 'x', interne_notitie: 'geheim', client_feedback: 'x' } as Record<string, unknown>)
  assert.deepEqual(Object.keys(p), ['title'])
})

test('Ongeldige invoer geeft een duidelijke fout', () => {
  assert.throws(() => klantPatch({ title: '   ' }), /titel/)
  assert.throws(() => klantPatch({ planned_date: '03/11/2026' }), /datum/)
  assert.throws(() => klantPatch({ content_type: 'blog' }), /type/)
  assert.throws(() => klantPatch({ platforms: ['myspace'] }), /kanaal/)
})

test('Enkel echte wijzigingen tellen voor de audit', () => {
  assert.deepEqual(gewijzigdeVelden({ title: 'A', script: 'S' }, { title: 'A', script: 'T' }), ['script'])
})

test('Rechten: "bewerken" bestaat voor social media; eigenaar en marketing hebben het, alleen-lezen niet', () => {
  assert.ok(MODULE_ACTIONS.social_media.includes('edit'))
  assert.equal(can(fullPermissions(), 'social_media', 'edit'), true)
  assert.equal(can(PRESETS.find((p) => p.key === 'marketing')!.permissions(), 'social_media', 'edit'), true)
  assert.equal(can(PRESETS.find((p) => p.key === 'readonly')!.permissions(), 'social_media', 'edit'), false)
})

test('Zelf inplannen: titel, datum en kanaal verplicht; type standaard post; verwijderen enkel eigen concept', () => {
  const n = klantNieuw({ title: 'Teaser', planned_date: '2026-11-05', platforms: ['tiktok'] })
  assert.equal(n.content_type, 'post'); assert.deepEqual(n.platforms, ['tiktok'])
  assert.throws(() => klantNieuw({ planned_date: '2026-11-05', platforms: ['tiktok'] }), /titel/)
  assert.throws(() => klantNieuw({ title: 'x', platforms: ['tiktok'] }), /datum/)
  assert.throws(() => klantNieuw({ title: 'x', planned_date: '2026-11-05' }), /kanaal/)
  assert.equal(magKlantVerwijderen({ klant_aangemaakt_op: '2026-10-12', status: 'draft' }), true)
  assert.equal(magKlantVerwijderen({ klant_aangemaakt_op: '2026-10-12', status: 'approved' }), false)
  assert.equal(magKlantVerwijderen({ klant_aangemaakt_op: null, status: 'draft' }), false)
})

console.log(`\n${n} tests geslaagd\n`)

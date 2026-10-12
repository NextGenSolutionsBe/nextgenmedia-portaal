// Klant past zelf de contentplanner aan.
//
//   npx tsx tests/klant-content-bewerking.test.ts

import assert from 'node:assert/strict'
import { klantPatch, gewijzigdeVelden } from '../lib/content/klant-bewerking'
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

console.log(`\n${n} tests geslaagd\n`)

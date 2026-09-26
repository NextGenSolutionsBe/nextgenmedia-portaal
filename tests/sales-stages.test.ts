// Tests voor de kanbanfases en de vertaling van oude fasesleutels.
// Uitvoeren: npx tsx tests/sales-stages.test.ts
import assert from 'node:assert/strict'
import {
  STAGES, STAGE_KEYS, LEGACY_STAGE_MAP, LEGACY_STAGE_KEYS, normaliseerStage, stageLabel, stageKeysVoor,
  isWonStage, isLostStage, isGesloten, canTransition, stageRang, focusDoelFase, FOCUS_ACTIONS,
  vereistVerantwoordelijke, mistVerantwoordelijke,
} from '../lib/sales/stages'
import { bouwWachtrij, MAX_GEEN_GEHOOR } from '../lib/sales/focus-queue'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ok ${naam}`) }

console.log('Sales — fases')

test('1. Tien kolommen, Outbound en Inbound links, Geen interesse na E-mail verstuurd, Gewonnen en Verloren rechts', () => {
  assert.equal(STAGES.length, 10)
  assert.equal(STAGE_KEYS[STAGE_KEYS.indexOf('email_verstuurd') + 1], 'geen_interesse')
  assert.deepEqual(STAGE_KEYS.slice(0, 2), ['outbound', 'inbound'])
  assert.deepEqual(STAGE_KEYS.slice(-2), ['gewonnen', 'verloren'])
})

test('2. Elke oude sleutel landt op een bestaande nieuwe kolom', () => {
  for (const k of LEGACY_STAGE_KEYS) assert.ok(STAGE_KEYS.includes(LEGACY_STAGE_MAP[k]), k)
  assert.equal(normaliseerStage('to_contact'), 'outbound')
  assert.equal(normaliseerStage('contacted_call'), 'gebeld')
  assert.equal(normaliseerStage('contacted_mail'), 'email_verstuurd')
  assert.equal(normaliseerStage('contacted_linkedin'), 'email_verstuurd')
  assert.equal(normaliseerStage('email_sent'), 'email_verstuurd')
  assert.equal(normaliseerStage('email_after_call'), 'opvolgen')
  assert.equal(normaliseerStage('max_pogingen'), 'opvolgen')
  assert.equal(normaliseerStage('appointment'), 'afspraak')
  assert.equal(normaliseerStage('not_interested'), 'geen_interesse')
  assert.equal(normaliseerStage('lost'), 'verloren')
  assert.equal(normaliseerStage('won'), 'gewonnen')
})

test('3. Nieuwe sleutels blijven zichzelf; onbekend of leeg → outbound', () => {
  for (const k of STAGE_KEYS) assert.equal(normaliseerStage(k), k)
  assert.equal(normaliseerStage('bestaat_niet'), 'outbound')
  assert.equal(normaliseerStage(null), 'outbound')
  assert.equal(normaliseerStage(undefined), 'outbound')
  assert.equal(normaliseerStage(''), 'outbound')
})

test('4. Labels en gesloten-status werken ook op oude sleutels', () => {
  assert.equal(stageLabel('appointment'), 'Afspraak gepland')
  assert.equal(stageLabel('outbound'), 'Outbound leads')
  assert.ok(isWonStage('won') && isWonStage('gewonnen'))
  assert.ok(!isLostStage('not_interested') && isLostStage('verloren') && !isLostStage('geen_interesse'))
  assert.ok(isGesloten('lost') && !isGesloten('opvolgen'))
})

test('5. stageKeysVoor geeft de nieuwe plus alle oude sleutels van een kolom', () => {
  assert.deepEqual(stageKeysVoor('gewonnen').sort(), ['gewonnen', 'won'])
  assert.deepEqual(stageKeysVoor('verloren').sort(), ['lost', 'verloren'])
  assert.deepEqual(stageKeysVoor('geen_interesse').sort(), ['geen_interesse', 'not_interested'])
  assert.deepEqual(stageKeysVoor('voorstel'), ['voorstel'])
})

test('6. Vrij bewegen tussen kolommen; niet naar dezelfde of een onbekende kolom', () => {
  assert.ok(canTransition('outbound', 'gewonnen'))
  assert.ok(canTransition('gewonnen', 'outbound'))
  assert.ok(!canTransition('outbound', 'outbound'))
  assert.ok(!canTransition('to_contact', 'outbound'), 'oude sleutel telt als dezelfde kolom')
  assert.ok(!canTransition('outbound', 'appointment'), 'oude sleutel is geen geldig doel')
})

test('7. Rang: oud en nieuw vergelijkbaar; Focus-acties schuiven enkel vooruit', () => {
  assert.equal(stageRang('appointment'), stageRang('afspraak'))
  assert.ok(stageRang('gebeld') > stageRang('outbound'))
  assert.equal(focusDoelFase('outbound', 'gebeld'), 'gebeld')
  assert.equal(focusDoelFase('opvolgen', 'gebeld'), null)
  assert.equal(focusDoelFase('afspraak', 'email_verstuurd'), null)
  assert.equal(focusDoelFase('opvolgen', 'verloren'), 'verloren')
  assert.equal(FOCUS_ACTIONS.length, 6)
  assert.ok(FOCUS_ACTIONS.every((a) => a.stage === null || STAGE_KEYS.includes(a.stage)))
})

test('8. Belrij: vervallen terugbelmoment, dan opvolgdatum, dan Outbound → Inbound → Opvolgen', () => {
  const nu = Date.parse('2026-09-21T10:00:00Z')
  const l = (id: string, stage_key: string, extra: Record<string, unknown> = {}) =>
    ({ id, stage_key, do_not_call: false, callback_at: null, ...extra })
  const rij = bouwWachtrij([
    l('opv', 'opvolgen'),
    l('in', 'inbound'),
    l('out', 'to_contact'),
    l('gebeld', 'gebeld'),
    l('gebeld-due', 'gebeld', { opvolgdatum: '2026-09-20' }),
    l('toekomst', 'outbound', { opvolgdatum: '2026-10-01' }),
    l('cb', 'outbound', { callback_at: '2026-09-21T09:00:00Z' }),
    l('later', 'outbound', { callback_at: '2026-09-21T12:00:00Z' }),
    l('afspraak', 'appointment'),
    l('dnc', 'outbound', { do_not_call: true }),
    l('max', 'outbound', { geen_gehoor_count: MAX_GEEN_GEHOOR }),
  ], nu)
  assert.deepEqual(rij.nu.map((x) => x.id), ['cb', 'gebeld-due', 'out', 'in', 'opv'])
  assert.deepEqual(rij.later.map((x) => x.id), ['later'])
})

test('Verantwoordelijke vereist vanaf Afspraak gepland', () => {
  for (const k of ['afspraak', 'voorstel', 'gewonnen', 'verloren']) assert.equal(vereistVerantwoordelijke(k), true, k)
  for (const k of ['outbound', 'inbound', 'gebeld', 'email_verstuurd', 'opvolgen']) assert.equal(vereistVerantwoordelijke(k), false, k)
  assert.equal(mistVerantwoordelijke({ stage_key: 'afspraak', assigned_to: null }), true)
  assert.equal(mistVerantwoordelijke({ stage_key: 'afspraak', assigned_to: 'x' }), false)
  assert.equal(mistVerantwoordelijke({ stage_key: 'gebeld', assigned_to: null }), false)
})

console.log(`\n${n} tests geslaagd.`)

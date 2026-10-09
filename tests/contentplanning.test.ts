// Contentplanning — reeksen, beurten, taken zonder dubbels, termijnen, routine.
//
//   npx tsx tests/contentplanning.test.ts

import assert from 'node:assert/strict'
import {
  STANDAARD_CP as S, beurtenMetBord, faseplanVanMaand, pasFaseAan, wisselDag, planNaarDagen, reeksPeriodes, segmenten, eersteWerkdag, standaardFases, fasesVanMaand, reeksenVanDag, plusWerkdagen, isKwartaalmaand, ritmeVan, beurten, teMakenTaken,
  verwachteDatum, isAchterstallig, deadlineVerstreken, routineVoorDag, werkdagenVanMaand, leesCp,
} from '../lib/contentplanning/model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nContentplanning\n')

test('Reeksen per dag komen uit de Maandplanning (standaard + handmatige aanpassing)', () => {
  assert.deepEqual(standaardFases(1, 22), ['ideeen'])
  const f = fasesVanMaand('2026-10', { '2026-10-07': ['scripts'], '2026-10-08': ['shoots', 'edit'] })
  assert.deepEqual(reeksenVanDag(f.get('2026-10-01')!, S.fase_reeks), [1])
  assert.deepEqual(reeksenVanDag(f.get('2026-10-08')!, S.fase_reeks), [2, 3]) // shoots (R2) + editen (R3)
  assert.equal(f.has('2026-10-03'), false) // zaterdag: geen werkdag
  assert.equal(werkdagenVanMaand('2026-10').length, 22)
})

test('Werkdagen: weekends tellen niet mee', () => {
  assert.equal(plusWerkdagen('2026-10-08', 3), '2026-10-13') // do + 3 werkdagen = di
  assert.equal(plusWerkdagen('2026-10-09', 7), '2026-10-20')
})

test('Kwartaalmaand volgt de startmaand van de batch', () => {
  assert.equal(isKwartaalmaand('2026-06', 5), true)
  assert.equal(isKwartaalmaand('2026-09', 5), true)
  assert.equal(isKwartaalmaand('2026-10', 5), false)
  assert.equal(isKwartaalmaand('2027-03', 5), true)
})

const o = (key: string) => S.onderdelen.find((x) => x.key === key)!

test('Ritme per activiteit: kwartaalshoot ≠ alles per kwartaal', () => {
  const k = { ritme: 'maandelijks' as const, activiteiten: { shoot: 'per_kwartaal' as const }, batch_start_maand: 5 }
  assert.equal(ritmeVan(o('shoot'), k), 'per_kwartaal')
  assert.equal(ritmeVan(o('script'), k), 'elke_cyclus')
  assert.equal(ritmeVan(o('meeting'), k), 'per_kwartaal')
  const drie = { ritme: 'driemaandelijks' as const, activiteiten: { statistieken: 'elke_cyclus' as const }, batch_start_maand: 5 }
  assert.equal(ritmeVan(o('script'), drie), 'per_kwartaal')
  assert.equal(ritmeVan(o('statistieken'), drie), 'elke_cyclus')
})

test('Ontbrekende instellingen worden gemeld, niet gegokt', () => {
  const b = beurten('2026-10', S.onderdelen, { ritme: null, activiteiten: {}, batch_start_maand: null })
  assert.ok(b.every((x) => x.aanDeBeurt === null && x.reden))
  const zonderBatch = beurten('2026-10', S.onderdelen, { ritme: 'maandelijks', activiteiten: {}, batch_start_maand: null })
  assert.equal(zonderBatch.find((x) => x.onderdeel === 'meeting')!.aanDeBeurt, null)
  assert.equal(zonderBatch.find((x) => x.onderdeel === 'script')!.aanDeBeurt, true)
})

test('Taken klaarzetten: geen dubbels, en bewust verwijderde taken komen niet terug', () => {
  const b = beurten('2026-09', S.onderdelen, { ritme: 'maandelijks', activiteiten: {}, batch_start_maand: 5 })
  const eerste = teMakenTaken(S.onderdelen, b, new Set())
  assert.equal(eerste.length, 8)
  // Tweede keer (verversen): alles bestaat al → niets nieuws.
  assert.equal(teMakenTaken(S.onderdelen, b, new Set(eerste.map((t) => t.sjabloon_sleutel))).length, 0)
  // Chiara verwijderde de shoot (zacht verwijderd → sleutel bestaat nog) → komt niet terug.
  const zonderShoot = new Set(eerste.map((t) => t.sjabloon_sleutel))
  assert.equal(teMakenTaken(S.onderdelen, b, zonderShoot).some((t) => t.onderdeel === 'shoot'), false)
  // Oktober is geen kwartaalmaand → geen kwartaalmeeting.
  const okt = teMakenTaken(S.onderdelen, beurten('2026-10', S.onderdelen, { ritme: 'maandelijks', activiteiten: {}, batch_start_maand: 5 }), new Set())
  assert.equal(okt.some((t) => t.onderdeel === 'meeting'), false)
})

test('Goedkeuringstermijn start pas bij het vastgelegde verstuurmoment', () => {
  assert.equal(verwachteDatum(null, 7), null)
  assert.equal(verwachteDatum('2026-10-08', 7), '2026-10-19')
})

test('Achterstallig: open taak met verstreken werkdatum of deadline; afgerond nooit', () => {
  const V = '2026-10-08'
  assert.equal(isAchterstallig({ werkdatum: '2026-10-07', deadline: null, status: 'ingepland' }, V, S.statussen), true)
  assert.equal(isAchterstallig({ werkdatum: '2026-10-07', deadline: null, status: 'afgerond' }, V, S.statussen), false)
  assert.equal(isAchterstallig({ werkdatum: '2026-10-09', deadline: '2026-10-01', status: 'ingepland' }, V, S.statussen), true)
  assert.equal(deadlineVerstreken({ werkdatum: '2026-10-09', deadline: '2026-10-09', status: 'ingepland' }, V, S.statussen), false)
})

test('Inner Stance: dagelijks + donderdag/vrijdag', () => {
  assert.equal(routineVoorDag(S.routine, '2026-10-07').length, 2) // woensdag
  assert.equal(routineVoorDag(S.routine, '2026-10-08').length, 3) // donderdag
  assert.equal(routineVoorDag(S.routine, '2026-10-09').length, 3) // vrijdag
  assert.equal(routineVoorDag(S.routine, '2026-10-10').length, 0) // zaterdag
})

test('Instellingen: leeg of half → aangevuld met de standaard', () => {
  const l = leesCp({ aanpassing_werkdagen: 4 })
  assert.equal(l.aanpassing_werkdagen, 4); assert.equal(l.onderdelen.length, 8); assert.equal(l.goedkeuring_werkdagen, null)
})

test('Klantenbatches-bord gaat voor: ✓/✗ per reeks, kwartaalmeeting volgt nog de batch', () => {
  const k = { ritme: 'driemaandelijks' as const, activiteiten: {}, batch_start_maand: 5 }
  // Oktober is geen kwartaalmaand, maar het bord zegt: deze maand enkel editen (R3).
  const b = beurtenMetBord('2026-10', S.onderdelen, k, { 1: false, 2: false, 3: true })
  assert.deepEqual(b.filter((x) => x.aanDeBeurt).map((x) => x.onderdeel), ['edit', 'feedback', 'aanpassingen', 'inplannen', 'statistieken'])
  // R1 ✓ in een niet-kwartaalmaand: contentkalender ja, kwartaalmeeting nee.
  const r1 = beurtenMetBord('2026-10', S.onderdelen, k, { 1: true })
  assert.equal(r1.find((x) => x.onderdeel === 'script')!.aanDeBeurt, true)
  assert.equal(r1.find((x) => x.onderdeel === 'meeting')!.aanDeBeurt, false)
  // Niets aangeduid voor R2 → gewone regel (driemaandelijks, geen kwartaalmaand → nee).
  assert.equal(r1.find((x) => x.onderdeel === 'shoot')!.aanDeBeurt, false)
  // Ritme onbekend, maar bord ingevuld → het bord volstaat.
  const zonder = beurtenMetBord('2026-10', S.onderdelen, { ritme: null, activiteiten: {}, batch_start_maand: null }, { 2: true })
  assert.equal(zonder.find((x) => x.onderdeel === 'shoot')!.aanDeBeurt, true)
})

test('Reeksen aanpassen: editen één dag langer → feedback en aanpassingen schuiven mee; shoots niet', () => {
  const plan = faseplanVanMaand('2026-10', {})
  assert.deepEqual(segmenten(plan.edit), [[11, 18]])
  const na = pasFaseAan(plan, 'edit', [11, 18], [11, 19], true, 22)
  assert.deepEqual(segmenten(na.edit), [[11, 19]])
  assert.deepEqual(segmenten(na.feedback), [[20, 22]])      // was 19–21
  assert.deepEqual(segmenten(na.aanpassingen), [[20, 22]])  // was 19–22, klemt op de laatste werkdag
  assert.deepEqual(segmenten(na.shoots), [[6, 13]])         // begon vóór het einde van editen → blijft
  assert.deepEqual(segmenten(na.stats), [[22, 22]])          // laatste werkdag blijft de laatste
  // Zonder meeschuiven verandert enkel editen.
  const zonder = pasFaseAan(plan, 'edit', [11, 18], [11, 19], false, 22)
  assert.deepEqual(segmenten(zonder.feedback), [[19, 21]])
})

test('Reeksen: dag aan/uit, terug naar per-dag-opslag, periodes per reeks, eerste werkdag', () => {
  const plan = wisselDag(faseplanVanMaand('2026-10', {}), 'ideeen', 3)
  assert.deepEqual(segmenten(plan.ideeen), [[1, 3]])
  const dagen = planNaarDagen('2026-10', plan)
  assert.deepEqual(dagen['2026-10-05'], ['ideeen', 'intakes']) // 3e werkdag = maandag 5 oktober
  const p = reeksPeriodes('2026-10', faseplanVanMaand('2026-10', {}), S.fase_reeks)
  assert.deepEqual(p[1], { van: '2026-10-01', tot: '2026-10-12', dagen: 8 })
  assert.equal(eersteWerkdag('2026-11'), '2026-11-02') // 1 november is een zondag
})

console.log(`\n${n} tests geslaagd\n`)

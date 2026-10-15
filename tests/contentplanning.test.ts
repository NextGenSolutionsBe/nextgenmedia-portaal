// Contentplanning — reeksen, beurten, taken zonder dubbels, termijnen, routine.
//
//   npx tsx tests/contentplanning.test.ts

import assert from 'node:assert/strict'
import {
  STANDAARD_CP as S, beurtenMetBord, faseplanVanMaand, pasFaseAan, wisselDag, planNaarDagen, reeksPeriodes, segmenten, eersteWerkdag, standaardFases, fasesVanMaand, reeksenVanDag, plusWerkdagen, isKwartaalmaand, ritmeVan, beurten, teMakenTaken,
  verwachteDatum, isAchterstallig, deadlineVerstreken, routineVoorDag, werkdagenVanMaand, leesCp, bordVanKlant, leesWerkwijze, MAANDSTART,
  batchNr, startmaandVoorBatch, BORD_BATCHES, werkwijze1Beurten, inReeks1, BORD_MAANDELIJKS, ritmeNaVerplaatsen, opBordMaandelijks,
  REEKS1_AANPASSINGEN, reeks1AanpassingenCheckDatum,
} from '../lib/contentplanning/model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nContentplanning\n')

test('Reeksen per dag komen uit de Maandplanning (standaard + handmatige aanpassing)', () => {
  assert.deepEqual(standaardFases(1, 22), ['ideeen'])
  const f = fasesVanMaand('2026-10', { '2026-10-07': ['scripts'], '2026-10-08': ['shoots', 'edit'] })
  assert.deepEqual(reeksenVanDag(f.get('2026-10-01')!, S.fase_reeks), [1])
  assert.deepEqual(reeksenVanDag(f.get('2026-10-08')!, S.fase_reeks), [2]) // shoots + editen = allebei reeks 2
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
  const ROUTINE = [{ key: 'a', titel: 'a', dagen: [1, 2, 3, 4, 5] }, { key: 'b', titel: 'b', dagen: [1, 2, 3, 4, 5] }, { key: 'c', titel: 'c', dagen: [4] }, { key: 'd', titel: 'd', dagen: [5] }]
  assert.equal(routineVoorDag(ROUTINE, '2026-10-07').length, 2) // woensdag
  assert.equal(routineVoorDag(ROUTINE, '2026-10-08').length, 3) // donderdag
  assert.equal(routineVoorDag(ROUTINE, '2026-10-09').length, 3) // vrijdag
  assert.equal(routineVoorDag(ROUTINE, '2026-10-10').length, 0) // zaterdag
})

test('Instellingen: leeg of half → aangevuld met de standaard', () => {
  const l = leesCp({ aanpassing_werkdagen: 4 })
  assert.equal(l.aanpassing_werkdagen, 4); assert.equal(l.onderdelen.length, 8); assert.equal(l.goedkeuring_werkdagen, null)
})

test('Klantenbatches-bord gaat voor: ✓/✗ per reeks, kwartaalmeeting volgt nog de batch', () => {
  const k = { ritme: 'driemaandelijks' as const, activiteiten: {}, batch_start_maand: 5 }
  // Oktober is geen kwartaalmaand, maar het bord zegt: deze maand enkel reeks 3 (feedback, verwerken, statistieken).
  const b = beurtenMetBord('2026-10', S.onderdelen, k, { 1: false, 2: false, 3: true })
  assert.deepEqual(b.filter((x) => x.aanDeBeurt).map((x) => x.onderdeel), ['feedback', 'aanpassingen', 'inplannen', 'statistieken'])
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

test('Klantenbatches: zodra er één ✓ in de maand staat, is niet aangevinkt = deze maand niet', () => {
  assert.deepEqual(bordVanKlant([], 'a'), {}) // nog niets aangevinkt → ritme/batch beslist
  const rijen = [{ client_id: 'a', reeks: 1 as const, actief: true }, { client_id: 'b', reeks: 2 as const, actief: false }]
  assert.deepEqual(bordVanKlant(rijen, 'a'), { 1: true, 2: false, 3: false })
  assert.deepEqual(bordVanKlant(rijen, 'c'), { 1: false, 2: false, 3: false })
  assert.equal(MAANDSTART[0].weergave, 'reeksen') // eerst de reeksen, dan de klantenbatches
})

test('Werkwijze per reeks: stappen, badges, deelblokken en let-op uit het tekstformaat', () => {
  const w = leesWerkwijze('! Pitch Please als eerste editen.\n# Posts & stories [Claude Design]\n- Bijsturen\n# Meetings\n## Onboarding\n- Verloop volgen uit het portaal\n## Kwartaalmeeting\n- Statistieken\n- Content shoot vastleggen')
  assert.deepEqual(w.letOp, ['Pitch Please als eerste editen.'])
  assert.equal(w.stappen.length, 2)
  assert.deepEqual([w.stappen[0].titel, w.stappen[0].badge, w.stappen[0].punten], ['Posts & stories', 'Claude Design', ['Bijsturen']])
  assert.deepEqual(w.stappen[1].blokken.map((b) => [b.titel, b.punten.length]), [['Onboarding', 1], ['Kwartaalmeeting', 2]])
  // Standaard: drie reeksen met een stappenplan, INN met twee weektaken, geen dagelijkse Inner Stance-checks meer.
  const c = leesCp({})
  // Werkwijze 1: zes stappen, zonder "Notities bekijken" (de app toont zelf wie aan de beurt is).
  const w1 = leesWerkwijze(c.reeks_detail['1'])
  assert.deepEqual(w1.stappen.map((x) => x.titel), ['Contentkalender genereren', 'Content invullen', 'Reelscripts doornemen met Bram', 'Contentkalender naar ClickUp', 'Meetings', 'Laatste dag: alle aanpassingen doorvoeren'])
  assert.ok(w1.stappen[4].punten.includes('Werk inplannen 1 à 2 dagen vóór elke meeting'))
  assert.match(w1.stappen[5].punten[0], /^Aparte taak/)
  // Werkwijze 2: eerst weten waar het materiaal staat, pas dan plannen en editen.
  const w2 = leesWerkwijze(c.reeks_detail['2'])
  assert.equal(w2.letOp[0], 'Pitch Please als eerste editen.')
  assert.deepEqual(w2.stappen.map((x) => x.titel), ['Materiaal zoeken', 'Volgorde bepalen', 'Posts & stories', 'Reels', 'Afronden per klant', 'Opvolgtaak zetten', 'Goedkeuringstermijn aanduiden'])
  assert.ok(!c.reeks_detail['2'].includes('in je notities'))
  assert.deepEqual(c.vaste_taken.map((t) => t.key), ['inn_copy', 'inn_inplannen'])
  // INN · SLL · K · J: enkel de vier stappen van Chiara (Claude plant in, zij controleert, Claude zet op Scheduled, artikels zelf).
  const inplannen = c.vaste_taken[1]
  assert.equal(inplannen.titel, 'Content inplannen')
  assert.deepEqual(leesWerkwijze(inplannen.detail).stappen.map((x) => x.titel), ['Zeg tegen Claude in de gepinde chat', 'Controleer of alles klopt', 'Zeg tegen Claude dat alles op Scheduled mag', 'Artikels post je zelf'])
  assert.deepEqual(c.routine, [])
  assert.deepEqual(leesCp({ bord_verborgen: ['x', 3] }).bord_verborgen, ['x'])
})

test('Editen hoort in reeks 2: in oktober 2026 (echte aanpassingen) start reeks 3 pas op 26/10', () => {
  // De Maandplanning-aanpassingen van oktober 2026 zoals ze in de databank staan.
  const okt: Record<string, string[]> = {
    '2026-10-01': ['ideeen'], '2026-10-02': ['ideeen', 'intakes'], '2026-10-05': ['ideeen', 'intakes'], '2026-10-06': ['ideeen', 'intakes'], '2026-10-07': ['scripts'],
    ...Object.fromEntries(['08', '09', '12', '13', '14', '15', '16', '19', '20', '21', '22', '23'].map((d) => [`2026-10-${d}`, ['shoots', 'edit']])),
    '2026-10-26': ['shoots', 'edit', 'feedback'], '2026-10-27': ['shoots', 'edit', 'feedback', 'aanpassingen'],
    '2026-10-28': ['feedback', 'aanpassingen'], '2026-10-29': ['feedback', 'aanpassingen'], '2026-10-30': ['feedback', 'aanpassingen', 'stats'],
  }
  const kop = leesCp({ fase_reeks: { edit: 2 } }).fase_reeks
  assert.equal(kop.edit, 2)
  const per = reeksPeriodes('2026-10', faseplanVanMaand('2026-10', okt), kop)
  assert.equal(per[2]!.van, '2026-10-08')
  assert.equal(per[3]!.van, '2026-10-26') // eerste dag reeks 3 = meetings plannen
  assert.deepEqual(reeksenVanDag(fasesVanMaand('2026-10', okt).get('2026-10-12')!, kop), [2]) // vandaag (12/10) geen reeks 3
  assert.equal(S.onderdelen.find((o) => o.key === 'edit')!.reeks, 2)
})

test('Laatste dag reeks 1: één aparte taak, alle aanpassingen van alle klanten doorvoeren', () => {
  const okt: Record<string, string[]> = {
    '2026-10-01': ['ideeen'], '2026-10-02': ['ideeen', 'intakes'], '2026-10-05': ['ideeen', 'intakes'], '2026-10-06': ['ideeen', 'intakes'], '2026-10-07': ['scripts'],
    ...Object.fromEntries(['08', '09', '12', '13', '14', '15', '16', '19', '20', '21', '22', '23'].map((d) => [`2026-10-${d}`, ['shoots', 'edit']])),
  }
  // De taak valt op de laatste werkdag van reeks 1 volgens de Maandplanning (oktober 2026: 7/10).
  assert.equal(reeksPeriodes('2026-10', faseplanVanMaand('2026-10', okt), S.fase_reeks)[1]!.tot, '2026-10-07')
  // Zonder aanpassingen: werkdag 8 (12/10).
  assert.equal(reeksPeriodes('2026-10', faseplanVanMaand('2026-10', {}), S.fase_reeks)[1]!.tot, '2026-10-12')
  assert.match(REEKS1_AANPASSINGEN.titel, /alle klanten.*alle kalenders/)
  // Afgevinkt per maand, los van de dag: schuift de reeks later, dan blijft het vinkje staan.
  assert.equal(reeks1AanpassingenCheckDatum('2026-10'), '2026-10-01')
  assert.ok(!MAANDSTART.some((m) => m.key === REEKS1_AANPASSINGEN.key))
})

test('Maandstart: eerst de reeksen bepalen, dan batches + klantenbord', () => {
  assert.deepEqual(MAANDSTART.map((m) => m.key), ['maandstart_reeksen', 'maandstart_batches'])
  assert.equal(MAANDSTART[0].titel, 'De reeksen van deze maand bepalen')
  assert.match(MAANDSTART[1].titel, /batches.*klantenbord/i)
  assert.equal(eersteWerkdag('2026-11'), '2026-11-02')
})

test('Klantenbord: altijd Batch 1, 2 en 3; nieuwe batch volgt de bestaande een maand later', () => {
  assert.deepEqual([...BORD_BATCHES], [1, 2, 3])
  assert.equal(batchNr('Batch 2'), 2)
  assert.equal(batchNr(' batch3 '), 3)
  assert.equal(batchNr('Najaar'), null)
  assert.equal(startmaandVoorBatch(2, [{ naam: 'Batch 1', start_month: 5 }]), 6) // juni → juli
  assert.equal(startmaandVoorBatch(3, [{ naam: 'Batch 1', start_month: 5 }]), 7)
  assert.equal(startmaandVoorBatch(1, [{ naam: 'Batch 3', start_month: 0 }]), 10) // jan − 2 = november
  assert.equal(startmaandVoorBatch(2, []), 1)
})

test('Werkwijze 1: wie is aan de beurt? (maandelijks, driemaandelijks, al gepland, meeting, ontbrekende instellingen)', () => {
  // Werkwijze 1 in oktober 2026 = kalender voor november + meetings in oktober. Batch met startmaand juli (6): kwartaalmaanden jul/okt/jan/apr.
  const k = (client_id: string, ritme: 'maandelijks' | 'driemaandelijks' | null, contentMaanden: string[] = [], extra: Record<string, unknown> = {}) =>
    ({ client_id, instelling: { ritme, activiteiten: {}, batch_start_maand: 6 }, contentMaanden, ...extra })
  const r = Object.fromEntries(werkwijze1Beurten('2026-10', S.onderdelen, [
    k('maand', 'maandelijks'),
    k('maand_klaar', 'maandelijks', ['2026-10', '2026-11']),
    k('drie_kwartaal', 'driemaandelijks', ['2026-08', '2026-09', '2026-10']),
    { ...k('drie_loopt', 'driemaandelijks', ['2026-10', '2026-11', '2026-12']), instelling: { ritme: 'driemaandelijks', activiteiten: {}, batch_start_maand: 7 } },
    { ...k('drie_gat', 'driemaandelijks'), instelling: { ritme: 'driemaandelijks', activiteiten: {}, batch_start_maand: 7 } },
    k('geen_ritme', null),
    k('geen_ritme_gepland', null, ['2026-11', '2026-12']),
    k('meeting_gekozen', 'maandelijks', [], { meetingStatus: 'niet_nodig' }),
  ]).map((b) => [b.client_id, b]))
  // Maandelijks zonder planning voor november: nieuwe kalender; oktober is een kwartaalmaand → meeting.
  assert.equal(r.maand.kalender, 'nodig'); assert.equal(r.maand.meeting, 'nodig'); assert.equal(inReeks1(r.maand), true)
  // Al gepland voor november: geen nieuwe kalender, maar de meeting blijft.
  assert.equal(r.maand_klaar.kalender, 'al_gepland'); assert.equal(r.maand_klaar.geplandTot, '2026-11')
  // Driemaandelijks in de kwartaalmaand: kalender voor drie maanden.
  assert.equal(r.drie_kwartaal.kalender, 'nodig'); assert.match(r.drie_kwartaal.reden ?? '', /twee maanden erna/)
  // Driemaandelijks met een lopende kalender (tot december): niet opnieuw in de maandelijkse workflow.
  assert.equal(r.drie_loopt.kalender, 'al_gepland'); assert.equal(r.drie_loopt.meeting, 'niet_aan_de_beurt'); assert.equal(inReeks1(r.drie_loopt), false)
  // Niet aan de beurt volgens het ritme, maar er staat ook niets gepland: niet stil laten vallen.
  assert.equal(r.drie_gat.kalender, 'controleren'); assert.equal(r.drie_gat.volgendeKwartaal, '2026-11'); assert.equal(inReeks1(r.drie_gat), true)
  // Zonder ritme: niets gepland voor november is hoe dan ook werk; het ontbrekende ritme wordt apart gemeld, de meeting gokken we niet.
  assert.equal(r.geen_ritme.kalender, 'nodig'); assert.equal(inReeks1(r.geen_ritme), true)
  assert.match(r.geen_ritme.instellingOntbreekt ?? '', /Ritme/); assert.equal(r.geen_ritme.meeting, 'onbekend')
  assert.equal(r.geen_ritme_gepland.kalender, 'al_gepland'); assert.equal(inReeks1(r.geen_ritme_gepland), false); assert.ok(r.geen_ritme_gepland.instellingOntbreekt)
  assert.equal(r.maand.instellingOntbreekt, null)
  // De keuze uit de meetingplanning (reeks 3 van vorige maand) gaat voor op het ritme.
  assert.equal(r.meeting_gekozen.meeting, 'niet_nodig')
})

test('Klantenbord: kolom Maandelijks naast Batch 1, 2 en 3 = het ritme van de klant (geen tweede systeem)', () => {
  assert.equal(BORD_MAANDELIJKS, 'maandelijks')
  // Naar Maandelijks: ritme maandelijks, ongeacht wat het was.
  assert.equal(ritmeNaVerplaatsen(BORD_MAANDELIJKS, null), 'maandelijks')
  assert.equal(ritmeNaVerplaatsen(BORD_MAANDELIJKS, 'driemaandelijks'), 'maandelijks')
  // Naar een batch: cyclus van drie maanden.
  for (const n of BORD_BATCHES) { assert.equal(ritmeNaVerplaatsen(n, 'maandelijks'), 'driemaandelijks'); assert.equal(ritmeNaVerplaatsen(n, null), 'driemaandelijks') }
  // Naar "Nog geen batch": een maandelijkse klant verliest dat ook (anders stond hij nog in Maandelijks); de rest blijft.
  assert.equal(ritmeNaVerplaatsen(null, 'maandelijks'), null)
  assert.equal(ritmeNaVerplaatsen(null, 'driemaandelijks'), 'driemaandelijks')
  assert.equal(ritmeNaVerplaatsen(null, null), null)
  assert.equal(opBordMaandelijks('maandelijks'), true); assert.equal(opBordMaandelijks('driemaandelijks'), false); assert.equal(opBordMaandelijks(null), false)
  // En werkwijze 1 leest hetzelfde ritme: een maandelijkse klant zonder planning voor volgende maand heeft een kalender nodig.
  const [b] = werkwijze1Beurten('2026-10', S.onderdelen, [{ client_id: 'x', instelling: { ritme: ritmeNaVerplaatsen(BORD_MAANDELIJKS, null), activiteiten: {}, batch_start_maand: 6 }, contentMaanden: [] }])
  assert.equal(b.kalender, 'nodig'); assert.equal(b.instellingOntbreekt, null)
})

console.log(`\n${n} tests geslaagd\n`)

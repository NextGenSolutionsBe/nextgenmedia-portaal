// Agenda: plaats in de kalender, overlappende afspraken, ClickUp-import, kleuren, invoer.
// Uitvoeren: npx tsx tests/agenda-model.test.ts
import assert from 'node:assert/strict'
import {
  plaatsVan, opDag, legUit, itemUitClickup, magOverschrijven, kleurVan, dagenVan, controleerItem, zoneNaarIso, tijdTekst, naamSleutel,
  type KleurContext,
} from '../lib/agenda/model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nAgenda\n')

const iso = (d: string, u: string) => zoneNaarIso(d, u)

test('met uur op één dag = uurrooster, anders bovenaan de dag', () => {
  assert.deepEqual(plaatsVan({ start_op: iso('2026-11-25', '11:30'), eind_op: iso('2026-11-25', '13:00'), heel_dag: false }), { soort: 'rooster', dag: '2026-11-25', vanMin: 690, totMin: 780 })
  assert.deepEqual(plaatsVan({ start_op: null, eind_op: iso('2026-11-25', '14:00'), heel_dag: false }), { soort: 'rooster', dag: '2026-11-25', vanMin: 810, totMin: 840 })
  assert.deepEqual(plaatsVan({ start_op: null, eind_op: iso('2026-11-26', '04:00'), heel_dag: true }), { soort: 'dag', van: '2026-11-26', tot: '2026-11-26' })
  // Een hele week (Sunday-blok in de screenshot): bovenaan elke dag.
  const p = plaatsVan({ start_op: iso('2026-11-23', '04:00'), eind_op: iso('2026-11-29', '04:00'), heel_dag: true })
  assert.deepEqual(p, { soort: 'dag', van: '2026-11-23', tot: '2026-11-29' })
  assert.ok(opDag({ start_op: iso('2026-11-23', '04:00'), eind_op: iso('2026-11-29', '04:00'), heel_dag: true }, '2026-11-26'))
  assert.equal(plaatsVan({ start_op: null, eind_op: null, heel_dag: true }), null)
  // Tot middernacht telt nog als dezelfde dag.
  assert.deepEqual(plaatsVan({ start_op: iso('2026-11-25', '22:00'), eind_op: iso('2026-11-26', '00:00'), heel_dag: false }), { soort: 'rooster', dag: '2026-11-25', vanMin: 1320, totMin: 1440 })
})

test('overlappende afspraken naast elkaar, de rest volle breedte', () => {
  const b = legUit([
    { item: 'a', vanMin: 600, totMin: 720 },   // 10:00–12:00
    { item: 'b', vanMin: 600, totMin: 690 },   // 10:00–11:30
    { item: 'c', vanMin: 765, totMin: 945 },   // 12:45–15:45
  ])
  const per = Object.fromEntries(b.map((x) => [x.item, x]))
  assert.equal(per.a.kolommen, 2); assert.equal(per.b.kolommen, 2)
  assert.notEqual(per.a.kolom, per.b.kolom)
  assert.equal(per.c.kolommen, 1); assert.equal(per.c.kolom, 0)
})

test('ClickUp-taak: meeting, datum zonder uur, afgevinkt, checklist en velden', () => {
  const start = Date.parse(iso('2026-11-25', '11:30')), eind = Date.parse(iso('2026-11-25', '13:00'))
  const m = itemUitClickup({ id: '1', name: 'Meeting Kilowot', status: { status: 'to do', color: '#fff848', type: 'open' }, start_date: String(start), due_date: String(eind), priority: null })
  assert.equal(m.soort, 'meeting'); assert.equal(m.heel_dag, false); assert.equal(m.status, 'open')
  const zonderUur = itemUitClickup({ id: '2', name: 'Factuur Apex sturen', due_date: String(Date.parse(iso('2026-11-27', '04:00'))), priority: { priority: 'urgent' } })
  assert.equal(zonderUur.heel_dag, true); assert.equal(zonderUur.soort, 'taak'); assert.equal(zonderUur.urgent, true); assert.equal(zonderUur.prioriteit, 1)
  const klaar = itemUitClickup({
    id: '3', name: 'Post', status: { status: 'complete', type: 'closed' }, date_closed: '1764000000000',
    checklists: [{ name: 'Stappen', items: [{ name: 'Tekst', resolved: true }, { name: 'Foto', resolved: false }] }],
    custom_fields: [{ id: 'c', name: 'Channel', type: 'drop_down', value: 0, type_config: { options: [{ id: 'x', name: 'Instagram', orderindex: 0 }] } }, { id: 'd', name: 'Link', type: 'url' }],
  })
  assert.equal(klaar.status, 'klaar'); assert.ok(klaar.afgerond_op)
  assert.match(klaar.beschrijving ?? '', /- \[x\] Tekst\n- \[ \] Foto/)
  assert.deepEqual(klaar.velden, { Channel: 'Instagram' })
})

test('import overschrijft enkel wat in ClickUp nieuwer is en niet nadien in de app veranderde', () => {
  assert.equal(magOverschrijven(null, '2026-11-25T10:00:00Z'), true)
  assert.equal(magOverschrijven({ clickup_bijgewerkt_op: '2026-11-25T10:00:00Z', in_app_gewijzigd_op: null }, '2026-11-25T10:00:00Z'), false)
  assert.equal(magOverschrijven({ clickup_bijgewerkt_op: '2026-11-25T10:00:00Z', in_app_gewijzigd_op: null }, '2026-11-25T11:00:00Z'), true)
  assert.equal(magOverschrijven({ clickup_bijgewerkt_op: '2026-11-25T10:00:00Z', in_app_gewijzigd_op: '2026-11-25T12:00:00Z' }, '2026-11-25T11:00:00Z'), false)
})

test('kleur: eigen kleur, dan klant (via de map), label of lijst', () => {
  const c: KleurContext = {
    klantKleuren: { k1: '#ff0000' },
    labels: { l1: { id: 'l1', naam: 'Shoot', kleur: '#00ff00', volgorde: 0 } },
    lijsten: { li: { id: 'li', space_id: 's', map_id: 'm', naam: 'List', kleur: null, client_id: null, prive: false, volgorde: 0, clickup_id: null } },
    mappen: { m: { id: 'm', space_id: 's', parent_id: null, naam: 'Klant', kleur: null, client_id: 'k1', prive: false, volgorde: 0, clickup_id: null } },
  }
  const basis = { kleur: null, client_id: null, lijst_id: 'li', labels: ['l1'], clickup_status_kleur: null, status: 'open' as const, bron: 'ag' as const }
  assert.equal(kleurVan(basis, c, 'klant'), '#ff0000')
  assert.equal(kleurVan(basis, c, 'label'), '#00ff00')
  assert.equal(kleurVan({ ...basis, kleur: '#123456' }, c, 'klant'), '#123456')
})

test('maand: van maandag tot zondag rond de maand', () => {
  const d = dagenVan('maand', '2026-11-25')
  assert.equal(d[0], '2026-10-26'); assert.equal(d[d.length - 1], '2026-12-06'); assert.equal(d.length % 7, 0)
  assert.deepEqual(dagenVan('week', '2026-11-25'), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'])
})

test('invoer: titel verplicht, einde niet voor begin, enkel geldige koppelingen', () => {
  assert.equal(controleerItem({ titel: ' ' }, true).fout, 'Geef een titel.')
  assert.equal(controleerItem({ titel: 'x', start_op: '2026-11-25T12:00:00Z', eind_op: '2026-11-25T11:00:00Z' }, true).fout, 'Het einde ligt voor het begin.')
  assert.equal(controleerItem({ lijst_id: 'abc' }, false).fout, 'Ongeldige koppeling.')
  const ok = controleerItem({ titel: 'Sauna', urgent: true, toegewezen: ['00000000-0000-0000-0000-000000000001', 'nee'] }, true)
  assert.equal(ok.velden.prioriteit, 1); assert.deepEqual(ok.toegewezen, ['00000000-0000-0000-0000-000000000001'])
})

test('tijdtekst en klantnamen vergelijken', () => {
  assert.equal(tijdTekst({ start_op: iso('2026-11-25', '11:30'), eind_op: iso('2026-11-25', '13:00'), heel_dag: false }), '11:30–13:00')
  assert.equal(tijdTekst({ start_op: null, eind_op: iso('2026-11-25', '04:00'), heel_dag: true }), 'Hele dag')
  assert.equal(naamSleutel('Verheyen nv'), naamSleutel('VERHEYEN'))
  assert.equal(naamSleutel('DK Maatwerk BV'), 'dkmaatwerk')
})

console.log(`\n${n} tests geslaagd\n`)

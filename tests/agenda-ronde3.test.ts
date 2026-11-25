// Agenda: deadlines, een taak inspreken en opgemaakte documenten.
// Uitvoeren: npx tsx tests/agenda-ronde3.test.ts
import assert from 'node:assert/strict'
import { plaatsVan, enkelDeadline, deadlineLabel, snelleDeadlines, itemUitClickup, controleerItem, tijdTekst, zoneNaarIso } from '../lib/agenda/model'
import { leesInspreekVoorstel, zoekPersoon, type InspreekContext } from '../lib/agenda/inspreken'
import { schoonDocJson, veiligeLink, veiligBeeld, tekstVanDoc, BEELD_PAD } from '../lib/agenda/doc-opmaak'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nAgenda: deadlines, inspreken, documenten\n')
const iso = (d: string, u: string) => zoneNaarIso(d, u)

test('enkel een deadline: bovenaan de dag van de deadline', () => {
  const dl = iso('2026-11-27', '17:00')
  assert.ok(enkelDeadline({ start_op: null, eind_op: null, heel_dag: false, deadline_op: dl }))
  assert.deepEqual(plaatsVan({ start_op: null, eind_op: null, heel_dag: false, deadline_op: dl }), { soort: 'dag', van: '2026-11-27', tot: '2026-11-27' })
  // Uit ClickUp: einde = deadline, geen start.
  assert.deepEqual(plaatsVan({ start_op: null, eind_op: dl, heel_dag: false, deadline_op: dl }), { soort: 'dag', van: '2026-11-27', tot: '2026-11-27' })
  // Gepland op een ander moment: blijft op het geplande moment staan.
  const p = plaatsVan({ start_op: iso('2026-11-26', '14:00'), eind_op: iso('2026-11-26', '15:00'), heel_dag: false, deadline_op: dl })
  assert.deepEqual(p, { soort: 'rooster', dag: '2026-11-26', vanMin: 840, totMin: 900 })
  assert.equal(tijdTekst({ start_op: null, eind_op: null, heel_dag: false, deadline_op: dl }), 'Tegen 17:00')
})

test('deadlinelabel: uur, morgen, dag en te laat', () => {
  const nu = new Date(iso('2026-11-25', '10:00'))
  assert.deepEqual(deadlineLabel(iso('2026-11-25', '17:00'), undefined, nu), { tekst: 'Deadline 17:00', teLaat: false, vandaag: true })
  assert.equal(deadlineLabel(iso('2026-11-26', '12:00'), undefined, nu).tekst, 'Deadline morgen 12:00')
  assert.match(deadlineLabel(iso('2026-11-28', '17:00'), undefined, nu).tekst, /^Deadline za 28 nov\.? 17:00$/)
  assert.equal(deadlineLabel(iso('2026-11-28', '17:00'), '2026-11-28', nu).tekst, 'Deadline 17:00')
  assert.equal(deadlineLabel(iso('2026-11-25', '09:00'), undefined, nu).teLaat, true)
})

test('snelle deadlines: enkel wat nog moet komen, vrijdag = eerstvolgende', () => {
  const opWoensdag = snelleDeadlines(new Date(iso('2026-11-25', '18:00')))
  assert.ok(!opWoensdag.some((s) => s.label === 'Vandaag 17:00'))
  assert.equal(opWoensdag.find((s) => s.label === 'Vrijdag 17:00')?.iso, iso('2026-11-27', '17:00'))
  const opVrijdag = snelleDeadlines(new Date(iso('2026-11-27', '18:00')))
  assert.equal(opVrijdag.find((s) => s.label === 'Vrijdag 17:00')?.iso, iso('2026-12-04', '17:00'))
})

test('ClickUp: einde met uur zonder start = deadline; meeting of hele dag niet', () => {
  const due = String(Date.parse(iso('2026-11-27', '17:00')))
  assert.equal(itemUitClickup({ id: '1', name: 'Samenvatting', due_date: due, due_date_time: true }).deadline_op, iso('2026-11-27', '17:00'))
  assert.equal(itemUitClickup({ id: '2', name: 'x', due_date: due, due_date_time: false }).deadline_op, null)
  assert.equal(itemUitClickup({ id: '3', name: 'Call', start_date: String(Date.parse(iso('2026-11-27', '16:00'))), start_date_time: true, due_date: due, due_date_time: true }).deadline_op, null)
})

test('invoer: deadline wordt nagekeken', () => {
  assert.equal(controleerItem({ titel: 'x', deadline_op: '2026-11-27T16:00:00Z' }, true).velden.deadline_op, '2026-11-27T16:00:00.000Z')
  assert.equal(controleerItem({ deadline_op: null }, false).velden.deadline_op, null)
  assert.equal(controleerItem({ deadline_op: 'morgen' }, false).fout, 'Een datum klopt niet.')
})

const ctx: InspreekContext = {
  vandaag: '2026-11-25',
  personen: [
    { id: 'b', naam: 'Bram Reinquin', actief: true, metAccount: true },
    { id: 'm', naam: 'Marco Castermans', actief: true, metAccount: true },
    { id: 'c', naam: 'Chiara Peeters', actief: true, metAccount: true },
    { id: 's1', naam: 'Senne', actief: true, metAccount: false },
    { id: 's2', naam: 'Senne Wellens', actief: true, metAccount: false },
  ],
  lijsten: [{ id: 'l1', label: 'Klanten › Pitch Please › Taken' }, { id: 'l2', label: 'Klanten › Group Cé › Taken' }],
}

test('inspreken: titel, beschrijving, deadline, mensen en map', () => {
  const v = leesInspreekVoorstel({
    titel: 'Samenvatting sturen naar Marijn', beschrijving: 'De punten van dinsdag', soort: 'taak', datum: null, van: null, tot: null,
    deadline_datum: '2026-11-27', deadline_uur: '17:00', personen: ['Bram', 'marco'], lijst: 2, urgent: false, onduidelijk: null,
  }, ctx)!
  assert.equal(v.titel, 'Samenvatting sturen naar Marijn')
  assert.deepEqual(v.toegewezen, ['b', 'm'])
  assert.equal(v.deadline_dag, '2026-11-27'); assert.equal(v.deadline_uur, '17:00')
  assert.equal(v.lijst_id, 'l2'); assert.equal(v.dag, null)
})

test('inspreken: wat niet klopt valt weg', () => {
  const v = leesInspreekVoorstel({ titel: 'Meeting X', soort: 'meeting', datum: '2026-11-26', van: '14u', tot: null, deadline_uur: '17u30', personen: ['Jan', 'Senne'], lijst: 9 }, ctx)!
  assert.equal(v.van, '14:00'); assert.equal(v.tot, '15:00')
  // Een uur zonder dag = de dag van de taak.
  assert.equal(v.deadline_dag, '2026-11-26'); assert.equal(v.deadline_uur, '17:30')
  // "Senne" bestaat precies zo; "Jan" kennen we niet.
  assert.deepEqual(v.toegewezen, ['s1']); assert.deepEqual(v.nietGevonden, ['Jan'])
  // Een voornaam die twee keer voorkomt zonder account: niet gokken.
  assert.equal(zoekPersoon('Xhoana', [{ id: 'x1', naam: 'Xhoana A', actief: true, metAccount: false }, { id: 'x2', naam: 'Xhoana B', actief: true, metAccount: false }]), null)
  assert.equal(v.lijst_id, null)
  assert.equal(leesInspreekVoorstel({ titel: '' }, ctx), null)
  assert.equal(leesInspreekVoorstel({ titel: 'x', datum: '2024-01-01' }, ctx)!.dag, null)
  assert.equal(zoekPersoon('Chiara', ctx.personen), 'c')
  assert.equal(zoekPersoon('Senne Wellens', ctx.personen), 's2')
})

test('documentopmaak: gekende blokken blijven, gevaarlijke links en vreemde blokken niet', () => {
  const doc = {
    type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, onclick: 'x' }, content: [{ type: 'text', text: 'Titel' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'klik', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'bold' }] },
        { type: 'text', text: ' hier', marks: [{ type: 'link', attrs: { href: 'https://nextgenmedia.be' } }, { type: 'highlight', attrs: { color: '#fef08a' } }] },
        { type: 'text', text: ' rood', marks: [{ type: 'textStyle', attrs: { color: 'red;background:url(x)', fontFamily: 'Comic Sans' } }] },
      ] },
      { type: 'script', content: [{ type: 'text', text: 'weg' }] },
      { type: 'image', attrs: { src: 'javascript:alert(1)' } },
      { type: 'image', attrs: { src: '/api/admin/agenda?docbeeld=11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.png' } },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 1, colwidth: [120] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] }] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'klaar' }] }] }] },
    ],
  }
  const s = schoonDocJson(doc)!
  assert.equal(s.content!.length, 5)
  assert.deepEqual(s.content![0].attrs, { level: 1 })
  const p = s.content![1].content!
  assert.deepEqual(p[0].marks, [{ type: 'bold' }])
  assert.equal(p[1].marks![0].attrs!.href, 'https://nextgenmedia.be')
  assert.equal(p[2].marks, undefined)
  assert.equal(s.content![2].type, 'image')
  assert.deepEqual(s.content![3].content![0].content![0].attrs, { colspan: 1, colwidth: [120] })
  assert.equal(s.content![4].content![0].attrs!.checked, true)
  assert.equal(schoonDocJson({ type: 'paragraph' }), null)
  assert.equal(tekstVanDoc(s).includes('Titel\n'), true)
})

test('veilige adressen voor links en afbeeldingen', () => {
  assert.equal(veiligeLink('mailto:info@voorbeeld.be'), 'mailto:info@voorbeeld.be')
  assert.equal(veiligeLink('/admin/agenda'), '/admin/agenda')
  assert.equal(veiligeLink('//evil.com'), null)
  assert.equal(veiligeLink('data:text/html,x'), null)
  assert.equal(veiligBeeld('/api/admin/agenda?docbeeld=../../etc'), null)
  assert.ok(BEELD_PAD.test('11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.webp'))
  assert.ok(!BEELD_PAD.test('11111111-1111-1111-1111-111111111111/../x.png'))
})

console.log(`\n${n} tests geslaagd\n`)

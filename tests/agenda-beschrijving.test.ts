// Agenda: opgemaakte beschrijving van een taak (markdown ernaast, aanvullen buiten de editor).
// Uitvoeren: npx tsx tests/agenda-beschrijving.test.ts
import assert from 'node:assert/strict'
import { markdownVanDoc, vulDocAan, type DocNode } from '../lib/agenda/doc-opmaak'
import { controleerItem } from '../lib/agenda/model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nAgenda: beschrijving\n')
const p = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content })
const t = (text: string, ...marks: string[]): DocNode => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((m) => ({ type: m })) } : {}) })
const cel = (soort: string, tekst: string): DocNode => ({ type: soort, content: [p(t(tekst))] })

const doc: DocNode = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [t('Bij de receptie')] },
  p(t('Dag, '), t('Bram ', 'bold'), { type: 'text', text: 'hier', marks: [{ type: 'highlight', attrs: { color: '#fef08a' } }] }),
  { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('gedaan'))] }, { type: 'taskItem', attrs: { checked: false }, content: [p(t('open'))] }] },
  { type: 'table', content: [{ type: 'tableRow', content: [cel('tableHeader', '#'), cel('tableHeader', 'Bedrijf')] }, { type: 'tableRow', content: [cel('tableCell', '1'), cel('tableCell', 'A | B')] }] },
] }

test('markdown naast de opmaak: koppen, vet, afvinklijst, tabel', () => {
  assert.equal(markdownVanDoc(doc), '## Bij de receptie\n\nDag, **Bram** hier\n\n- [x] gedaan\n- [ ] open\n\n| \\# | Bedrijf |\n| --- | --- |\n| 1 | A \\| B |'.replace('\\#', '#'))
  assert.equal(markdownVanDoc(null), '')
})

test('aanvullen buiten de editor houdt de opmaak, iets anders niet', () => {
  const md = markdownVanDoc(doc)
  const aan = vulDocAan(doc, md, `${md}\n\n**Dag afgesloten 25 nov:** Wacht op foto’s`)!
  assert.equal(aan.content!.length, doc.content!.length + 1)
  assert.deepEqual(aan.content!.at(-1), p(t('Dag afgesloten 25 nov:', 'bold'), t(' Wacht op foto’s')))
  assert.equal(vulDocAan(doc, md, md), doc)
  assert.equal(vulDocAan(doc, md, 'iets helemaal anders'), null)
  assert.equal(vulDocAan(null, md, md + 'x'), null)
})

test('de server maakt de tekst zelf uit de opmaak, ongeldige opmaak wordt geweigerd', () => {
  const r = controleerItem({ beschrijving_json: doc, beschrijving: 'genegeerd' }, false)
  assert.equal(r.fout, undefined)
  assert.equal(r.velden.beschrijving, markdownVanDoc(doc))
  assert.ok(r.velden.beschrijving_json)
  const leeg = controleerItem({ beschrijving_json: { type: 'doc', content: [{ type: 'paragraph' }] } }, false)
  assert.equal(leeg.velden.beschrijving_json, null)
  assert.equal(leeg.velden.beschrijving, null)
  assert.ok(controleerItem({ beschrijving_json: { type: 'iets' } }, false).fout)
  assert.equal(controleerItem({ beschrijving_json: null }, false).velden.beschrijving_json, null)
})

console.log(`\n${n} tests geslaagd\n`)

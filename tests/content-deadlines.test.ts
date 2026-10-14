// Goedkeuringsdeadlines contentkalender — de pure regels.
//
//   npx tsx tests/content-deadlines.test.ts

import assert from 'node:assert/strict'
import {
  dagenTot, eindeMoment, isVerstreken, maandBereik, maandenTekst, maandLabel, tel, valideerDeadline, vandaagBrussel,
  deadlineNaDagen, geldigeTermijn, aftelStand, aftelTekst, aantalDagenTekst, voornaam, TERMIJN_KEUZES,
} from '../lib/content/deadline-model'
import { DEFAULT_TEMPLATES } from '../lib/email-templates-defaults'
import { renderTemplate, PLACEHOLDERS } from '../lib/email-render'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

console.log('\nGoedkeuringsdeadlines\n')

test('Maanden in mensentaal (NL en EN), ook over jaren heen', () => {
  assert.equal(maandLabel('2026-10'), 'oktober 2026')
  assert.equal(maandenTekst(['2026-10']), 'oktober 2026')
  assert.equal(maandenTekst(['2026-11', '2026-10']), 'oktober en november 2026')
  assert.equal(maandenTekst(['2026-10', '2026-11', '2026-12']), 'oktober, november en december 2026')
  assert.equal(maandenTekst(['2026-12', '2027-01']), 'december 2026 en januari 2027')
  assert.equal(maandenTekst(['2026-10', '2026-11'], 'en'), 'October and November 2026')
})

test('Dagen tot de deadline: de deadline-dag telt nog mee', () => {
  assert.equal(dagenTot('2026-10-06', '2026-10-01'), 5)
  assert.equal(dagenTot('2026-10-06', '2026-10-06'), 0)
  assert.equal(isVerstreken('2026-10-06', '2026-10-06'), false)
  assert.equal(isVerstreken('2026-10-06', '2026-10-07'), true)
  assert.equal(dagenTot('2026-03-30', '2026-03-28'), 2) // over de zomertijd heen
})

test('Aftelklok eindigt om 23:59:59 Brussel (zomer- en winteruur)', () => {
  assert.equal(eindeMoment('2026-07-15'), '2026-07-15T21:59:59.000Z') // UTC+2
  assert.equal(eindeMoment('2026-12-15'), '2026-12-15T22:59:59.000Z') // UTC+1
})

test('Maandbereik voor planned_date (december → januari)', () => {
  assert.deepEqual(maandBereik('2026-10'), { van: '2026-10-01', tot: '2026-11-01' })
  assert.deepEqual(maandBereik('2026-12'), { van: '2026-12-01', tot: '2027-01-01' })
})

test('Invoer: minstens één geldige maand en een geldige datum; dubbels weg', () => {
  assert.deepEqual(valideerDeadline({ maanden: ['2026-11', '2026-10', '2026-10', 'onzin'], deadline: '2026-09-25' }), { ok: true, maanden: ['2026-10', '2026-11'], deadline: '2026-09-25' })
  assert.equal(valideerDeadline({ maanden: [], deadline: '2026-09-25' }).ok, false)
  assert.equal(valideerDeadline({ maanden: ['2026-13'], deadline: '2026-09-25' }).ok, false)
  assert.equal(valideerDeadline({ maanden: ['2026-10'], deadline: 'morgen' }).ok, false)
})

test('Tellingen: enkel "bij klant" valt onder de knop Alles goedkeuren', () => {
  assert.deepEqual(tel(['ready_for_review', 'ready_for_review', 'changes_requested', 'approved', 'scheduled', 'published', 'draft']),
    { bij_klant: 2, feedback: 1, goedgekeurd: 3, concept: 1, totaal: 7 })
})

test('Vandaag in Brussel (rond middernacht UTC)', () => {
  assert.equal(vandaagBrussel(new Date('2026-10-01T22:30:00Z')), '2026-10-02') // al 00:30 in Brussel
  assert.equal(vandaagBrussel(new Date('2026-10-01T21:30:00Z')), '2026-10-01')
})

test('Goedkeuring aanvragen: termijn in dagen → deadline (die dag telt nog mee), enkel 1 tot 60 dagen', () => {
  assert.deepEqual([...TERMIJN_KEUZES], [3, 5, 7])
  assert.equal(deadlineNaDagen('2026-10-14', 5), '2026-10-19')
  assert.equal(deadlineNaDagen('2026-12-29', 7), '2027-01-05')
  assert.equal(deadlineNaDagen('2026-03-27', 3), '2026-03-30') // over de zomertijd heen
  assert.equal(dagenTot(deadlineNaDagen('2026-10-14', 5), '2026-10-14'), 5)
  assert.equal(geldigeTermijn(5), 5); assert.equal(geldigeTermijn('7'), 7)
  for (const fout of [0, -1, 61, 2.5, '', 'vijf', null]) assert.equal(geldigeTermijn(fout), null, String(fout))
})

test('Aftelling voor de klant: altijd berekend uit vandaag, nooit een vaste tekst', () => {
  const d = '2026-10-19'
  assert.equal(aftelTekst(aftelStand(d, '2026-10-14')), 'Nog 5 dagen om goed te keuren')
  assert.equal(aftelTekst(aftelStand(d, '2026-10-17')), 'Nog 2 dagen om goed te keuren')
  assert.equal(aftelTekst(aftelStand(d, '2026-10-18')), 'Nog 1 dag om goed te keuren')
  assert.equal(aftelTekst(aftelStand(d, '2026-10-19')), 'Deadline vandaag')
  assert.equal(aftelTekst(aftelStand(d, '2026-10-20')), 'Goedkeuringstermijn verstreken')
  assert.equal(aftelTekst(aftelStand(d, '2026-10-14'), 'en'), '5 days left to approve')
  assert.equal(aftelTekst(aftelStand(d, '2026-10-21'), 'en'), 'Approval period has ended')
})

test('Mail: voornaam uit de klantgegevens en het aantal dagen uit dezelfde deadline', () => {
  assert.equal(voornaam('Odger Thewissen ', 'UMDV'), 'Odger')
  assert.equal(voornaam(null, 'Pitch Please'), 'Pitch', 'zonder contactpersoon: de bedrijfsnaam')
  assert.equal(voornaam('', '  '), '')
  assert.equal(aantalDagenTekst('2026-10-19', '2026-10-14'), '5 dagen')
  assert.equal(aantalDagenTekst('2026-10-19', '2026-10-18'), '1 dag')
  assert.equal(aantalDagenTekst('2026-10-19', '2026-10-19'), 'tot vanavond')
})

test('Template "Content klaar voor goedkeuring": de tekst van Kiara, zonder placeholders in de verstuurde mail', () => {
  const t = DEFAULT_TEMPLATES.find((x) => x.kind === 'goedkeuring_aanvraag')!
  assert.equal(t.subject, 'Content klaar voor goedkeuring')
  for (const p of ['{{voornaam}}', '{{aantal_dagen}}']) assert.ok(PLACEHOLDERS.includes(p), p)
  const vars = { voornaam: voornaam('Vera Verheyen'), aantal_dagen: aantalDagenTekst('2026-10-19', '2026-10-14'), scripts_link: 'https://app/portal/social-media' }
  const body = renderTemplate(t.body, vars)
  assert.ok(body.startsWith('Hey Vera,'))
  assert.match(body, /We hebben de content zonet ingepland in Metricool\. Je hebt nog 5 dagen om alles te bekijken en goed te keuren\./)
  assert.match(body, /Vriendelijke groeten,\nKiara\nNextGenMedia$/)
  assert.doesNotMatch(body + renderTemplate(t.subject, vars), /\{\{|\[voornaam\]|\[aantal dagen\]/)
  assert.equal(renderTemplate(t.cta_link, vars), 'https://app/portal/social-media')
})

console.log(`\n${n} tests geslaagd\n`)

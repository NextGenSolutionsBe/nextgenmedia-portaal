// Shoot planner: tijden lezen, plan opkuisen, afgeleide velden, AI-voorstel samenvoegen, kalender en mail.
//
//   npx tsx tests/shoots.test.ts

import assert from 'node:assert/strict'
import {
  tijd, normaliseerPlan, afgeleid, nogAanTeVullen, naarVoorstel, voegVoorstelSamen, maandRaster, volgendTijdstip,
  linkVerlooptOp, shootOntvangers, standaardShootKeuze, shootMail, lijstUitTekst, controleerBewaren, datumLang, LEEG_PLAN,
} from '../lib/shoots/model'
import { tekstUitDocumentXml } from '../lib/docx-lezen'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

console.log('\nShoot planner\n')

test('Tijden zoals mensen ze typen', () => {
  assert.equal(tijd('11'), '11:00')
  assert.equal(tijd('11u'), '11:00')
  assert.equal(tijd('11u30'), '11:30')
  assert.equal(tijd('9.15'), '09:15')
  assert.equal(tijd('09:00'), '09:00')
  assert.equal(tijd('14h'), '14:00')
  assert.equal(tijd('25:00'), '')
  assert.equal(tijd('morgen'), '')
  assert.equal(tijd(''), '')
})

test('Plan opkuisen: programma op uur, ongeldige mail weg, dubbele persoon weg, einde voor begin weg', () => {
  const p = normaliseerPlan({
    datum: '2026-11-28',
    programma: [
      { van: '12u30', locatie: 'Winkel', wat: 'Productshots' },
      { van: '11', tot: '10', locatie: 'Kantoor', wat: 'Interview' },
      { wat: 'Afbreken' },
      { van: '', wat: '' },
    ],
    betrokkenen: [
      { naam: 'Bram', rol: 'Regie', email: 'Bram@Voorbeeld.be' },
      { naam: 'Bram R', email: 'bram@voorbeeld.be' },
      { naam: 'Lies', email: 'geen-mail' },
    ],
    locaties: [{ adres: 'Kempische Steenweg 293, 3500 Hasselt' }],
    paklijst: '- Statief\n- Lampen\n\n',
  })
  assert.deepEqual(p.programma.map((x) => `${x.van}|${x.tot}|${x.wat}`), ['11:00||Interview', '12:30||Productshots', '||Afbreken'])
  assert.deepEqual(p.betrokkenen.map((b) => `${b.naam}|${b.email}`), ['Bram|bram@voorbeeld.be', 'Lies|'])
  assert.equal(p.locaties[0].naam, 'Kempische Steenweg 293')
  assert.deepEqual(p.paklijst, ['Statief', 'Lampen'])
  assert.equal(normaliseerPlan({ datum: '2026-02-31x' }).datum, '')
})

test('Afgeleide velden voor klantfiche en klantapp', () => {
  const p = normaliseerPlan({
    datum: '2026-11-28',
    programma: [{ van: '11:00', tot: '12:00', locatie: 'A' }, { van: '13:00', locatie: 'B' }, { van: '15:30', tot: '17:00', locatie: 'B' }],
    locaties: [{ naam: 'A', adres: 'Straat 1, Hasselt' }, { naam: 'B', adres: 'Straat 2, Genk' }],
  })
  assert.deepEqual(afgeleid(p), { start_time: '11:00', end_time: '17:00', location: 'A · B' })
  const een = normaliseerPlan({ locaties: [{ naam: 'Corda Campus', adres: 'Kempische Steenweg 293, Hasselt' }], programma: [{ van: '10:00' }] })
  assert.deepEqual(afgeleid(een), { start_time: '10:00', end_time: null, location: 'Corda Campus, Kempische Steenweg 293, Hasselt' })
  assert.deepEqual(afgeleid(LEEG_PLAN), { start_time: null, end_time: null, location: null })
})

test('Bewaren vraagt een klant en een datum; seintje voor wat nog ontbreekt', () => {
  assert.equal(controleerBewaren({ ...LEEG_PLAN, datum: '2026-11-28' }, null), 'Kies voor welke klant de shoot is.')
  assert.equal(controleerBewaren(LEEG_PLAN, 'x'), 'Kies de datum van de shoot.')
  assert.equal(controleerBewaren({ ...LEEG_PLAN, datum: '2026-11-28' }, 'x'), null)
  const p = normaliseerPlan({ programma: [{ van: '10:00', locatie: 'Loods' }], locaties: [{ naam: 'Winkel' }] })
  const nog = nogAanTeVullen(p)
  assert.ok(nog.includes('Geen adres voor Winkel'))
  assert.ok(nog.some((x) => x.includes('"Loods"')))
  assert.ok(nog.includes('Niemand met een e-mailadres om het plan naar te sturen'))
})

test('AI-antwoord lezen: locatie uit het programma komt erbij, onduidelijk apart', () => {
  const v = naarVoorstel('Hier is het plan: {"titel":"Bedrijfsvideo","datum":"2026-12-03","programma":[{"van":"9u","locatie":"Atelier","wat":"Opbouw"}],"locaties":[],"onduidelijk":["Geen adres voor het atelier"]}')
  assert.ok(v)
  assert.equal(v.plan.titel, 'Bedrijfsvideo')
  assert.equal(v.plan.datum, '2026-12-03')
  assert.equal(v.plan.programma[0].van, '09:00')
  assert.deepEqual(v.plan.locaties.map((l) => l.naam), ['Atelier'])
  assert.deepEqual(v.onduidelijk, ['Geen adres voor het atelier'])
  assert.equal(naarVoorstel('geen json'), null)
})

test('Voorstel samenvoegen: lege velden blijven, mensen worden aangevuld en nooit gewist', () => {
  const huidig = normaliseerPlan({
    titel: 'Mijn titel', datum: '2026-11-28', doel: 'Eigen doel', status: 'concept', briefing: 'ruwe tekst',
    betrokkenen: [{ naam: 'Bram', rol: '', email: '' }, { naam: 'Chiara', email: 'chiara@x.be' }],
  })
  const v = normaliseerPlan({
    titel: '', datum: '', doel: 'Nieuw doel', programma: [{ van: '10:00', wat: 'Start' }],
    betrokkenen: [{ naam: 'bram', rol: 'Regie', email: 'bram@x.be' }, { naam: 'Model', rol: 'Model' }],
  })
  const s = voegVoorstelSamen(huidig, v)
  assert.equal(s.titel, 'Mijn titel')
  assert.equal(s.datum, '2026-11-28')
  assert.equal(s.doel, 'Nieuw doel')
  assert.equal(s.status, 'concept')
  assert.equal(s.briefing, 'ruwe tekst')
  assert.equal(s.programma.length, 1)
  assert.deepEqual(s.betrokkenen.map((b) => `${b.naam}|${b.rol}|${b.email}`), ['Bram|Regie|bram@x.be', 'Chiara||chiara@x.be', 'Model|Model|'])
  // "Bram" uit de briefing = "Bram Reinquin" die er al stond; twee verschillende adressen = twee personen.
  const s2 = voegVoorstelSamen(normaliseerPlan({ betrokkenen: [{ naam: 'Bram Reinquin' }, { naam: 'Lies', email: 'lies@a.be' }] }),
    normaliseerPlan({ betrokkenen: [{ naam: 'Bram', rol: 'Regie', email: 'bram@x.be' }, { naam: 'Lies', email: 'lies@b.be' }] }))
  assert.deepEqual(s2.betrokkenen.map((b) => `${b.naam}|${b.rol}|${b.email}`), ['Bram Reinquin|Regie|bram@x.be', 'Lies||lies@a.be', 'Lies||lies@b.be'])
  // Het huidige plan zelf blijft ongewijzigd.
  assert.equal(huidig.betrokkenen[0].email, '')
})

test('Kalender: weken van maandag tot zondag, met de buurdagen', () => {
  const r = maandRaster('2026-11')
  assert.equal(r[0][0], '2026-10-26')
  assert.equal(r[r.length - 1][6], '2026-12-06')
  assert.ok(r.every((w) => w.length === 7))
  assert.equal(maandRaster('2027-02')[0][0], '2027-02-01')
})

test('Volgend tijdstip en geldigheid van de link', () => {
  assert.equal(volgendTijdstip([]), '09:00')
  assert.equal(volgendTijdstip(normaliseerPlan({ programma: [{ van: '11:00', tot: '12:15' }] }).programma), '12:15')
  assert.equal(volgendTijdstip(normaliseerPlan({ programma: [{ van: '13:30' }] }).programma), '14:30')
  const nu = new Date('2026-11-20T10:00:00Z')
  assert.equal(linkVerlooptOp('2026-12-20', nu), '2027-01-03T23:59:00.000Z')
  assert.equal(linkVerlooptOp('2026-11-01', nu), '2026-12-04T10:00:00.000Z')
})

test('Ontvangers: iedereen met een adres bij "Wie is erbij", klantadres apart en niet standaard aangevinkt', () => {
  const p = normaliseerPlan({ betrokkenen: [{ naam: 'Bram', rol: 'Regie', email: 'bram@x.be' }, { naam: 'Zonder mail' }, { naam: 'Klant', email: 'info@klant.be' }] })
  const o = shootOntvangers(p.betrokkenen, { email: 'INFO@klant.be', naam: 'Klant BV' })
  assert.deepEqual(o.map((x) => `${x.email}|${x.label}`), ['bram@x.be|Regie', 'info@klant.be|Betrokken bij de shoot'])
  const o2 = shootOntvangers(p.betrokkenen.slice(0, 2), { email: 'info@klant.be', naam: 'Klant BV' })
  assert.deepEqual(standaardShootKeuze(o2), ['bram@x.be'])
})

test('Mailtekst en datum', () => {
  assert.equal(datumLang('2026-11-28'), 'zaterdag 28 november 2026')
  const m = shootMail({ titel: 'Bedrijfsvideo', klant: 'Peeters', datum: '2026-11-28', start: '09:00', einde: '17:00', locaties: [{ id: '1', naam: 'Winkel', adres: 'Markt 1, Hasselt', contact: '', telefoon: '', notitie: '' }] })
  assert.equal(m.onderwerp, 'Shootplan: Bedrijfsvideo (28 nov)')
  assert.ok(m.tekst.startsWith('Beste [voornaam],'))
  assert.ok(m.tekst.includes('zaterdag 28 november 2026, van 09:00 tot 17:00'))
  assert.ok(m.tekst.includes('Winkel, Markt 1, Hasselt'))
  assert.deepEqual(lijstUitTekst('1. Camera\n2) Lens\n• Batterijen'), ['Camera', 'Lens', 'Batterijen'])
})

test('Word-briefing: één regel per alinea, tab en regeleinde blijven, tekens terug', () => {
  const xml = '<w:body><w:p><w:r><w:t>Shoot bij</w:t></w:r><w:r><w:t xml:space="preserve"> Peeters &amp; Zonen</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>11u</w:t><w:tab/><w:t>Winkel</w:t><w:br/><w:t>12u30</w:t></w:r></w:p><w:p></w:p><w:p><w:r><w:t>Einde</w:t></w:r></w:p></w:body>'
  assert.equal(tekstUitDocumentXml(xml), 'Shoot bij Peeters & Zonen\n11u\tWinkel\n12u30\n\nEinde')
})

console.log(`\n${n} tests geslaagd\n`)

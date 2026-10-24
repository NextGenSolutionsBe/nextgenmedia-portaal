// Klantboeking — tijdsregels, vrije momenten, ClickUp-bezet, validatie, mail.
//
//   npx tsx tests/klantboeking.test.ts

import assert from 'node:assert/strict'
import {
  startUren, kandidaatSlots, redenNietBoekbaar, vrijeSlots, perDag, clickupBezet, valideerBoeking, bevestigingsMail,
  KB_MIN_VOORAF_TEKST, vroegste, kbTitel,
} from '../lib/meetings/klantboeking'
import { uur, dag, zoneNaarIso, clickupTaakNaam } from '../lib/meetings/model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

console.log('\nKlantboeking\n')

const NU = new Date('2026-10-20T08:00:00.000Z') // dinsdag 20 okt, 10:00 in Brussel
const ms = (iso: string) => new Date(iso).getTime()
/** Werkuren ma–vr 9–17 Brussel, als segmenten voor de komende weken. */
function werkuren(vanDag: string, dagen: number): { start: number; end: number }[] {
  const uit = []
  for (let i = 0; i < dagen; i++) {
    const d = new Date(Date.UTC(+vanDag.slice(0, 4), +vanDag.slice(5, 7) - 1, +vanDag.slice(8, 10) + i)).toISOString().slice(0, 10)
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay()
    if (wd === 0 || wd === 6) continue
    uit.push({ start: ms(zoneNaarIso(d, '09:00')), end: ms(zoneNaarIso(d, '17:00')) })
  }
  return uit
}

test('1. Startuurtjes: 11:00 tot en met 16:30, nooit later', () => {
  const u = startUren()
  assert.equal(u[0], '11:00')
  assert.equal(u[u.length - 1], '16:30')
  assert.equal(u.length, 12)
  assert.ok(!u.includes('17:00'))
})

test('2. Nooit binnen 72 uur', () => {
  const k = kandidaatSlots(NU)
  assert.ok(k.length > 0)
  assert.ok(k.every((s) => ms(s) >= vroegste(NU)))
  // Vroegst: vrijdag 23 okt 10:00 → eerste kandidaat is 11:00 die dag.
  assert.equal(k[0], zoneNaarIso('2026-10-23', '11:00'))
  assert.equal(redenNietBoekbaar(zoneNaarIso('2026-10-22', '14:00'), NU), KB_MIN_VOORAF_TEKST)
})

test('3. Nooit vóór 11:00 of na 16:30 (Belgische tijd)', () => {
  const k = kandidaatSlots(NU)
  assert.ok(k.every((s) => uur(s) >= '11:00' && uur(s) <= '16:30'))
  assert.match(redenNietBoekbaar(zoneNaarIso('2026-10-27', '10:30'), NU) ?? '', /tussen 11:00 en 17:00/)
  assert.match(redenNietBoekbaar(zoneNaarIso('2026-10-27', '16:45'), NU) ?? '', /tussen 11:00 en 17:00/)
  assert.match(redenNietBoekbaar(zoneNaarIso('2026-10-27', '17:00'), NU) ?? '', /tussen 11:00 en 17:00/)
  assert.equal(redenNietBoekbaar(zoneNaarIso('2026-10-27', '16:30'), NU), null)
  assert.equal(redenNietBoekbaar(zoneNaarIso('2026-10-27', '11:00'), NU), null)
})

test('4. Een meeting van 30 minuten om 16:30 eindigt om 17:00, niet later', () => {
  const s = zoneNaarIso('2026-10-27', '16:30')
  const v = valideerBoeking({ naam: 'Jan', email: 'jan@x.be', start: s }, NU)
  assert.ok(v.ok)
  if (v.ok) assert.equal(uur(v.waarde.endsAt), '17:00')
})

test('5. Zomer- en wintertijd: 11:00 blijft 11:00 Belgische tijd', () => {
  const k = kandidaatSlots(NU, 10) // over 25 okt heen
  const voor = k.find((s) => dag(s) === '2026-10-23' && uur(s) === '11:00')!
  const na = k.find((s) => dag(s) === '2026-10-26' && uur(s) === '11:00')!
  assert.equal(voor, '2026-10-23T09:00:00.000Z') // UTC+2
  assert.equal(na, '2026-10-26T10:00:00.000Z') // UTC+1
})

test('6. Enkel binnen werkuren (geen weekend) en niet bezet', () => {
  const k = kandidaatSlots(NU, 7)
  const vrij = vrijeSlots(k, { werkuren: werkuren('2026-10-20', 14), bezet: [] })
  assert.ok(vrij.every((s) => ![0, 6].includes(new Date(s).getUTCDay())))
  // Bezet van 13:00 tot 14:00 op maandag 26 okt → 13:00 en 13:30 vallen weg, 12:30 en 14:00 blijven.
  const bezet = [{ start: ms(zoneNaarIso('2026-10-26', '13:00')), end: ms(zoneNaarIso('2026-10-26', '14:00')) }]
  const v2 = vrijeSlots(k, { werkuren: werkuren('2026-10-20', 14), bezet })
  const ma = v2.filter((s) => dag(s) === '2026-10-26').map((s) => uur(s))
  assert.ok(!ma.includes('13:00') && !ma.includes('13:30'))
  assert.ok(ma.includes('12:30') && ma.includes('14:00'))
})

test('7. Werkuren korter dan het venster: niets buiten de werkuren', () => {
  const k = kandidaatSlots(NU, 7)
  const kort = [{ start: ms(zoneNaarIso('2026-10-26', '09:00')), end: ms(zoneNaarIso('2026-10-26', '12:00')) }]
  const v = vrijeSlots(k, { werkuren: kort, bezet: [] }).map((s) => uur(s))
  assert.deepEqual(v, ['11:00', '11:30'])
})

test('8. ClickUp: enkel een meeting (start én einde met uur) blokkeert; deadline of geen uur niet', () => {
  const meeting = { id: 'm', naam: 'Meeting', startMs: ms(zoneNaarIso('2026-10-26', '14:00')), dueMs: ms(zoneNaarIso('2026-10-26', '15:00')) }
  const enkelDeadline = { id: 'd', naam: 'Deadline', startMs: null, dueMs: ms(zoneNaarIso('2026-10-27', '12:00')) }
  const zonderUur = { id: 'z', naam: 'Taak', startMs: null, dueMs: ms(zoneNaarIso('2026-10-28', '04:00')) }
  const startZonderUur = { id: 's', naam: 'Project', startMs: ms(zoneNaarIso('2026-10-29', '04:00')), dueMs: ms(zoneNaarIso('2026-10-29', '15:00')) }
  const b = clickupBezet([meeting, enkelDeadline, zonderUur, startZonderUur])
  assert.equal(b.length, 1)
  assert.deepEqual(b[0], { start: meeting.startMs, end: meeting.dueMs })
  const v = vrijeSlots(kandidaatSlots(NU, 10), { werkuren: werkuren('2026-10-20', 14), bezet: b })
  assert.ok(!v.includes(zoneNaarIso('2026-10-26', '14:30')))
  assert.ok(v.includes(zoneNaarIso('2026-10-27', '11:30')), 'een taak met enkel een deadline blokkeert niet meer')
  assert.ok(v.includes(zoneNaarIso('2026-10-28', '11:00')))
  assert.ok(v.includes(zoneNaarIso('2026-10-29', '14:30')), 'een start zonder uur maakt er geen meeting van')
})

test('9. Validatie: naam, e-mail, tijdstip', () => {
  const s = zoneNaarIso('2026-10-27', '11:00')
  assert.equal(valideerBoeking({ naam: '', email: 'jan@x.be', start: s }, NU).ok, false)
  assert.equal(valideerBoeking({ naam: 'Jan', email: 'jan@x', start: s }, NU).ok, false)
  assert.equal(valideerBoeking({ naam: 'Jan', email: 'jan@x.be', start: 'morgen' }, NU).ok, false)
  const ok = valideerBoeking({ naam: ' Jan Peeters ', email: 'Jan@X.be', bedrijf: '', reden: 'Website', start: s }, NU)
  assert.ok(ok.ok)
  if (ok.ok) { assert.equal(ok.waarde.email, 'jan@x.be'); assert.equal(ok.waarde.bedrijf, null); assert.equal(ok.waarde.reden, 'Website') }
  assert.equal(kbTitel({ naam: 'Jan', bedrijf: null }), 'Gratis kennismaking met NextGenMedia (Jan)')
})

test('10. Per dag gegroepeerd, met Nederlandse daglabels', () => {
  const g = perDag([zoneNaarIso('2026-10-27', '11:00'), zoneNaarIso('2026-10-27', '11:30'), zoneNaarIso('2026-10-28', '15:00')])
  assert.equal(g.length, 2)
  assert.equal(g[0].label, 'dinsdag 27 oktober 2026')
  assert.deepEqual(g[0].slots.map((x) => x.uur), ['11:00', '11:30'])
})

test('11. Bevestigingsmail: datum, tijd, tijdzone, duur, Meet en beheerlink', () => {
  const m = bevestigingsMail({ naam: 'Jan', startsAt: zoneNaarIso('2026-10-27', '11:00'), meetUrl: 'https://meet.google.com/abc-defg-hij', beheerUrl: 'https://app.nextgenmedia.be/boeken/beheer#t=xyz' })
  assert.equal(m.onderwerp, 'Bevestigd: meeting met NextGenMedia op di 27 okt om 11:00')
  assert.match(m.tekst, /dinsdag 27 oktober 2026 om 11:00 \(Belgische tijd\)\. Ze duurt 30 minuten/)
  assert.match(m.tekst, /meet\.google\.com\/abc-defg-hij/)
  assert.match(m.tekst, /beheer#t=xyz/)
  assert.match(bevestigingsMail({ naam: 'Jan', startsAt: zoneNaarIso('2026-10-27', '11:00'), meetUrl: null, beheerUrl: 'x', verplaatst: true }).onderwerp, /^Verplaatst:/)
})

test('12. ClickUp-taaknaam herhaalt de bedrijfsnaam niet', () => {
  const titel = kbTitel({ naam: 'Jan', bedrijf: 'Bakkerij Jan' })
  assert.equal(clickupTaakNaam({ klant_naam: 'Bakkerij Jan', titel }), 'Meeting: Gratis kennismaking met NextGenMedia (Bakkerij Jan)')
  assert.equal(clickupTaakNaam({ klant_naam: 'ERA NOBIS', titel: 'Kennismaking' }), 'Meeting: ERA NOBIS — Kennismaking')
})

console.log(`\n${n} tests geslaagd\n`)

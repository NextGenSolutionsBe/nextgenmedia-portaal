// Personeel: rechten, inklokken, planning, goedkeuring, kostenberekening en
// de koppeling met Financiën.
//
//   npx tsx tests/personeel.test.ts

import assert from 'node:assert/strict'
import {
  gewerkteMinuten, pauzeMinuten, controleerSessie, overlaptMetSessies, isVergeten, brusselNaarIso, dagBrussel, uurBrussel,
  periodeBereik, maandenIn,
} from '../lib/personeel/tijd'
import {
  normaliseerTarief, tariefOp, variabelPerUur, uurOpbouw, kostPer, sessieKost, periodeKost, planTariefwijziging, controleerTarief,
  type Tarief,
} from '../lib/personeel/kost'
import { controleerBlokken, magIntrekken, beslis, planningOverlapt, blokMinuten, maxUrenWaarschuwing } from '../lib/personeel/planning'
import { sessieVoorMedewerker, planningVoorMedewerker, bevatFinancieel, SESSIE_KOLOMMEN } from '../lib/personeel/rechten'
import { besluitBoeking, bronSleutel, boekdatum, kostNaam, verschil } from '../lib/personeel/kostenposten'
import { normaliseerMeldingInstellingen, standaardMeldingInstellingen } from '../lib/personeel/model'
import { bouwDashboard, zonderKosten } from '../lib/personeel/dashboard'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

const tarief = (over: Partial<Tarief> = {}): Tarief => normaliseerTarief({
  id: 't1', geldig_vanaf: '2026-01-01', geldig_tot: null, basis_label: 'Brutouurloon', basis_uur: 15,
  lijnen: [
    { id: 'a', label: 'Werkgeversbijdragen', soort: 'pct', waarde: 10 },
    { id: 'b', label: 'Verplaatsing', soort: 'per_dag', waarde: 8 },
    { id: 'c', label: 'Software', soort: 'per_maand', waarde: 32 },
    { id: 'd', label: 'Andere', soort: 'per_uur', waarde: 1 },
  ],
  btw_pct: 0, uren_per_dag: 8, uren_per_maand: 160, ...over,
})

console.log('\nPersoneel\n')

// ── Inklokken ──
test('1. Gewerkte duur = eind − start − pauzes', () => {
  const s = { start_at: '2026-10-12T08:00:00Z', eind_at: '2026-10-12T15:00:00Z', pauzes: [{ start: '2026-10-12T11:00:00Z', eind: '2026-10-12T11:30:00Z' }] }
  assert.equal(pauzeMinuten(s.pauzes), 30)
  assert.equal(gewerkteMinuten(s), 390)
})

test('2. Actieve sessie loopt door (tot "nu"), lopende pauze telt niet mee als werk', () => {
  const nu = new Date('2026-10-12T10:00:00Z')
  assert.equal(gewerkteMinuten({ start_at: '2026-10-12T08:00:00Z', eind_at: null, pauzes: [{ start: '2026-10-12T09:30:00Z', eind: null }] }, nu), 90)
})

test('3. Sessiecontrole: einde vóór start, te lang, pauze buiten sessie, lopende pauze', () => {
  const nu = new Date('2026-10-13T00:00:00Z')
  assert.match(controleerSessie({ start_at: '2026-10-12T10:00:00Z', eind_at: '2026-10-12T09:00:00Z' }, nu)!, /na het beginuur/)
  assert.match(controleerSessie({ start_at: '2026-10-10T10:00:00Z', eind_at: '2026-10-12T10:00:00Z' }, nu)!, /24 uur/)
  assert.match(controleerSessie({ start_at: '2026-10-12T10:00:00Z', eind_at: '2026-10-12T12:00:00Z', pauzes: [{ start: '2026-10-12T09:00:00Z', eind: '2026-10-12T09:10:00Z' }] }, nu)!, /buiten de sessie/)
  assert.match(controleerSessie({ start_at: '2026-10-12T10:00:00Z', eind_at: '2026-10-12T12:00:00Z', pauzes: [{ start: '2026-10-12T11:00:00Z', eind: null }] }, nu)!, /pauze/)
  assert.equal(controleerSessie({ start_at: '2026-10-12T10:00:00Z', eind_at: '2026-10-12T12:00:00Z' }, nu), null)
})

test('4. Geen overlappende sessies; afgekeurde tellen niet mee', () => {
  const andere = [{ id: 'x', start_at: '2026-10-12T08:00:00Z', eind_at: '2026-10-12T12:00:00Z', status: 'goedgekeurd' }]
  assert.equal(overlaptMetSessies({ start_at: '2026-10-12T11:00:00Z', eind_at: '2026-10-12T13:00:00Z' }, andere), true)
  assert.equal(overlaptMetSessies({ start_at: '2026-10-12T12:00:00Z', eind_at: '2026-10-12T13:00:00Z' }, andere), false)
  assert.equal(overlaptMetSessies({ start_at: '2026-10-12T11:00:00Z', eind_at: '2026-10-12T13:00:00Z' }, [{ ...andere[0], status: 'afgekeurd' }]), false)
})

test('5. Vergeten uit te klokken na 10 uur', () => {
  const nu = new Date('2026-10-12T20:00:00Z')
  assert.equal(isVergeten({ status: 'actief', start_at: '2026-10-12T08:00:00Z' }, 10, nu), true)
  assert.equal(isVergeten({ status: 'actief', start_at: '2026-10-12T12:00:00Z' }, 10, nu), false)
  assert.equal(isVergeten({ status: 'ingediend', start_at: '2026-10-12T08:00:00Z' }, 10, nu), false)
})

test('6. Tijdzone: Belgische muurklok ↔ UTC, ook rond zomer-/wintertijd', () => {
  assert.equal(brusselNaarIso('2026-07-01', '10:00'), '2026-07-01T08:00:00.000Z') // zomertijd UTC+2
  assert.equal(brusselNaarIso('2026-12-01', '10:00'), '2026-12-01T09:00:00.000Z') // wintertijd UTC+1
  assert.equal(dagBrussel('2026-10-12T22:30:00Z'), '2026-10-13')
  assert.equal(uurBrussel('2026-10-12T08:05:00Z'), '10:05')
})

test('7. Periodes: week begint op maandag, kwartaal en maanden', () => {
  assert.deepEqual(periodeBereik('week', '2026-10-15'), { van: '2026-10-12', tot: '2026-10-18' })
  assert.deepEqual(periodeBereik('maand', '2026-02-10'), { van: '2026-02-01', tot: '2026-02-28' })
  assert.deepEqual(periodeBereik('kwartaal', '2026-11-03'), { van: '2026-10-01', tot: '2026-12-31' })
  assert.deepEqual(maandenIn('2026-11-15', '2027-01-02'), ['2026-11', '2026-12', '2027-01'])
})

// ── Kosten ──
test('8. Kost per uur: basis + % + €/u, plus omgerekende dag- en maandkosten', () => {
  const t = tarief()
  assert.equal(variabelPerUur(t), 15 + 1.5 + 1)
  const o = uurOpbouw(t)
  assert.equal(o.perDagOmgerekend, 1)       // 8 / 8
  assert.equal(o.perMaandOmgerekend, 0.2)   // 32 / 160
  assert.equal(Math.round(o.totaal * 100) / 100, 18.7)
  assert.deepEqual(kostPer(t), { uur: 18.7, dag: 149.6, week: 748, maand: 2992 })
})

test('9. Geen vaste percentages: zonder lijnen is de kost gewoon het uurloon', () => {
  const t = tarief({ lijnen: [] })
  assert.equal(uurOpbouw(t).totaal, 15)
  assert.equal(uurOpbouw(tarief({ basis_uur: 0, lijnen: [] })).totaal, 0)
})

test('10. Periodekost: uren, per gewerkte dag, per maand, eenmalig — met toelichting', () => {
  const t = tarief({ lijnen: [...tarief().lijnen, { id: 'e', label: 'Laptop', soort: 'eenmalig', waarde: 200, datum: '2026-10-20' }] })
  const k = periodeKost([t], [{ dag: '2026-10-12', minuten: 240 }, { dag: '2026-10-12', minuten: 120 }, { dag: '2026-10-13', minuten: 300 }], { van: '2026-10-01', tot: '2026-10-31' })
  // 11 u × 17.5 = 192.5 ; 2 dagen × 8 = 16 ; 1 maand × 32 ; eenmalig 200
  assert.equal(k.uren, 11)
  assert.equal(k.dagen, 2)
  assert.equal(k.basis, 165)
  assert.equal(k.totaal, 192.5 + 16 + 32 + 200)
  assert.ok(k.regels.every((r) => r.toelichting.length > 0))
})

test('11. Tariefwijziging verandert eerdere berekeningen niet (historiek + snapshot)', () => {
  const oud = tarief({ id: 'oud', geldig_vanaf: '2026-01-01', geldig_tot: '2026-09-30' })
  const nieuw = tarief({ id: 'nieuw', geldig_vanaf: '2026-10-01', basis_uur: 20 })
  assert.equal(tariefOp([oud, nieuw], '2026-09-15')!.id, 'oud')
  assert.equal(tariefOp([oud, nieuw], '2026-10-15')!.id, 'nieuw')
  // Een goedgekeurde sessie van september houdt haar snapshotkost, ook al rekent men later opnieuw.
  const snap = sessieKost(oud, 120)
  const k = periodeKost([oud, nieuw], [{ dag: '2026-09-15', minuten: 120, vasteKost: snap.kost_bedrag }], { van: '2026-09-01', tot: '2026-09-30' })
  assert.equal(snap.kost_bedrag, 35)
  assert.equal(k.regels.find((r) => r.soort === 'snapshot')!.bedrag, 35)
})

test('12. Nieuwe tariefversie sluit de vorige af en mag de geschiedenis niet overschrijven', () => {
  const oud = tarief({ id: 'oud', geldig_vanaf: '2026-01-01' })
  const plan = planTariefwijziging([oud], '2026-10-01')
  assert.ok(plan.ok && plan.afsluiten[0].id === 'oud' && plan.afsluiten[0].geldig_tot === '2026-09-30')
  assert.equal(planTariefwijziging([oud], '2026-01-01').ok, false)
  assert.equal(planTariefwijziging([oud], '2025-12-01').ok, false)
})

test('13. Tariefcontrole: negatief, eenmalig zonder datum, onzinnig percentage', () => {
  assert.equal(controleerTarief({ geldig_vanaf: '2026-01-01', basis_uur: 12, lijnen: [] }), null)
  assert.match(controleerTarief({ geldig_vanaf: '2026-01-01', basis_uur: -1, lijnen: [] })!, /negatief/)
  assert.match(controleerTarief({ geldig_vanaf: '2026-01-01', basis_uur: 1, lijnen: [{ id: 'x', label: 'Laptop', soort: 'eenmalig', waarde: 5 }] })!, /datum/)
  assert.match(controleerTarief({ geldig_vanaf: '2026-01-01', basis_uur: 1, lijnen: [{ id: 'x', label: 'Lasten', soort: 'pct', waarde: 900 }] })!, /500%/)
})

test('14. Uren zonder tarief worden gemeld, niet stil als gratis geteld', () => {
  const k = periodeKost([], [{ dag: '2026-10-12', minuten: 60 }], { van: '2026-10-01', tot: '2026-10-31' })
  assert.equal(k.totaal, 0)
  assert.equal(k.urenZonderTarief, 1)
})

// ── Planning ──
test('15. Beschikbaarheid: blokken geldig, niet overlappend, intrekken enkel zolang ingediend', () => {
  assert.equal(controleerBlokken('2026-10-12', [{ start: '10:00', eind: '17:00' }]), null)
  assert.match(controleerBlokken('2026-10-12', [{ start: '10:00', eind: '12:00' }, { start: '11:00', eind: '13:00' }])!, /overlappen/)
  assert.match(controleerBlokken('2026-10-12', [{ start: '12:00', eind: '10:00' }])!, /na het beginuur/)
  assert.equal(magIntrekken('ingediend'), true)
  assert.equal(magIntrekken('goedgekeurd'), false)
})

test('16. Goedkeuren: volledig, gedeeltelijk (binnen het blok) of afwijzen', () => {
  const a = { status: 'ingediend', start_tijd: '10:00:00', eind_tijd: '17:00:00' }
  assert.deepEqual(beslis(a, { soort: 'goedkeuren' }), { ok: true, status: 'goedgekeurd', werkblok: { start: '10:00', eind: '17:00' } })
  assert.deepEqual(beslis(a, { soort: 'gedeeltelijk', start: '12:00', eind: '16:00' }), { ok: true, status: 'gedeeltelijk', werkblok: { start: '12:00', eind: '16:00' } })
  assert.equal(beslis(a, { soort: 'gedeeltelijk', start: '09:00', eind: '12:00' }).ok, false)
  assert.deepEqual(beslis(a, { soort: 'afwijzen' }), { ok: true, status: 'afgewezen', werkblok: null })
  assert.equal(beslis({ ...a, status: 'goedgekeurd' }, { soort: 'goedkeuren' }).ok, false)
})

test('17. Werkblokken overlappen niet; maximumuren geven een waarschuwing', () => {
  const bestaand = [{ id: 'p', datum: '2026-10-12', start_tijd: '10:00', eind_tijd: '13:00', status: 'gepland' }]
  assert.equal(planningOverlapt({ datum: '2026-10-12', start_tijd: '12:00', eind_tijd: '14:00' }, bestaand), true)
  assert.equal(planningOverlapt({ datum: '2026-10-12', start_tijd: '13:00', eind_tijd: '14:00' }, bestaand), false)
  assert.equal(planningOverlapt({ datum: '2026-10-12', start_tijd: '12:00', eind_tijd: '14:00' }, [{ ...bestaand[0], status: 'geannuleerd' }]), false)
  assert.equal(blokMinuten({ start_tijd: '10:00', eind_tijd: '17:30' }), 450)
  assert.match(maxUrenWaarschuwing({ max_uren_dag: 6 }, { dag: 420, week: 420, maand: 420 })!, /6 u per dag/)
  assert.equal(maxUrenWaarschuwing({}, { dag: 999, week: 999, maand: 999 }), null)
})

// ── Rechten ──
test('18. Werknemer krijgt nooit financiële velden of adminnotities', () => {
  const rij = { id: 's', start_at: 'x', eind_at: null, status: 'goedgekeurd', kost_per_uur: 18, kost_bedrag: 36, kost_snapshot: {}, tarief_id: 't', admin_opmerking: 'intern', verslag: { taak: 'montage' } }
  const uit = sessieVoorMedewerker(rij)!
  assert.equal(bevatFinancieel(uit), false)
  assert.deepEqual(uit.verslag, { taak: 'montage' })
  assert.equal(bevatFinancieel(rij), true)
  assert.ok(!SESSIE_KOLOMMEN.includes('kost'))
  assert.equal(bevatFinancieel(planningVoorMedewerker({ id: 'p', briefing: 'x', created_by: 'admin', bedrag: 5 })), false)
})

// ── Financiële koppeling ──
test('19. Boeken: nieuw, geen dubbele boeking, correctie met versie, intrekken', () => {
  assert.deepEqual(besluitBoeking({ totaal: 0, uren: 0 }, null), { actie: 'geen', reden: 'Geen goedgekeurde uren in deze maand.' })
  assert.deepEqual(besluitBoeking({ totaal: 350, uren: 20 }, null), { actie: 'nieuw', versie: 1, bedrag: 350, uren: 20 })
  const actueel = { id: 'k1', versie: 1, bedrag: 350, uren: 20, cost_entry_id: 'c1' }
  assert.equal(besluitBoeking({ totaal: 350, uren: 20 }, actueel).actie, 'geen')
  assert.deepEqual(besluitBoeking({ totaal: 385, uren: 22 }, actueel), { actie: 'correctie', versie: 2, bedrag: 385, uren: 22, vorigeId: 'k1', verschil: 35 })
  assert.deepEqual(besluitBoeking({ totaal: 0, uren: 0 }, actueel), { actie: 'intrekken', vorigeId: 'k1', verschil: -350 })
})

test('20. Boeksleutel, boekdatum en omschrijving; verschil planning vs werkelijkheid', () => {
  assert.equal(bronSleutel('abc', '2026-10'), 'personeel:abc:2026-10')
  assert.equal(boekdatum('2026-02'), '2026-02-28')
  assert.equal(kostNaam('Alida', '2026-10'), 'Personeel — Alida — oktober 2026')
  assert.deepEqual(verschil(400, 460), { bedrag: 60, pct: 15 })
  assert.deepEqual(verschil(0, 50), { bedrag: 50, pct: null })
})

test('21. Notificatie-instellingen: e-mail en in-app apart, veilige standaard', () => {
  const std = standaardMeldingInstellingen()
  assert.deepEqual(std.uren_goedgekeurd, { inapp: true, email: true })
  assert.deepEqual(std.beschikbaarheid_ingediend, { inapp: true, email: false })
  const n2 = normaliseerMeldingInstellingen({ uren_goedgekeurd: { inapp: false, email: false }, onzin: 1 })
  assert.deepEqual(n2.uren_goedgekeurd, { inapp: false, email: false })
  assert.deepEqual(n2.correctie_gevraagd, std.correctie_gevraagd)
})

test('22. Dashboard: werkelijk vs verwacht, te controleren, en sommen die kloppen', () => {
  const t = tarief({ lijnen: [{ id: 'b', label: 'Verplaatsing', soort: 'per_dag', waarde: 8 }] }) // 15/u + 8/dag
  const d = bouwDashboard({
    medewerkers: [{ id: 'a', naam: 'Alida', type: 'student', actief: true }],
    tarieven: new Map([['a', [t]]]),
    sessies: [
      { id: 's1', personeel_id: 'a', start_at: '2026-10-12T08:00:00Z', eind_at: '2026-10-12T12:00:00Z', pauzes: [], status: 'goedgekeurd', client_id: 'k1', project: 'Reels', kost_bedrag: 60 },
      { id: 's2', personeel_id: 'a', start_at: '2026-10-13T08:00:00Z', eind_at: '2026-10-13T10:00:00Z', pauzes: [], status: 'ingediend', client_id: 'k1', project: 'Reels', kost_bedrag: null },
      { id: 's3', personeel_id: 'a', start_at: '2026-10-14T08:00:00Z', eind_at: '2026-10-14T10:00:00Z', pauzes: [], status: 'afgekeurd', client_id: null, project: null, kost_bedrag: null },
    ],
    planning: [
      { id: 'p1', personeel_id: 'a', datum: '2026-10-12', start_tijd: '10:00', eind_tijd: '14:00', status: 'gepland', client_id: 'k1', project: 'Reels' },
      { id: 'p2', personeel_id: 'a', datum: '2026-10-20', start_tijd: '10:00', eind_tijd: '12:00', status: 'geannuleerd', client_id: null, project: null },
    ],
    periode: { van: '2026-10-01', tot: '2026-10-31' },
    klantNaam: (id) => (id === 'k1' ? 'Klant 1' : 'Geen klant'),
  })
  assert.equal(d.kaarten.gewerktUren, 6)          // afgekeurd telt niet
  assert.equal(d.kaarten.goedgekeurdUren, 4)
  assert.equal(d.kaarten.geplandUren, 4)          // geannuleerd telt niet
  assert.equal(d.kaarten.kostWerkelijk, 68)       // 60 snapshot + 8 per dag
  assert.equal(d.kaarten.kostVerwacht, 68)        // 4 u × 15 + 8
  assert.equal(d.kaarten.kostVoorlopig, 38)       // 2 u × 15 + 8 (extra dag)
  assert.equal(d.kaarten.teControlerenAantal, 1)
  const som = (rijen: { kostWerkelijk: number }[]) => Math.round(rijen.reduce((s, r) => s + r.kostWerkelijk, 0) * 100) / 100
  assert.equal(som(d.perMedewerker), 68)
  assert.equal(som(d.perProject), 68)             // incl. "vaste kosten (niet per project)"
  assert.equal(som(d.perMaand), 68)
  assert.equal(som(d.perType), 68)
  const zk = zonderKosten(d)
  assert.equal(zk.kaarten.kostWerkelijk, 0)
  assert.ok(zk.perProject.every((r) => r.kostWerkelijk === 0 && r.sleutel !== '__vast__'))
})

console.log(`\n${n} tests geslaagd\n`)

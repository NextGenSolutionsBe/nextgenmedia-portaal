// Nieuwe werking fase 3: auditrapport en prijs per workflow.
//   npx tsx tests/ngs-audit.test.ts
import assert from 'node:assert/strict'
import {
  leesBetrokkenen, urenPerWeek, maatVan, prijsUitFormule, prijsAndereWaarde, binnenVork, controleerPrijs, voorstelVoor, workflowUren,
  waaromNietApart, waaromNietAfronden, terugverdienMaanden, klantWorkflow, gemiddeldBespaard, leesRapportVoorstel, type Workflow, type Proces,
} from '../lib/ngs/audit'
import { STANDAARD_WERKING } from '../lib/werking/instellingen'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const P = STANDAARD_WERKING.prijzen
const wf = (id: string, extra: Partial<Workflow> = {}): Workflow => ({ id, naam: `W${id}`, oplossing: 'Een dashboard met logboek', soort: 'tijd', geschatte_uren: null, marktcheck: null, interface_of_logboek: true, maat: null, prijs: null, prijs_reden: null, volgorde: 0, ...extra })
const pr = (id: string, uren: number, w: string | null): Proces => ({ id, naam: `P${id}`, betrokkenen: [{ naam: 'Boekhouding', uren }], uren_per_week: uren, notitie: null, workflow_id: w, volgorde: 0 })

test('uren per proces: opgeteld over wie het aanraakt', () => {
  const b = leesBetrokkenen([{ naam: 'Sales', uren: '2,5' }, { naam: 'Admin', uren: 1.5 }, { naam: '', uren: 3 }, { naam: 'Te veel', uren: 99 }])
  assert.deepEqual(b, [{ naam: 'Sales', uren: 2.5 }, { naam: 'Admin', uren: 1.5 }])
  assert.equal(urenPerWeek(b), 4)
})

test('rapport van drie processen: juiste maten en prijzen', () => {
  // 4 u = Klein (4 × 24 × € 35 = € 3.360 → € 3.350), 7 u = Middel (€ 5.880 → € 5.900), 12 u = Groot (€ 10.080 → € 10.100).
  const uren = [4, 7, 12]
  assert.deepEqual(uren.map((u) => maatVan(u, P)), ['klein', 'middel', 'groot'])
  assert.deepEqual(uren.map((u) => prijsUitFormule(u, P)), [3350, 5900, 10100])
  assert.equal(maatVan(5, P), 'middel')
  assert.equal(maatVan(10, P), 'middel')
  assert.equal(maatVan(10.5, P), 'groot')
  assert.equal(maatVan(3, P), 'klein')
  // De grenzen van de formule vallen samen met de vorken: 3 u ≈ € 2.500, 5 u = € 4.200, 10 u = € 8.400.
  assert.ok(binnenVork('klein', prijsUitFormule(3, P), P))
  assert.equal(prijsUitFormule(5, P), 4200)
  assert.equal(prijsUitFormule(10, P), 8400)
})

test('onder 3 uur: geen maat en niet apart te bewaren', () => {
  assert.equal(maatVan(2.5, P), null)
  assert.equal(voorstelVoor({ soort: 'tijd', geschatte_uren: null }, 2, P).prijs, null)
  assert.ok(waaromNietApart({ soort: 'tijd' }, 2, P)?.includes('bundel'))
  assert.equal(waaromNietApart({ soort: 'tijd' }, 3, P), null)
  assert.equal(waaromNietApart({ soort: 'andere_waarde' }, 0, P), null)
})

test('prijs buiten de vork enkel met een reden van tien tekens', () => {
  assert.equal(controleerPrijs('klein', 3000, '', P).ok, true)
  const c = controleerPrijs('klein', 5000, 'te kort', P)
  assert.equal(c.ok, false)
  const ok = controleerPrijs('klein', 5000, 'Complexe koppeling met hun ERP', P)
  assert.ok(ok.ok && ok.reden === 'Complexe koppeling met hun ERP')
  assert.equal(controleerPrijs('groot', 50000, '', P).ok, true) // geen maximum
  assert.equal(controleerPrijs('klein', 0, '', P).ok, false)
})

test('andere waarde: geschatte uren × € 125', () => {
  assert.equal(prijsAndereWaarde(20, P), 2500)
  assert.deepEqual(voorstelVoor({ soort: 'andere_waarde', geschatte_uren: 30 }, 0, P), { maat: null, prijs: 3750 })
})

test('bundelen: uren van een workflow = som van zijn processen', () => {
  const p = [pr('a', 2, 'w1'), pr('b', 1.5, 'w1'), pr('c', 6, 'w2')]
  assert.equal(workflowUren({ id: 'w1' }, p), 3.5)
  assert.equal(maatVan(workflowUren({ id: 'w1' }, p), P), 'klein')
})

test('rapport afronden: alles met prijs, minimum en interface of logboek', () => {
  const w1 = wf('w1', { prijs: 3350, maat: 'klein' }), w2 = wf('w2', { prijs: 5900, maat: 'middel' })
  assert.equal(waaromNietAfronden([w1, w2], [pr('a', 4, 'w1'), pr('b', 7, 'w2')], P), null)
  assert.ok(waaromNietAfronden([w1], [pr('a', 4, 'w1'), pr('x', 1, null)], P)?.includes('geen workflow'))
  assert.ok(waaromNietAfronden([wf('w1', { prijs: 3350, interface_of_logboek: false })], [pr('a', 4, 'w1')], P)?.includes('interface'))
  assert.ok(waaromNietAfronden([wf('w1', { prijs: 3350 })], [pr('a', 2, 'w1')], P)?.includes('bundel'))
  assert.ok(waaromNietAfronden([], [], P))
})

test('wat de klant ziet: nooit de formule, de uurwaarde of de uurprijs', () => {
  const w = wf('w1', { prijs: 3350, maat: 'klein' })
  const k = klantWorkflow(w, [pr('a', 4, 'w1')], P)
  assert.deepEqual(Object.keys(k).sort(), ['andere_waarde', 'maat', 'naam', 'oplossing', 'prijs', 'terugverdientijd_maanden', 'uren_per_week'].sort())
  const tekst = JSON.stringify(k)
  for (const verboden of ['uurwaarde', 'weken', 'andere_uurprijs', 'prijs_reden', 'marktcheck', 'betrokkenen']) assert.ok(!tekst.includes(verboden), verboden)
  assert.equal(k.uren_per_week, 4)
  assert.equal(terugverdienMaanden(3350, 4, w, P), 5.5) // 3350 / (4 × 35 × 52/12)
  assert.equal(klantWorkflow(wf('w2', { soort: 'andere_waarde', prijs: 2500 }), [], P).terugverdientijd_maanden, null)
})

test('gemiddeld bespaard per workflow en het voorstel van de AI', () => {
  assert.deepEqual(gemiddeldBespaard([{ uren: 4 }, { uren: 7 }, { uren: 0 }]), { aantal: 2, gemiddeld: 5.5 })
  assert.deepEqual(gemiddeldBespaard([]), { aantal: 0, gemiddeld: null })
  const v = leesRapportVoorstel('ok {"processen":[{"naam":"Offertes","betrokkenen":[{"naam":"Sales","uren":4}],"oplossing":"Generator met logboek"},{"naam":""}]}')
  assert.deepEqual(v, [{ naam: 'Offertes', betrokkenen: [{ naam: 'Sales', uren: 4 }], oplossing: 'Generator met logboek' }])
  assert.equal(leesRapportVoorstel('geen json'), null)
})

console.log(`\n${n} tests geslaagd`)

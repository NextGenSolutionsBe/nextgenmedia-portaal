// Uitgaven vennoten: invoer, periodes, budget en tegoed (sparen), regels.
// Uitvoeren: npx tsx tests/vennoot-uitgaven.test.ts
import assert from 'node:assert/strict'
import {
  controleerUitgave, controleerReden, periodeVan, verschuif, maandenTussen, budgetVan, standPerVennoot, uitgavenIn,
  controleerRegels, regelsTekst, tekenStand, type Uitgave, type RegelsVersie,
} from '../lib/vennoot-uitgaven'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nUitgaven vennoten\n')

const u = (vennoot: Uitgave['vennoot'], datum: string, bedrag: number, extra: Partial<Uitgave> = {}): Uitgave => ({
  id: `${vennoot}-${datum}-${bedrag}`, vennoot, datum, omschrijving: 'x', doel: null, bedrag, bewijs_pad: null, bewijs_naam: null,
  gearchiveerd_op: null, gearchiveerd_door: null, archief_reden: null, created_at: null, created_by: null, ...extra,
})

test('Invoer: vennoot, datum (niet in de toekomst), wat en bedrag verplicht', () => {
  const ok = controleerUitgave({ vennoot: 'bram', datum: '2026-11-08', omschrijving: '  Fiets  naar het werk ', doel: 'Woon-werk', bedrag: '1.249,99' }, '2026-11-09')
  assert.ok(ok.ok)
  if (ok.ok) assert.deepEqual(ok.waarde, { vennoot: 'bram', datum: '2026-11-08', omschrijving: 'Fiets naar het werk', doel: 'Woon-werk', bedrag: 1249.99 })
  assert.equal(controleerUitgave({ vennoot: 'jan', datum: '2026-11-08', omschrijving: 'x', bedrag: 5 }, '2026-11-09').ok, false)
  assert.equal(controleerUitgave({ vennoot: 'marco', datum: '2026-11-10', omschrijving: 'Broodje', bedrag: 5 }, '2026-11-09').ok, false, 'toekomst')
  assert.equal(controleerUitgave({ vennoot: 'marco', datum: '2026-11-09', omschrijving: 'Broodje', bedrag: 0 }, '2026-11-09').ok, false)
  assert.equal(controleerUitgave({ vennoot: 'marco', datum: '2026-11-09', omschrijving: '', bedrag: 5 }, '2026-11-09').ok, false)
  assert.equal(controleerReden('  '), null)
  assert.equal(controleerReden('Verworpen uitgave'), 'Verworpen uitgave')
})

test('Periodes: maand, kwartaal, jaar en verschuiven over de jaarwissel', () => {
  assert.deepEqual(periodeVan('maand', '2026-11'), { soort: 'maand', ref: '2026-11', van: '2026-11-01', tot: '2026-11-30', maanden: ['2026-11'], label: 'november 2026' })
  const q = periodeVan('kwartaal', '2026-11')
  assert.equal(q.label, 'Q4 2026'); assert.equal(q.van, '2026-10-01'); assert.equal(q.tot, '2026-12-31')
  assert.equal(periodeVan('jaar', '2026-11').label, '2026')
  assert.equal(periodeVan('maand', '2028-02').tot, '2028-02-29', 'schrikkeljaar')
  assert.equal(verschuif(periodeVan('maand', '2026-12'), 1).ref, '2027-01')
  assert.equal(verschuif(periodeVan('kwartaal', '2027-02'), -1).label, 'Q4 2026')
  assert.equal(verschuif(periodeVan('jaar', '2026-11'), 1).label, '2027')
  assert.equal(maandenTussen('2026-11', '2027-02'), 4)
  assert.equal(maandenTussen('2027-01', '2026-11'), 0)
})

test('Sparen: wat je niet gebruikt, blijft staan; wie te veel uitgeeft, staat in het rood', () => {
  const budget = { maandbudget: 250, start_maand: '2026-09' }
  const lijst = [
    u('bram', '2026-09-05', 600),            // fiets: meer dan één maand
    u('marco', '2026-10-12', 12.5),          // broodje
    u('marco', '2026-11-03', 40),
    u('chiara', '2026-11-04', 80, { gearchiveerd_op: '2026-11-05T10:00:00Z', archief_reden: 'Verworpen uitgave' }),
  ]
  const s = standPerVennoot(lijst, budget, periodeVan('maand', '2026-11'), '2026-11')
  const bram = s.find((x) => x.vennoot === 'bram')!, marco = s.find((x) => x.vennoot === 'marco')!, chiara = s.find((x) => x.vennoot === 'chiara')!
  assert.equal(bram.budgetTotaal, 750, 'sept, okt en nov')
  assert.equal(bram.tegoed, 150)
  assert.equal(bram.besteedPeriode, 0)
  assert.equal(marco.tegoed, 697.5)
  assert.equal(marco.besteedPeriode, 40)
  assert.equal(marco.budgetPeriode, 250)
  assert.equal(chiara.tegoed, 750, 'gearchiveerd telt niet mee')
  // Over het jaar: enkel de maanden vanaf de start en tot nu geven budget.
  const jaar = standPerVennoot(lijst, budget, periodeVan('jaar', '2026-11'), '2026-11')
  assert.equal(jaar[0].budgetPeriode, 750)
  // Te veel uitgegeven = negatief tegoed.
  const rood = standPerVennoot([u('bram', '2026-11-01', 1000)], { maandbudget: 250, start_maand: '2026-11' }, periodeVan('maand', '2026-11'), '2026-11')
  assert.equal(rood.find((x) => x.vennoot === 'bram')!.tegoed, -750)
})

test('Zonder regels: € 250 vanaf de eerste uitgave (of deze maand)', () => {
  assert.deepEqual(budgetVan(null, [], '2026-11'), { maandbudget: 250, start_maand: '2026-11' })
  assert.deepEqual(budgetVan(null, [{ datum: '2026-10-20' }], '2026-11'), { maandbudget: 250, start_maand: '2026-10' })
  assert.deepEqual(budgetVan({ maandbudget: 300, start_maand: '2026-12' }, [], '2026-11'), { maandbudget: 300, start_maand: '2026-12' })
})

test('Lijst: periode, vennoot, archief apart, nieuwste eerst', () => {
  const lijst = [u('bram', '2026-11-01', 5), u('bram', '2026-11-20', 7), u('marco', '2026-11-10', 9), u('bram', '2026-10-31', 3), u('bram', '2026-11-15', 4, { gearchiveerd_op: 'x' })]
  assert.deepEqual(uitgavenIn(lijst, periodeVan('maand', '2026-11'), 'bram', false).map((x) => x.bedrag), [7, 5])
  assert.deepEqual(uitgavenIn(lijst, null, 'bram', true).map((x) => x.bedrag), [4])
  assert.equal(uitgavenIn(lijst, periodeVan('maand', '2026-11'), null, false).length, 3)
})

test('Regels: opgekuist, met budget en start; de getekende tekst bevat alles', () => {
  const r = controleerRegels({ regels: '1. Max 250 per maand\n\n- Bonnetje bij elke uitgave\n', maandbudget: '250', start_maand: '2026-11' })
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.waarde.regels, ['Max 250 per maand', 'Bonnetje bij elke uitgave'])
  assert.equal(controleerRegels({ regels: '', maandbudget: 250, start_maand: '2026-11' }).ok, false)
  assert.equal(controleerRegels({ regels: 'a', maandbudget: -1, start_maand: '2026-11' }).ok, false)
  assert.equal(controleerRegels({ regels: 'a', maandbudget: 250, start_maand: '2026-13' }).ok, false)
  const v: RegelsVersie = { id: 'r1', versie: 2, regels: ['A', 'B'], maandbudget: 250, start_maand: '2026-11', created_at: null, created_by: null }
  const tekst = regelsTekst(v)
  assert.match(tekst, /versie 2/); assert.match(tekst, /EUR 250\.00/); assert.match(tekst, /2026-11/); assert.match(tekst, /2\. B/)
})

test('Tekenen: enkel een handtekening op exact deze versie telt; aanpassen = opnieuw tekenen', () => {
  const v1: RegelsVersie = { id: 'r1', versie: 1, regels: ['A'], maandbudget: 250, start_maand: '2026-11', created_at: null, created_by: null }
  const v2: RegelsVersie = { ...v1, id: 'r2', versie: 2, regels: ['A', 'B'] }
  const h = [
    { vennoot: 'bram' as const, naam: 'Bram', getekend_op: 'x', inhoud_tekst: regelsTekst(v1) },
    { vennoot: 'marco' as const, naam: 'Marco', getekend_op: 'x', inhoud_tekst: regelsTekst(v2) },
  ]
  const s1 = tekenStand(v1, h)
  assert.ok(s1.bram); assert.equal(s1.marco, null); assert.equal(s1.allen, false)
  const s2 = tekenStand(v2, [...h, { vennoot: 'bram', naam: 'Bram', getekend_op: 'y', inhoud_tekst: regelsTekst(v2) }, { vennoot: 'chiara', naam: 'Chiara', getekend_op: 'y', inhoud_tekst: regelsTekst(v2) }])
  assert.equal(s2.allen, true)
  assert.equal(tekenStand(null, h).allen, false)
})

console.log(`\n${n} tests geslaagd\n`)

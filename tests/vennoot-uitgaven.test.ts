// Uitgaven vennoten: invoer, periodes, budget en tegoed (sparen), regels.
// Uitvoeren: npx tsx tests/vennoot-uitgaven.test.ts
import assert from 'node:assert/strict'
import {
  regelsVerschil,
  controleerUitgave, controleerReden, periodeVan, verschuif, maandenTussen, budgetVan, standPerVennoot, uitgavenIn,
  controleerRegels, regelsTekst, tekenStand, perMaand, periodeOpties, type Uitgave, type RegelsVersie,
  controleerExtra, extraTekst, extraStand, extraTelt, controleerTerugkerend, terugkerendTekst, terugkerendStand, betaaldata,
  volgendeBetaling, terugkerendeUitgaven, isLopend, openAkkoorden, openAkkoordenTekst, namenLijst,
  type BudgetExtra, type ExtraAkkoord, type Terugkerend, type TerugkerendAkkoord,
  gelijkVerdeeld, delenVan, deelVan, wieBetrokken, uitgaveTekst, leesBonVoorstel,
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

test('Regelsviewer: wat is nieuw of weg tegenover de vorige versie', () => {
  const v1 = { regels: ['Max 250 per maand', 'Altijd een bon'], maandbudget: 250, start_maand: '2026-11' }
  const v2 = { regels: ['Max 250 per maand', 'Bon binnen de week', 'Altijd een bon'], maandbudget: 300, start_maand: '2026-11' }
  const d = regelsVerschil(v2, v1)
  assert.deepEqual(d.nieuw, [false, true, false])
  assert.deepEqual(d.weg, [])
  assert.equal(d.budget, true)
  assert.equal(d.start, false)
  assert.deepEqual(regelsVerschil(v1, v2).weg, ['Bon binnen de week'])
  assert.deepEqual(regelsVerschil(v1, null).nieuw, [false, false])
})

test('Per maand groeperen: nieuwste maand eerst, met het totaal', () => {
  const mk = (id: string, datum: string, bedrag: number) => ({ id, vennoot: 'bram', datum, omschrijving: 'x', doel: null, bedrag, bewijs_pad: null, bewijs_naam: null, gearchiveerd_op: null, gearchiveerd_door: null, archief_reden: null, created_at: null, created_by: null }) as Uitgave
  const g = perMaand([mk('a', '2026-11-21', 22.9), mk('b', '2026-10-03', 18.5), mk('c', '2026-11-02', 10.1)])
  assert.deepEqual(g.map((x) => `${x.label}|${x.uitgaven.length}|${x.totaal}`), ['november 2026|2|33', 'oktober 2026|1|18.5'])
  assert.deepEqual(perMaand([]), [])
})

test('Periodes om uit te kiezen: van de eerste uitgave tot nu, nieuwste eerst', () => {
  assert.deepEqual(periodeOpties('maand', '2026-08', '2026-11').map((p) => p.label), ['november 2026', 'oktober 2026', 'september 2026', 'augustus 2026'])
  assert.deepEqual(periodeOpties('kwartaal', '2026-02', '2026-11').map((p) => p.label), ['Q4 2026', 'Q3 2026', 'Q2 2026', 'Q1 2026'])
  assert.deepEqual(periodeOpties('jaar', '2025-12', '2026-11').map((p) => p.label), ['2026', '2025'])
  assert.deepEqual(periodeOpties('maand', null, '2026-11').map((p) => p.label), ['november 2026'])
})

// ── Extra budget ───────────────────────────────────────────────────────────

const ex = (extra: Partial<BudgetExtra> = {}): BudgetExtra => ({
  id: 'e1', vennoten: ['marco'], maand: '2026-11', bedrag: 200, reden: 'Klantbezoeken in Antwerpen deze maand',
  gearchiveerd_op: null, gearchiveerd_door: null, archief_reden: null, created_at: null, created_by: null, ...extra,
})
const akE = (e: BudgetExtra, wie: ExtraAkkoord['vennoot'][]): ExtraAkkoord[] =>
  wie.map((v) => ({ extra_id: e.id, vennoot: v, naam: v, akkoord_op: '2026-11-20T10:00:00Z', inhoud_tekst: extraTekst(e) }))

test('Extra budget: voor wie, maand, bedrag en een onderbouwing verplicht', () => {
  const ok = controleerExtra({ vennoten: ['chiara', 'marco', 'jan'], maand: '2026-05', bedrag: '500', reden: '  Alle drie  extra voor de teamdag ' })
  assert.ok(ok.ok)
  if (ok.ok) assert.deepEqual(ok.waarde, { vennoten: ['marco', 'chiara'], maand: '2026-05', bedrag: 500, reden: 'Alle drie extra voor de teamdag' })
  assert.equal(controleerExtra({ vennoten: [], maand: '2026-05', bedrag: 500, reden: 'Een goede reden hier' }).ok, false)
  assert.equal(controleerExtra({ vennoten: ['bram'], maand: '2026-5', bedrag: 500, reden: 'Een goede reden hier' }).ok, false)
  assert.equal(controleerExtra({ vennoten: ['bram'], maand: '2026-05', bedrag: 0, reden: 'Een goede reden hier' }).ok, false)
  assert.equal(controleerExtra({ vennoten: ['bram'], maand: '2026-05', bedrag: 200, reden: 'kort' }).ok, false, 'reden te kort')
})

test('Extra budget telt pas als alle drie akkoord gaven, en enkel voor wie het geldt', () => {
  const budget = { maandbudget: 250, start_maand: '2026-11' }
  const per = periodeVan('maand', '2026-11')
  const e = ex()
  const zonder = standPerVennoot([], budget, per, '2026-11', [e], akE(e, ['marco', 'bram']))
  assert.equal(zonder.find((s) => s.vennoot === 'marco')!.tegoed, 250, 'twee van de drie: telt nog niet')
  const met = standPerVennoot([], budget, per, '2026-11', [e], akE(e, ['marco', 'bram', 'chiara']))
  const m = met.find((s) => s.vennoot === 'marco')!
  assert.equal(m.tegoed, 450)
  assert.equal(m.budgetPeriode, 450)
  assert.equal(m.extraPeriode, 200)
  assert.equal(met.find((s) => s.vennoot === 'bram')!.tegoed, 250, 'Bram krijgt niets extra')
  // Aangepast na het akkoord: telt niet meer tot iedereen opnieuw akkoord gaf.
  const aangepast = { ...e, bedrag: 300 }
  assert.equal(extraTelt(aangepast, akE(e, ['marco', 'bram', 'chiara'])), false)
  assert.equal(extraStand(aangepast, akE(e, ['marco', 'bram', 'chiara'])).aangepast, true)
  // Geschrapt telt nooit.
  assert.equal(extraTelt({ ...e, gearchiveerd_op: '2026-11-21T00:00:00Z' }, akE(e, ['marco', 'bram', 'chiara'])), false)
})

test('Extra budget voor een latere maand telt pas vanaf die maand; in het jaar zit het mee', () => {
  const budget = { maandbudget: 250, start_maand: '2026-01' }
  const mei = ex({ id: 'mei', vennoten: ['marco', 'bram', 'chiara'], maand: '2026-05', bedrag: 500 })
  const dec = ex({ id: 'dec', vennoten: ['bram'], maand: '2026-12', bedrag: 200 })
  const ak = [...akE(mei, ['marco', 'bram', 'chiara']), ...akE(dec, ['marco', 'bram', 'chiara'])]
  const jaar = standPerVennoot([], budget, periodeVan('jaar', '2026-11'), '2026-11', [mei, dec], ak)
  const b = jaar.find((s) => s.vennoot === 'bram')!
  assert.equal(b.budgetTotaal, 250 * 11 + 500, 'december nog niet')
  assert.equal(b.budgetPeriode, 250 * 11 + 500)
  const nov = standPerVennoot([], budget, periodeVan('maand', '2026-11'), '2026-11', [mei, dec], ak).find((s) => s.vennoot === 'bram')!
  assert.equal(nov.budgetPeriode, 250, 'november heeft geen extra')
  assert.equal(nov.tegoed, 250 * 11 + 500, 'het gespaarde tegoed bevat mei')
})

// ── Terugkerende uitgaven ──────────────────────────────────────────────────

const tk = (extra: Partial<Terugkerend> = {}): Terugkerend => ({
  id: 't1', vennoot: 'marco', omschrijving: 'Lease wagen', doel: 'Klantbezoeken', bedrag: 450, frequentie: 'maand',
  start_datum: '2026-08-31', eind_datum: null, bewijs_pad: null, bewijs_naam: null,
  gearchiveerd_op: null, gearchiveerd_door: null, archief_reden: null, created_at: null, created_by: null, ...extra,
})

test('Terugkerend: invoer met hoe vaak, eerste betaling en optioneel een einde', () => {
  const ok = controleerTerugkerend({ vennoot: 'marco', omschrijving: ' Lease  wagen ', doel: '', bedrag: '450,00', frequentie: 'maand', start_datum: '2026-09-01', eind_datum: '' })
  assert.ok(ok.ok)
  if (ok.ok) assert.deepEqual(ok.waarde, { vennoot: 'marco', omschrijving: 'Lease wagen', doel: null, bedrag: 450, frequentie: 'maand', start_datum: '2026-09-01', eind_datum: null })
  assert.equal(controleerTerugkerend({ vennoot: 'marco', omschrijving: 'Lease', bedrag: 450, frequentie: 'week', start_datum: '2026-09-01' }).ok, false)
  assert.equal(controleerTerugkerend({ vennoot: 'marco', omschrijving: 'Lease', bedrag: 450, frequentie: 'maand', start_datum: '2026-09-01', eind_datum: '2026-08-01' }).ok, false, 'einde vóór start')
  assert.equal(controleerTerugkerend({ vennoot: 'marco', omschrijving: 'Lease', bedrag: 450, frequentie: 'maand', start_datum: '2026-02-30' }).ok, false, 'bestaat niet')
})

test('Betaaldata: zelfde dag elke maand, of de laatste dag als die dag niet bestaat', () => {
  assert.deepEqual(betaaldata(tk(), '2026-11-22'), ['2026-08-31', '2026-09-30', '2026-10-31'])
  assert.deepEqual(betaaldata(tk({ frequentie: 'kwartaal', start_datum: '2026-01-15' }), '2026-11-22'), ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'])
  assert.deepEqual(betaaldata(tk({ frequentie: 'jaar', start_datum: '2024-02-29' }), '2026-11-22'), ['2024-02-29', '2025-02-28', '2026-02-28'])
  assert.deepEqual(betaaldata(tk({ start_datum: '2026-10-01', eind_datum: '2026-10-31' }), '2026-11-22'), ['2026-10-01'], 'gestopt')
  assert.deepEqual(betaaldata(tk({ start_datum: '2026-12-01' }), '2026-11-22'), [], 'start later')
  assert.equal(volgendeBetaling(tk(), '2026-11-22'), '2026-11-30')
  assert.equal(volgendeBetaling(tk({ start_datum: '2026-10-01', eind_datum: '2026-10-31' }), '2026-11-22'), null)
  assert.equal(isLopend(tk({ eind_datum: '2026-11-21' }), '2026-11-22'), false)
  assert.equal(isLopend(tk(), '2026-11-22'), true)
})

test('Elke betaling tot vandaag telt als uitgave van die vennoot; geschrapt telt niet', () => {
  const lijst = terugkerendeUitgaven([tk(), tk({ id: 't2', gearchiveerd_op: '2026-11-01T00:00:00Z' })], '2026-11-22')
  assert.equal(lijst.length, 3)
  assert.deepEqual(lijst.map((x) => x.id), ['t:t1:2026-08-31', 't:t1:2026-09-30', 't:t1:2026-10-31'])
  assert.equal(lijst[0].terugkerend_id, 't1')
  const s = standPerVennoot(lijst, { maandbudget: 250, start_maand: '2026-08' }, periodeVan('maand', '2026-10'), '2026-11')
  const m = s.find((x) => x.vennoot === 'marco')!
  assert.equal(m.besteedPeriode, 450)
  assert.equal(m.besteedTotaal, 1350)
  assert.equal(m.tegoed, 1000 - 1350)
  assert.equal(perMaand(lijst)[0].label, 'oktober 2026')
})

test('Akkoord op een terugkerende uitgave hoort bij exact de afspraak', () => {
  const t = tk()
  const ak: TerugkerendAkkoord[] = (['marco', 'bram', 'chiara'] as const).map((v) => ({ terugkerend_id: 't1', vennoot: v, naam: v, akkoord_op: 'x', inhoud_tekst: terugkerendTekst(t) }))
  assert.equal(terugkerendStand(t, ak).allen, true)
  const hoger = { ...t, bedrag: 500 }
  assert.equal(terugkerendStand(hoger, ak).allen, false)
  assert.equal(terugkerendStand(hoger, ak).aangepast, true)
  assert.ok(terugkerendTekst(t).includes('450.00 per maand'))
})

test('Wat wacht op jou: uitgaven, extra budget en terugkerende samen', () => {
  const e = ex()
  const t = tk()
  const o = openAkkoorden({ uitgaven: [], akkoorden: [], extras: [e, ex({ id: 'weg', gearchiveerd_op: 'x' })], extraAkkoorden: akE(e, ['marco']), terugkerend: [t], terugkerendAkkoorden: [] }, 'bram')
  assert.equal(o.extras.length, 1)
  assert.equal(o.terugkerend.length, 1)
  assert.equal(o.totaal, 2)
  assert.equal(openAkkoordenTekst(o), '1 keer extra budget en 1 terugkerende uitgave')
  assert.equal(openAkkoorden({ uitgaven: [], akkoorden: [], extras: [e], extraAkkoorden: akE(e, ['marco']) }, 'marco').totaal, 0)
  assert.equal(namenLijst(['Marco', 'Bram', 'Chiara']), 'Marco, Bram en Chiara')
})

// ── Eén bonnetje, meerdere vennoten ────────────────────────────────────────

test('Verdelen: gelijk tot op de cent, of zelf gekozen delen die samen het totaal zijn', () => {
  assert.deepEqual(gelijkVerdeeld(50, ['chiara', 'bram']), { bram: 25, chiara: 25 })
  assert.deepEqual(gelijkVerdeeld(10, ['marco', 'bram', 'chiara']), { marco: 3.34, bram: 3.33, chiara: 3.33 })
  const gelijk = controleerUitgave({ vennoten: ['chiara', 'bram'], datum: '2026-11-20', omschrijving: 'Lunch', bedrag: '50' }, '2026-11-22')
  assert.ok(gelijk.ok)
  if (gelijk.ok) { assert.equal(gelijk.waarde.vennoot, 'bram'); assert.deepEqual(gelijk.waarde.verdeling, { bram: 25, chiara: 25 }) }
  const zelf = controleerUitgave({ vennoten: ['bram', 'chiara'], datum: '2026-11-20', omschrijving: 'Lunch', bedrag: '50', verdeling: { bram: '30', chiara: '20' } }, '2026-11-22')
  assert.ok(zelf.ok)
  if (zelf.ok) assert.deepEqual(zelf.waarde.verdeling, { bram: 30, chiara: 20 })
  assert.equal(controleerUitgave({ vennoten: ['bram', 'chiara'], datum: '2026-11-20', omschrijving: 'Lunch', bedrag: '50', verdeling: { bram: '30', chiara: '10' } }, '2026-11-22').ok, false, 'som klopt niet')
  // Eén vennoot via de lijst = gewone uitgave, zonder verdeling.
  const een = controleerUitgave({ vennoten: ['marco'], datum: '2026-11-20', omschrijving: 'Broodje', bedrag: 5 }, '2026-11-22')
  assert.ok(een.ok && !('verdeling' in een.waarde))
})

test('Een verdeelde uitgave telt bij elke vennoot voor zijn deel', () => {
  const gedeeld = u('chiara', '2026-11-20', 50, { id: 'g1', vennoot: 'bram', verdeling: { bram: 25, chiara: 25 } })
  assert.deepEqual(delenVan(gedeeld), [{ vennoot: 'bram', bedrag: 25 }, { vennoot: 'chiara', bedrag: 25 }])
  assert.deepEqual(wieBetrokken(gedeeld), ['bram', 'chiara'])
  assert.equal(deelVan(gedeeld, 'marco'), 0)
  const s = standPerVennoot([gedeeld], { maandbudget: 250, start_maand: '2026-11' }, periodeVan('maand', '2026-11'), '2026-11')
  assert.deepEqual(s.map((x) => `${x.vennoot}:${x.besteedPeriode}:${x.tegoed}:${x.aantalPeriode}`), ['marco:0:250:0', 'bram:25:225:1', 'chiara:25:225:1'])
  assert.equal(uitgavenIn([gedeeld], null, 'chiara', false).length, 1)
  assert.equal(uitgavenIn([gedeeld], null, 'marco', false).length, 0)
  assert.equal(perMaand([gedeeld], 'chiara')[0].totaal, 25)
  assert.equal(perMaand([gedeeld])[0].totaal, 50)
})

test('Akkoordtekst: een gewone uitgave blijft exact dezelfde tekst, een verdeelde zegt wie wat draagt', () => {
  const gewoon = u('bram', '2026-11-08', 12.5, { id: 'x1', bewijs_pad: null })
  assert.equal(uitgaveTekst(gewoon), 'Uitgave x1\nVoor: bram\nDatum: 2026-11-08\nWat: x\nWaarvoor: —\nBedrag: 12.50\nBon: geen')
  const verdeeld = { ...gewoon, verdeling: { bram: 6.25, chiara: 6.25 } }
  assert.ok(uitgaveTekst(verdeeld).includes('Voor: bram, chiara'))
  assert.ok(uitgaveTekst(verdeeld).includes('Verdeling: bram 6.25, chiara 6.25'))
})

test('Bonnetje lezen: enkel een geldige datum (niet in de toekomst) en een bedrag in euro', () => {
  const ok = leesBonVoorstel('Hier: {"is_bon": true, "winkel": "Exki", "omschrijving": "Lunch: 2 broodjes en 2 drankjes", "datum": "2026-11-18", "totaal": "23,40", "munt": "EUR", "zekerheid": 0.9}', '2026-11-22')
  assert.deepEqual(ok, { winkel: 'Exki', omschrijving: 'Lunch: 2 broodjes en 2 drankjes', datum: '2026-11-18', bedrag: 23.4, zekerheid: 0.9, opmerking: null })
  assert.equal(leesBonVoorstel('{"is_bon": true, "datum": "2026-12-01", "totaal": 10}', '2026-11-22').datum, null, 'toekomst')
  const dollar = leesBonVoorstel('{"is_bon": true, "totaal": 12, "munt": "USD"}', '2026-11-22')
  assert.equal(dollar.bedrag, null)
  assert.ok(dollar.opmerking?.includes('USD'))
  assert.equal(leesBonVoorstel('{"is_bon": false}', '2026-11-22').bedrag, null)
  assert.equal(leesBonVoorstel('geen json', '2026-11-22').zekerheid, 0)
})

console.log(`\n${n} tests geslaagd\n`)

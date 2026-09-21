// Acceptatietests facturatieplanner (pure logica). Uitvoeren: npx tsx tests/planner.test.ts
import assert from 'node:assert/strict'
import { magVerplaatsen } from '../lib/facturatie/planner-model'
import {
  bepaalStatus, samenvatting, pasFiltersToe, LEEG_FILTERS, dagTotalen, sorteer, maandRooster, weekBereik, roosterBereik,
  vandaagBrussel, momentSleutel, ontleedSleutel, kort, plusDagen, weekdag, euro, type Moment,
} from '../lib/facturatie/planner-model'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const VANDAAG = '2026-09-15'   // dinsdag

const maak = (p: Partial<Moment> & { datum: string; status?: Moment['status'] }): Moment => ({
  id: p.id ?? momentSleutel('invoice', p.datum + Math.random()), bron: 'invoice', bronId: 'x', maand: p.datum.slice(0, 7), datum: p.datum,
  client_id: p.client_id ?? 'k1', klant: p.klant ?? 'Verheyen Tegels', project: null, omschrijving: null, type: p.type ?? 'Maandfactuur',
  bedrag_excl: p.bedrag_excl ?? 680, btw_pct: 21, bedrag_incl: Math.round((p.bedrag_excl ?? 680) * 1.21 * 100) / 100,
  status: p.status ?? 'gepland', ruweStatus: 'te_versturen', herkomst: p.herkomst ?? 'recurring', terugkerend: p.terugkerend ?? true, verantwoordelijke: 'Bram Reinquin',
  volledig: p.volledig ?? true, ontbrekend: p.ontbrekend ?? [],
  contract_id: null, contract_titel: null, recurring_id: null, invoice_id: null, wam_id: null, schema: null, opmerking: null, dienst: null, betaaltermijn: 30, verzonden_op: null, verzonden_door: null, verwacht_op: '2026-10-15',
  acties: { bekijkenUrl: null, aanpassenUrl: null, voorbereidenUrl: null, kanVerstuurd: true, kanVerplaatsen: true, kanAnnuleren: true},
})

console.log('Facturatieplanner')

test('1. Statusregels: gepland / te versturen / achterstallig / controle / verstuurd / betaald / geannuleerd', () => {
  assert.equal(bepaalStatus({ ruweStatus: 'te_versturen', datum: '2026-09-20', ontbrekend: [], vandaag: VANDAAG }), 'gepland')
  assert.equal(bepaalStatus({ ruweStatus: 'te_versturen', datum: VANDAAG, ontbrekend: [], vandaag: VANDAAG }), 'te_versturen')
  assert.equal(bepaalStatus({ ruweStatus: 'te_versturen', datum: '2026-09-01', ontbrekend: [], vandaag: VANDAAG }), 'achterstallig')
  assert.equal(bepaalStatus({ ruweStatus: 'te_versturen', datum: '2026-09-20', ontbrekend: ['bedrag ontbreekt'], vandaag: VANDAAG }), 'controle_vereist')
  assert.equal(bepaalStatus({ ruweStatus: 'controle_vereist', datum: '2026-09-01', ontbrekend: [], vandaag: VANDAAG }), 'controle_vereist')
  assert.equal(bepaalStatus({ ruweStatus: 'verstuurd', datum: '2026-09-01', ontbrekend: [], vandaag: VANDAAG }), 'verstuurd')
  assert.equal(bepaalStatus({ ruweStatus: 'gefactureerd', datum: '2026-09-01', ontbrekend: [], vandaag: VANDAAG }), 'verstuurd')
  assert.equal(bepaalStatus({ ruweStatus: 'betaald', datum: '2026-09-01', ontbrekend: [], vandaag: VANDAAG }), 'betaald')
  assert.equal(bepaalStatus({ ruweStatus: 'geannuleerd', datum: VANDAAG, ontbrekend: ['x'], vandaag: VANDAAG }), 'geannuleerd')
})

const set: Moment[] = [
  maak({ datum: VANDAAG, status: 'te_versturen', bedrag_excl: 100 }),
  maak({ datum: '2026-09-18', status: 'gepland', bedrag_excl: 200 }),           // deze week (vr)
  maak({ datum: '2026-09-25', status: 'gepland', bedrag_excl: 300 }),           // deze maand
  maak({ datum: '2026-09-02', status: 'achterstallig', bedrag_excl: 50 }),
  maak({ datum: '2026-09-10', status: 'verstuurd', bedrag_excl: 1000 }),
  maak({ datum: '2026-09-11', status: 'geannuleerd', bedrag_excl: 460, klant: 'Group Cé' }),
  maak({ datum: '2026-09-20', status: 'controle_vereist', bedrag_excl: 0, volledig: false, ontbrekend: ['bedrag ontbreekt'] }),
  maak({ datum: '2026-10-01', status: 'gepland', bedrag_excl: 700 }),
]

test('2. Samenvatting: vandaag / week / maand / bedrag / achterstallig / ontbrekend', () => {
  const s = samenvatting(set, VANDAAG)
  assert.equal(s.vandaag, 1)
  assert.equal(s.week, 3)          // vandaag, vrijdag en de controle op zondag 20/9; achterstallig van 2/9 valt buiten de week
  assert.equal(s.maand, 5)         // 100, 200, 300, achterstallig 50, controle 0 — verstuurd en geannuleerd niet
  assert.equal(s.maandBedrag, 650)
  assert.equal(s.maandBedragTotaal, 1650)   // incl. verstuurd, excl. geannuleerd
  assert.equal(s.achterstallig, 1)
  assert.equal(s.ontbrekend, 1)
})

test('3. Geannuleerd staat niet in het standaardoverzicht, wel op vraag', () => {
  assert.ok(!pasFiltersToe(set, LEEG_FILTERS, VANDAAG).some((m) => m.status === 'geannuleerd'))
  assert.ok(pasFiltersToe(set, { ...LEEG_FILTERS, toonGeannuleerd: true }, VANDAAG).some((m) => m.status === 'geannuleerd'))
  assert.equal(pasFiltersToe(set, { ...LEEG_FILTERS, status: 'geannuleerd' }, VANDAAG).length, 1)
})

test('4. Categoriefilter (dashboardkaart) en periodefilter werken samen', () => {
  assert.equal(pasFiltersToe(set, { ...LEEG_FILTERS, categorie: 'week' }, VANDAAG).length, 3)
  assert.equal(pasFiltersToe(set, { ...LEEG_FILTERS, categorie: 'achterstallig' }, VANDAAG).length, 1)
  assert.equal(pasFiltersToe(set, { ...LEEG_FILTERS, categorie: 'ontbrekend' }, VANDAAG).length, 1)
  assert.equal(pasFiltersToe(set, { ...LEEG_FILTERS, van: '2026-09-16', tot: '2026-09-30' }, VANDAAG).length, 3)
  assert.equal(pasFiltersToe(set, { ...LEEG_FILTERS, volledig: 'ontbrekend' }, VANDAAG).length, 1)
  assert.equal(pasFiltersToe(set, { ...LEEG_FILTERS, terugkerend: 'eenmalig' }, VANDAAG).length, 0)
})

test('5. Dagtotalen tellen geannuleerd niet mee; kalender en lijst delen dezelfde bron', () => {
  const t = dagTotalen(set)
  assert.equal(t.get('2026-09-11'), undefined)
  assert.deepEqual(t.get(VANDAAG), { aantal: 1, bedrag: 100 })
  const zichtbaar = pasFiltersToe(set, LEEG_FILTERS, VANDAAG)
  const somLijst = zichtbaar.reduce((s, m) => s + m.bedrag_excl, 0)
  const somKalender = [...dagTotalen(zichtbaar).values()].reduce((s, d) => s + d.bedrag, 0)
  assert.equal(somLijst, somKalender)
})

test('6. Sortering op datum, klant, bedrag en status', () => {
  assert.equal(sorteer(set, { veld: 'bedrag', richting: 'desc' })[0].bedrag_excl, 1000)
  assert.equal(sorteer(set, { veld: 'datum', richting: 'asc' })[0].datum, '2026-09-02')
  assert.equal(sorteer(set, { veld: 'status', richting: 'asc' })[0].status, 'achterstallig')
  assert.equal(sorteer(set, { veld: 'klant', richting: 'asc' })[0].klant, 'Group Cé')
})

test('7. Maandrooster: 6 weken van maandag tot zondag, week- en maandweergave dekken dezelfde dagen', () => {
  const r = maandRooster('2026-09')
  assert.equal(r.length, 6); assert.equal(r[0][0], '2026-08-31'); assert.equal(r[5][6], '2026-10-11')
  assert.deepEqual(weekBereik(VANDAAG), { van: '2026-09-14', tot: '2026-09-20' })
  const rb = roosterBereik('2026-09')
  assert.ok(rb.van <= '2026-09-14' && rb.tot >= '2026-09-20')
  assert.equal(weekdag('2026-09-14'), 0); assert.equal(plusDagen('2026-09-30', 1), '2026-10-01')
})

test('8. Tijdzone: "vandaag" volgt Europe/Brussels, niet UTC', () => {
  // 23:30 UTC op 14 sep = 01:30 op 15 sep in Brussel (zomertijd).
  assert.equal(vandaagBrussel(new Date('2026-09-14T23:30:00Z')), '2026-09-15')
  assert.equal(vandaagBrussel(new Date('2026-01-31T23:30:00Z')), '2026-02-01')
})

test('9. Unieke sleutel per moment: recurring = id + maand; ontleden werkt terug', () => {
  assert.equal(momentSleutel('recurring', 'abc', '2026-10'), 'rec:abc:2026-10')
  assert.deepEqual(ontleedSleutel('rec:abc:2026-10'), { bron: 'recurring', bronId: 'abc', maand: '2026-10' })
  assert.deepEqual(ontleedSleutel('inv:123'), { bron: 'invoice', bronId: '123', maand: null })
  assert.equal(ontleedSleutel('onzin'), null)
  const dubbel = new Set([momentSleutel('recurring', 'abc', '2026-10'), momentSleutel('recurring', 'abc', '2026-10')])
  assert.equal(dubbel.size, 1)
})

test('10. Compacte kalenderregel en btw-bedragen', () => {
  const m = maak({ datum: VANDAAG, bedrag_excl: 680 })
  assert.equal(kort(m), `Verheyen Tegels – ${euro(680)} – Maandfactuur`)   // Intl zet een vaste spatie na €
  assert.match(kort(m), /^Verheyen Tegels – €\s?680 – Maandfactuur$/)
  assert.equal(m.bedrag_incl, 822.8)
})

test('11. Factuurdatum altijd te verplaatsen, behalve bij een geannuleerd moment', () => {
  for (const s of ['gepland', 'te_versturen', 'controle_vereist', 'verstuurd', 'betaald', 'achterstallig'] as const) assert.equal(magVerplaatsen(s), true, s)
  assert.equal(magVerplaatsen('geannuleerd'), false)
})

console.log(`\n${n} tests geslaagd`)

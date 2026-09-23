// Acceptatietests facturenmodule: handmatige factuurreeks, regels, statussen, maand-KPI's (pure logica).
// Uitvoeren: npx tsx tests/facturatie-workflow.test.ts
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { maakReeks, valideerReeks, isDoorlopend, plusMaanden, factuurdagVan, reeksTotaal, type ReeksInvoer } from '../lib/facturatie/reeks'
import { berekenRegel, berekenTotalen, nieuweRegel, normaliseerRegels, verplaatsRegel, dupliceerRegel, verwijderRegel, verschillen } from '../lib/facturen/regels'
import { VERZENDSTATUS, normaliseerVerzendstatus, afgeleideBetaalstatus, magNaar, magInhoudBewerken, isAfgesloten, redenVerplicht } from '../lib/facturen/status'
import { STATUS_INFO, magVerplaatsen, maandKpi, verwachtOp, type Moment } from '../lib/facturatie/planner-model'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const NU = '2026-09-21'
const basis = (deel: Partial<ReeksInvoer> = {}): ReeksInvoer => ({ type: 'meerdere', aantal: 6, bedrag_excl: 979, btw_pct: 21, start_datum: '2026-10-01', interval_maanden: 1, omschrijving: 'Social media beheer', betalingstermijn_dagen: 30, ...deel })

console.log('Handmatige factuurreeks (de app leest niets uit het contract)')
test('6 × € 979 maandelijks vanaf 1 oktober → 6 facturen, één per maand, eigen omschrijving per termijn', () => {
  const r = maakReeks(basis())
  assert.equal(r.length, 6)
  assert.deepEqual(r.map((m) => m.factuurdatum), ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'])
  assert.equal(r[0].omschrijving, 'Social media beheer · termijn 1/6')
  assert.equal(r[0].bedrag_incl, 1184.59)
  assert.deepEqual(reeksTotaal(r), { excl: 5874, incl: 7107.54 })
})
test('eenmalig → precies één factuur zonder termijnsuffix', () => {
  const r = maakReeks(basis({ type: 'eenmalig', aantal: 1, bedrag_excl: 2500 }))
  assert.equal(r.length, 1)
  assert.equal(r[0].omschrijving, 'Social media beheer')
  assert.equal(r[0].bedrag_excl, 2500)
})
test('per kwartaal → 3 maanden uit elkaar; einde van de maand blijft einde van de maand', () => {
  const r = maakReeks(basis({ aantal: 4, interval_maanden: 3, start_datum: '2026-01-31' }))
  assert.deepEqual(r.map((m) => m.factuurdatum), ['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31'])
  assert.equal(plusMaanden('2026-01-31', 1), '2026-02-28')
})
test('maandelijks met einde → één factuur per maand met de maand in de omschrijving; doorlopend → geen lijst maar een terugkerende definitie', () => {
  const r = maakReeks(basis({ type: 'maandelijks', aantal: 3 }))
  assert.deepEqual(r.map((m) => m.omschrijving), ['Social media beheer · 2026-10', 'Social media beheer · 2026-11', 'Social media beheer · 2026-12'])
  const door = basis({ type: 'maandelijks', aantal: null })
  assert.equal(isDoorlopend(door), true)
  assert.deepEqual(maakReeks(door), [])
  assert.deepEqual(valideerReeks(door), [])
})
test('validatie: ontbrekend bedrag, ongeldige datum, te veel facturen → fouten; niets wordt geraden', () => {
  assert.ok(valideerReeks(basis({ bedrag_excl: 0 })).includes('bedrag per factuur ontbreekt'))
  assert.ok(valideerReeks(basis({ start_datum: 'morgen' })).includes('startdatum ontbreekt'))
  assert.ok(valideerReeks(basis({ aantal: 61 })).length > 0)
  assert.ok(valideerReeks(basis({ omschrijving: '  ' })).includes('omschrijving ontbreekt'))
  assert.deepEqual(maakReeks(basis({ bedrag_excl: 0 })), [])
})
test('factuurdag voor doorlopende facturatie volgt uit de startdatum', () => {
  assert.equal(factuurdagVan('2026-10-01'), 'first'); assert.equal(factuurdagVan('2026-10-15'), 'mid'); assert.equal(factuurdagVan('2026-10-28'), 'last')
})

console.log('Factuurregels')
test('regel: aantal × prijs − korting, btw per regel, totalen zonder zwevende-kommafouten', () => {
  const r = berekenRegel({ aantal: 3, prijs_excl: 33.33, btw_pct: 21, korting_pct: 10 })
  assert.equal(r.excl, 89.99); assert.equal(r.btw, 18.9); assert.equal(r.incl, 108.89)
  const t = berekenTotalen([
    nieuweRegel({ artikel: 'Fotoshoot', prijs_excl: 979, aantal: 1 }, 21),
    nieuweRegel({ artikel: 'Kilometervergoeding', prijs_excl: 0.4, aantal: 120, eenheid: 'km', is_extra: true }, 21),
    nieuweRegel({ artikel: 'Cameraverhuur', prijs_excl: 10, aantal: 1, btw_pct: 6 }, 21),
  ])
  assert.equal(t.excl, 1037); assert.equal(t.btw, 216.27); assert.equal(t.incl, 1253.27)
  assert.equal(t.aantalRegels, 3); assert.equal(t.contractueel.excl, 989); assert.equal(t.extra.excl, 48)
})
test('regels toevoegen, dupliceren, verwijderen en herordenen → volgnummers blijven 1..n', () => {
  let rs = [nieuweRegel({ artikel: 'A', volgnr: 1 }), nieuweRegel({ artikel: 'B', volgnr: 2 }), nieuweRegel({ artikel: 'C', volgnr: 3 })]
  rs = dupliceerRegel(rs, 0)
  assert.deepEqual(rs.map((r) => r.artikel), ['A', 'A', 'B', 'C']); assert.equal(rs[1].id, null)
  rs = verwijderRegel(rs, 1); rs = verplaatsRegel(rs, 2, 0)
  assert.deepEqual(rs.map((r) => r.artikel), ['C', 'A', 'B']); assert.deepEqual(rs.map((r) => r.volgnr), [1, 2, 3])
})
test('normaliseerRegels: lege regels vallen weg, tekst wordt aangevuld, btw/korting begrensd', () => {
  const rs = normaliseerRegels([{ artikel: '', omschrijving: '' }, { artikel: 'Reiskosten', aantal: '2', prijs_excl: '12.5', btw_pct: 250, korting_pct: -5, is_extra: 'true' }, { omschrijving: 'Alleen omschrijving' }], 21)
  assert.equal(rs.length, 2); assert.equal(rs[0].btw_pct, 100); assert.equal(rs[0].korting_pct, 0); assert.equal(rs[0].is_extra, true); assert.equal(rs[1].artikel, 'Alleen omschrijving')
})
test('verschillen: enkel gewijzigde velden, als tekst voor de historiek', () => {
  const d = verschillen({ invoice_date: '2026-10-01', amount_excl: 979, note: null }, { invoice_date: '2026-10-05', amount_excl: 979, note: 'x' }, ['invoice_date', 'amount_excl', 'note'])
  assert.deepEqual(d.map((x) => x.veld), ['invoice_date', 'note'])
})

console.log('Statussen: te factureren grijs, verstuurd groen, geannuleerd rood')
test('labels en kleuren', () => {
  assert.equal(VERZENDSTATUS.te_versturen.label, 'Te factureren'); assert.match(VERZENDSTATUS.te_versturen.cls, /gray/)
  assert.match(VERZENDSTATUS.verstuurd.cls, /green/); assert.match(VERZENDSTATUS.geannuleerd.cls, /red/)
  assert.match(STATUS_INFO.gepland.cls, /gray/); assert.equal(STATUS_INFO.gepland.label, 'Te factureren'); assert.match(STATUS_INFO.verstuurd.cls, /green/); assert.match(STATUS_INFO.geannuleerd.cls, /red/)
})
test('oude statuswaarden worden genormaliseerd; inhoud enkel bewerkbaar vóór versturen; reden verplicht bij annuleren', () => {
  assert.equal(normaliseerVerzendstatus('gefactureerd'), 'verstuurd'); assert.equal(normaliseerVerzendstatus(null), 'te_versturen')
  assert.equal(magInhoudBewerken('te_versturen'), true); assert.equal(magInhoudBewerken('verstuurd'), true, 'interne planner: altijd bewerkbaar')
  assert.equal(redenVerplicht('geannuleerd'), true); assert.equal(isAfgesloten('geannuleerd'), true)
  assert.equal(magNaar('te_versturen', 'verstuurd').ok, true); assert.equal(magNaar('verstuurd', 'te_versturen', 100).ok, true); assert.equal(magNaar('geannuleerd', 'verstuurd').ok, true); assert.equal(magNaar('verstuurd', 'verstuurd').ok, false)
})
test('betaalstatus enkel voor verstuurde facturen', () => {
  const b = (p: Partial<Parameters<typeof afgeleideBetaalstatus>[0]>) => afgeleideBetaalstatus({ verzendstatus: 'verstuurd', betaaldBedrag: 0, totaalIncl: 1184.59, vervaldatum: '2026-10-31', vandaag: NU, ...p })
  assert.equal(b({ verzendstatus: 'te_versturen' }), null); assert.equal(b({}), 'niet_betaald'); assert.equal(b({ betaaldBedrag: 1184.59 }), 'betaald')
})
test('planner: geannuleerd verplaats je niet meer, de rest wel', () => {
  assert.equal(magVerplaatsen('geannuleerd'), false); assert.equal(magVerplaatsen('verstuurd'), true); assert.equal(magVerplaatsen('gepland'), true)
})

console.log('Maandoverzicht: nog te factureren / reeds verstuurd / totaal gepland / verwacht binnen')
const moment = (deel: Partial<Moment>): Moment => ({
  id: 'inv:x', bron: 'invoice', bronId: 'x', maand: '2026-09', datum: '2026-09-05', client_id: 'k', klant: 'Klant', project: 'Social', omschrijving: null, type: 'Eenmalig',
  bedrag_excl: 100, btw_pct: 21, bedrag_incl: 121, status: 'gepland', ruweStatus: 'te_versturen', herkomst: 'eenmalig', terugkerend: false, verantwoordelijke: null, volledig: true, ontbrekend: [],
  contract_id: null, contract_titel: null, recurring_id: null, invoice_id: 'x', wam_id: null, schema: null, opmerking: null, dienst: 'Social', betaaltermijn: 30, verzonden_op: null, verzonden_door: null, betaald_op: null,
  verwacht_op: verwachtOp(null, '2026-09-05', 30), acties: { bekijkenUrl: null, aanpassenUrl: null, voorbereidenUrl: null, kanVerstuurd: true, kanVerplaatsen: true, kanAnnuleren: true }, ...deel,
})
test('factuur verstuurd op 5 september met 30 dagen termijn → verwacht binnen in oktober, niet september', () => {
  const m = moment({ status: 'verstuurd', datum: '2026-09-05', verzonden_op: '2026-09-05', betaaltermijn: 30, verwacht_op: verwachtOp('2026-09-05', '2026-09-05', 30) })
  assert.equal(m.verwacht_op, '2026-10-05')
  const sep = maandKpi([m], '2026-09'), okt = maandKpi([m], '2026-10')
  assert.equal(sep.verstuurd, 100); assert.equal(sep.verwachtBinnen, 0)
  assert.equal(okt.verwachtBinnen, 100); assert.equal(okt.verstuurd, 0)
})
test('nog te factureren + reeds verstuurd = totaal gepland; geannuleerd telt nergens mee', () => {
  const k = maandKpi([
    moment({ id: '1', bedrag_excl: 500 }),
    moment({ id: '2', bedrag_excl: 300, status: 'verstuurd', verzonden_op: '2026-09-10', verwacht_op: '2026-10-10' }),
    moment({ id: '3', bedrag_excl: 999, status: 'geannuleerd' }),
    moment({ id: '4', bedrag_excl: 250, datum: '2026-10-01', maand: '2026-10' }),
  ], '2026-09')
  assert.equal(k.teFactureren, 500); assert.equal(k.teFacturerenAantal, 1); assert.equal(k.verstuurd, 300); assert.equal(k.gepland, 800); assert.equal(k.verwachtBinnen, 0)
})
test('verstuurd wordt geteld in de maand van de werkelijke verzenddatum, niet van de geplande datum', () => {
  const m = moment({ status: 'verstuurd', datum: '2026-08-30', maand: '2026-08', verzonden_op: '2026-09-02', verwacht_op: '2026-10-02' })
  assert.equal(maandKpi([m], '2026-08').verstuurd, 0); assert.equal(maandKpi([m], '2026-09').verstuurd, 100)
})
test('een betaalde factuur telt bij verstuurd, maar niet meer bij verwacht binnen', () => {
  const m = moment({ status: 'betaald', bedrag_excl: 400, datum: '2026-09-01', verzonden_op: '2026-09-01', verwacht_op: '2026-10-01' })
  assert.equal(maandKpi([m], '2026-09').verstuurd, 400)
  assert.equal(maandKpi([m], '2026-10').verwachtBinnen, 0)
  const open = moment({ id: 'o', status: 'verstuurd', bedrag_excl: 400, datum: '2026-09-01', verzonden_op: '2026-09-01', verwacht_op: '2026-10-01' })
  assert.equal(maandKpi([open], '2026-10').verwachtBinnen, 400)
})
test('lege maand → alles nul, geen NaN', () => {
  const k = maandKpi([], '2026-09'); assert.equal(k.gepland, 0); assert.equal(k.verwachtBinnen, 0)
})

console.log('Geen automatische contractanalyse en geen ClickUp voor facturatie')
const lees = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8')
test('de voorstelengine en de ClickUp-facturatiefuncties bestaan niet meer', () => {
  for (const f of ['lib/facturatie/voorstel.ts', 'lib/facturatie/schema.ts', 'lib/facturatie/opdrachten.ts']) assert.ok(!existsSync(join(__dirname, '..', f)), `${f} hoort weg te zijn`)
  const bron = lees('lib/clickup.ts')
  for (const naam of ['createInvoiceTask', 'completeInvoiceTask', 'facturatieLijst', 'maakOpdrachtTaak', 'findOrCreateInvoiceList']) assert.ok(!bron.includes(naam), `${naam} hoort niet meer in lib/clickup.ts`)
  for (const f of ['app/api/sign/route.ts', 'app/api/admin/contracts/route.ts']) assert.ok(!lees(f).includes('verwerkOndertekening'), `${f} maakt geen facturen meer aan bij ondertekening`)
})
test('social-media-, afspraken- en agenda-sync met ClickUp bestaan nog', () => {
  const bron = lees('lib/clickup.ts')
  for (const naam of ['export async function findOrCreateClientList', 'export async function createTask', 'export async function updateTask', 'export async function deleteTask', 'export async function maakAfspraakTaak', 'export async function haalSyncTaken', 'export async function upsertAssignmentTask']) assert.ok(bron.includes(naam), `${naam} moet blijven bestaan`)
  for (const f of ['lib/facturatie/planner.ts', 'lib/facturatie/reeks.ts', 'app/api/admin/invoices/route.ts', 'app/api/admin/invoices/planner/route.ts', 'app/api/admin/contracts/[id]/facturatie/route.ts']) assert.ok(!/from ['"]@\/lib\/clickup['"]/.test(lees(f)), `${f} mag lib/clickup niet importeren`)
})

console.log(`\n${n} tests geslaagd`)

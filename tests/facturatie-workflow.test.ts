// Acceptatietests contract → factuurvoorstel → facturen (pure logica).
// Uitvoeren: npx tsx tests/facturatie-workflow.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { maakVoorstel, voorstelBedrag, valideerVoorstel, contractSamenvatting } from '../lib/facturatie/voorstel'
import type { ContractRij, KlantRij } from '../lib/facturatie/schema'
import { berekenRegel, berekenTotalen, nieuweRegel, normaliseerRegels, verplaatsRegel, dupliceerRegel, verwijderRegel, verschillen } from '../lib/facturen/regels'
import { VERZENDSTATUS, normaliseerVerzendstatus, afgeleideBetaalstatus, magNaar, magInhoudBewerken, isAfgesloten, redenVerplicht } from '../lib/facturen/status'
import { STATUS_INFO, magVerplaatsen } from '../lib/facturatie/planner-model'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const NU = '2026-09-21'
const KLANT: KlantRij = { id: 'k1', company_name: 'FruitAtWork', contact_name: 'An', email: 'an@example.be', btw_nummer: 'BE0123456789' }
const basis = (deel: Partial<ContractRij> = {}): ContractRij => ({
  id: '11111111-2222-3333-4444-555555555555', title: 'Social media beheer', status: 'signed', client_id: 'k1', service_slug: 'social',
  start_date: '2026-10-01', end_date: null, duration_type: 'bepaald', signed_at: '2026-09-20T10:00:00Z', signer_name: 'An', signer_email: 'an@example.be',
  expected_invoice_count: 6, invoice_frequency: 'maandelijks', expected_invoice_amount_excl: 979, ...deel,
})

console.log('Voorstel uit een contract')
test('6 × € 979 maandelijks → 6 voorgestelde facturen, elk met één contractuele regel', () => {
  const v = maakVoorstel(basis(), KLANT, 21, 30, NU)
  assert.equal(v.regels.length, 6)
  assert.deepEqual(v.ontbrekend, [])
  assert.equal(v.eenmalig, false)
  for (const r of v.regels) {
    assert.equal(r.bedrag_excl, 979)
    assert.equal(r.btw_pct, 21)
    assert.equal(r.regels.length, 1)
    assert.equal(r.regels[0].is_extra, false)
    assert.equal(r.bron_velden.bedrag_excl, 'contract')
    assert.equal(r.bron_velden.factuurdatum, 'contract')
    assert.equal(r.betalingstermijn_dagen, 30)
  }
  const datums = v.regels.map((r) => r.factuurdatum)
  assert.equal(new Set(datums).size, 6, 'elke factuur op een eigen datum')
  assert.deepEqual([...datums].sort(), datums, 'chronologisch')
  assert.equal(v.regels[0].factuurdatum.slice(0, 7), '2026-10')
  assert.equal(v.regels[5].factuurdatum.slice(0, 7), '2027-03')
})
test('eenmalig contract → precies één voorstel met het volledige bedrag', () => {
  const v = maakVoorstel(basis({ expected_invoice_count: 1, invoice_frequency: 'eenmalig', expected_invoice_amount_excl: 2500 }), KLANT, 21, 30, NU)
  assert.equal(v.regels.length, 1)
  assert.equal(v.eenmalig, true)
  assert.equal(v.regels[0].type, 'volledig')
  assert.equal(voorstelBedrag(v.regels[0]).excl, 2500)
  assert.equal(voorstelBedrag(v.regels[0]).incl, 3025)
})
test('kwartaalfacturatie → 4 voorstellen, drie maanden uit elkaar', () => {
  const v = maakVoorstel(basis({ expected_invoice_count: 4, invoice_frequency: 'kwartaal', expected_invoice_amount_excl: 1500 }), KLANT, 21, 30, NU)
  assert.equal(v.regels.length, 4)
  assert.deepEqual(v.regels.map((r) => r.factuurdatum.slice(0, 7)), ['2026-10', '2027-01', '2027-04', '2027-07'])
})
test('ontbrekend bedrag → geen gok: controle vereist, bron "controle", geen regels', () => {
  const v = maakVoorstel(basis({ expected_invoice_amount_excl: null }), KLANT, 21, 30, NU)
  assert.ok(v.ontbrekend.length > 0)
  for (const r of v.regels) {
    assert.equal(r.bedrag_excl, null)
    assert.equal(r.regels.length, 0)
    assert.equal(r.bron_velden.bedrag_excl, 'controle')
  }
  assert.ok(valideerVoorstel({ factuurdatum: v.regels[0]?.factuurdatum ?? null, omschrijving: 'x', bedrag_excl: null, btw_pct: 21 }).length > 0)
})
test('geen startdatum maar wel ondertekend → datum afgeleid (bron "afgeleid")', () => {
  const v = maakVoorstel(basis({ start_date: null }), KLANT, 21, 30, NU)
  assert.ok(v.regels.length > 0)
  assert.equal(v.regels[0].bron_velden.factuurdatum, 'afgeleid')
})
test('interpretatie toont wat de app las, met bron per veld', () => {
  const v = maakVoorstel(basis(), KLANT, 21, 30, NU)
  const kaart = Object.fromEntries(v.interpretatie.map((i) => [i.veld, i]))
  assert.equal(kaart.klant.waarde, 'FruitAtWork')
  assert.equal(kaart.frequentie.waarde, 'Maandelijks')
  assert.equal(kaart.aantal.waarde, '6')
  assert.equal(kaart.bedrag.bron, 'contract')
  assert.equal(kaart.valuta.waarde, 'EUR')
  const vNul = maakVoorstel(basis({ expected_invoice_amount_excl: null }), null, 21, 30, NU)
  const k2 = Object.fromEntries(vNul.interpretatie.map((i) => [i.veld, i]))
  assert.equal(k2.bedrag.bron, 'controle')
  assert.equal(k2.klant.bron, 'controle')
})
test('valideerVoorstel: volledige gegevens → geen fouten; ontbrekende btw of ongeldige datum → fout', () => {
  assert.deepEqual(valideerVoorstel({ factuurdatum: '2026-10-01', omschrijving: 'Social', bedrag_excl: 979, btw_pct: 21, client_id: 'k1' }), [])
  assert.ok(valideerVoorstel({ factuurdatum: '2026-10-01', omschrijving: 'Social', bedrag_excl: 979, btw_pct: null }).length > 0)
  assert.ok(valideerVoorstel({ factuurdatum: 'gisteren', omschrijving: 'Social', bedrag_excl: 979, btw_pct: 21 }).length > 0)
  assert.ok(valideerVoorstel({ factuurdatum: '2026-10-01', omschrijving: 'Social', bedrag_excl: 979, btw_pct: 21, client_id: null }).includes('klant ontbreekt op het contract'))
})

console.log('Factuurregels')
test('regel: aantal × prijs − korting, btw per regel, totalen zonder zwevende-kommafouten', () => {
  const r = berekenRegel({ aantal: 3, prijs_excl: 33.33, btw_pct: 21, korting_pct: 10 })
  assert.equal(r.excl, 89.99)          // 99.99 − 10 %
  assert.equal(r.btw, 18.9)
  assert.equal(r.incl, 108.89)
  const t = berekenTotalen([
    nieuweRegel({ artikel: 'Beheer', prijs_excl: 979, aantal: 1 }, 21),
    nieuweRegel({ artikel: 'Kilometers', prijs_excl: 0.4, aantal: 120, eenheid: 'km', is_extra: true }, 21),
    nieuweRegel({ artikel: 'Boek', prijs_excl: 10, aantal: 1, btw_pct: 6 }, 21),
  ])
  assert.equal(t.excl, 1037)
  assert.equal(t.btw, 216.27)          // 205.59 + 10.08 + 0.60
  assert.equal(t.incl, 1253.27)
  assert.equal(t.aantalRegels, 3)
  assert.equal(t.contractueel.excl, 989)
  assert.equal(t.extra.excl, 48)
  assert.deepEqual(t.perBtw.map((p) => p.pct), [6, 21])
})
test('regels toevoegen, dupliceren, verwijderen en herordenen → volgnummers blijven 1..n', () => {
  let rs = [nieuweRegel({ artikel: 'A', volgnr: 1 }), nieuweRegel({ artikel: 'B', volgnr: 2 }), nieuweRegel({ artikel: 'C', volgnr: 3 })]
  rs = dupliceerRegel(rs, 0)
  assert.deepEqual(rs.map((r) => r.artikel), ['A', 'A', 'B', 'C'])
  assert.deepEqual(rs.map((r) => r.volgnr), [1, 2, 3, 4])
  assert.equal(rs[1].id, null, 'een kopie krijgt geen databank-id mee')
  rs = verwijderRegel(rs, 1)
  rs = verplaatsRegel(rs, 2, 0)
  assert.deepEqual(rs.map((r) => r.artikel), ['C', 'A', 'B'])
  assert.deepEqual(rs.map((r) => r.volgnr), [1, 2, 3])
  assert.equal(verplaatsRegel(rs, 0, 9), rs, 'ongeldige index → ongewijzigd')
})
test('normaliseerRegels: lege regels vallen weg, tekst wordt aangevuld, btw/korting begrensd', () => {
  const rs = normaliseerRegels([
    { artikel: '', omschrijving: '' },
    { artikel: 'Reiskosten', aantal: '2', prijs_excl: '12.5', btw_pct: 250, korting_pct: -5, is_extra: 'true' },
    { omschrijving: 'Alleen omschrijving' },
  ], 21)
  assert.equal(rs.length, 2)
  assert.equal(rs[0].omschrijving, 'Reiskosten')
  assert.equal(rs[0].btw_pct, 100)
  assert.equal(rs[0].korting_pct, 0)
  assert.equal(rs[0].is_extra, true)
  assert.equal(rs[0].prijs_excl, 12.5)
  assert.equal(rs[1].artikel, 'Alleen omschrijving')
  assert.deepEqual(rs.map((r) => r.volgnr), [1, 2])
})
test('verschillen: enkel gewijzigde velden, als tekst voor de historiek', () => {
  const d = verschillen({ invoice_date: '2026-10-01', amount_excl: 979, note: null }, { invoice_date: '2026-10-05', amount_excl: 979, note: 'x' }, ['invoice_date', 'amount_excl', 'note'])
  assert.deepEqual(d.map((x) => x.veld), ['invoice_date', 'note'])
  assert.equal(d[0].nieuw, '2026-10-05')
})

console.log('Statussen')
test('verzendstatus kleuren: te versturen grijs, verstuurd groen, geannuleerd en gecrediteerd rood', () => {
  assert.match(VERZENDSTATUS.te_versturen.cls, /gray/)
  assert.match(VERZENDSTATUS.verstuurd.cls, /green/)
  assert.match(VERZENDSTATUS.geannuleerd.cls, /red/)
  assert.match(VERZENDSTATUS.gecrediteerd.cls, /red/)
  assert.match(STATUS_INFO.gecrediteerd.cls, /red/)
  assert.match(STATUS_INFO.te_versturen.cls, /gray/)
})
test('oude statuswaarden worden netjes genormaliseerd', () => {
  assert.equal(normaliseerVerzendstatus('gefactureerd'), 'verstuurd')
  assert.equal(normaliseerVerzendstatus('betaald'), 'verstuurd')
  assert.equal(normaliseerVerzendstatus(null), 'te_versturen')
  assert.equal(normaliseerVerzendstatus('GECREDITEERD'), 'gecrediteerd')
})
test('inhoud enkel bewerkbaar zolang niet verstuurd; reden verplicht bij annuleren/crediteren', () => {
  assert.equal(magInhoudBewerken('te_versturen'), true)
  assert.equal(magInhoudBewerken('verstuurd'), false)
  assert.equal(redenVerplicht('geannuleerd'), true)
  assert.equal(redenVerplicht('gecrediteerd'), true)
  assert.equal(redenVerplicht('verstuurd'), false)
  assert.equal(isAfgesloten('gecrediteerd'), true)
  assert.equal(isAfgesloten('verstuurd'), false)
})
test('toegestane overgangen', () => {
  assert.equal(magNaar('te_versturen', 'verstuurd').ok, true)
  assert.equal(magNaar('te_versturen', 'geannuleerd').ok, true)
  assert.equal(magNaar('te_versturen', 'gecrediteerd').ok, false, 'niet-verstuurd crediteren kan niet')
  assert.equal(magNaar('verstuurd', 'gecrediteerd').ok, true)
  assert.equal(magNaar('verstuurd', 'te_versturen', 0).ok, true)
  assert.equal(magNaar('verstuurd', 'te_versturen', 100).ok, false, 'niet terug als er al betaald is')
  assert.equal(magNaar('gecrediteerd', 'verstuurd').ok, false)
  assert.equal(magNaar('verstuurd', 'verstuurd').ok, false)
})
test('betaalstatus is afgeleid en enkel van toepassing op verstuurde facturen', () => {
  const b = (p: Partial<Parameters<typeof afgeleideBetaalstatus>[0]>) => afgeleideBetaalstatus({ verzendstatus: 'verstuurd', betaaldBedrag: 0, totaalIncl: 1184.59, vervaldatum: '2026-10-31', vandaag: NU, ...p })
  assert.equal(b({ verzendstatus: 'te_versturen' }), null)
  assert.equal(b({}), 'niet_betaald')
  assert.equal(b({ betaaldBedrag: 500 }), 'gedeeltelijk_betaald')
  assert.equal(b({ betaaldBedrag: 1184.59 }), 'betaald')
  assert.equal(b({ vervaldatum: '2026-09-01' }), 'achterstallig')
  assert.equal(b({ vervaldatum: '2026-09-01', betaaldBedrag: 1184.59 }), 'betaald', 'volledig betaald is nooit achterstallig')
})
test('planner: geannuleerd en gecrediteerd verplaats je niet meer, de rest wel', () => {
  assert.equal(magVerplaatsen('gecrediteerd'), false)
  assert.equal(magVerplaatsen('geannuleerd'), false)
  assert.equal(magVerplaatsen('verstuurd'), true)
  assert.equal(magVerplaatsen('te_versturen'), true)
})

console.log('Samenvatting per contract')
test('kaarten: bevestigd, extra, verstuurd, ontvangen, nog te versturen/ontvangen, voortgang', () => {
  const s = contractSamenvatting({
    contractwaarde: 6 * 979,
    facturen: [
      { status: 'verstuurd', amount_excl: 979, amount_incl: 1184.59, betaald_bedrag: 1184.59 },                                  // volledig betaald
      { status: 'verstuurd', amount_excl: 1027, amount_incl: 1242.67, betaald_bedrag: 0, contract_bedrag_excl: 979 },            // € 48 extra, onbetaald
      { status: 'te_versturen', amount_excl: 979, amount_incl: 1184.59 },
      { status: 'te_versturen', amount_excl: 979, amount_incl: 1184.59 },
      { status: 'geannuleerd', amount_excl: 979, amount_incl: 1184.59 },
      { status: 'gecrediteerd', amount_excl: 979, amount_incl: 1184.59, betaald_bedrag: 1184.59 },
    ],
    voorstellen: [
      { status: 'open', bedrag_excl: 979, invoice_id: null },
      { status: 'afgehandeld', bedrag_excl: 979, invoice_id: 'inv' },
      { status: 'geannuleerd', bedrag_excl: 979, invoice_id: null },
    ],
  })
  assert.equal(s.contractwaarde, 5874)
  assert.equal(s.bevestigd, 979 + 1027 + 979 + 979)
  assert.equal(s.extraKosten, 48)
  assert.equal(s.verstuurd, 979 + 1027)
  assert.equal(s.ontvangen, 979, 'enkel effectief betaald; gecrediteerde betaling telt niet')
  assert.equal(s.nogTeOntvangen, 1027)
  assert.equal(s.nogTeVersturen, 2 * 979, 'geannuleerd/gecrediteerd telt nooit als nog te versturen')
  assert.equal(s.inVoorstel, 979)
  assert.deepEqual(s.aantal, { voorstellen: 1, teVersturen: 2, verstuurd: 2, geannuleerd: 2, totaal: 4 })
  assert.equal(s.voortgangPct, 50)
})
test('leeg contract → alles nul, geen deling door nul', () => {
  const s = contractSamenvatting({ contractwaarde: null, facturen: [], voorstellen: [] })
  assert.equal(s.voortgangPct, 0)
  assert.equal(s.bevestigd, 0)
  assert.equal(s.contractwaarde, null)
})

console.log('ClickUp: financiële sync weg, social/afspraken/agenda intact')
const lees = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8')
test('lib/clickup.ts exporteert geen factuur- of opdrachttaakfuncties meer', () => {
  const bron = lees('lib/clickup.ts')
  for (const naam of ['createInvoiceTask', 'completeInvoiceTask', 'annuleerFactuurTaak', 'werkFactuurTaakBij', 'facturatieLijst', 'facturatieAssigneeId', 'maakOpdrachtTaak', 'werkOpdrachtTaakBij', 'findOrCreateInvoiceList', 'INVOICING_']) {
    assert.ok(!bron.includes(naam), `${naam} hoort niet meer in lib/clickup.ts`)
  }
})
test('social-media-, afspraken- en agenda-sync bestaan nog', () => {
  const bron = lees('lib/clickup.ts')
  for (const naam of ['export async function findOrCreateClientList', 'export async function createTask', 'export async function updateTask', 'export async function deleteTask', 'export async function maakAfspraakTaak', 'export async function haalSyncTaken', 'export async function upsertAssignmentTask', 'export async function clickupTest']) {
    assert.ok(bron.includes(naam), `${naam} moet blijven bestaan`)
  }
})
test('facturatiemodules importeren niets meer uit lib/clickup', () => {
  for (const f of ['lib/facturatie/opdrachten.ts', 'lib/facturatie/recurring.ts', 'lib/facturatie/planner.ts', 'lib/facturatie/voorstel.ts', 'app/api/admin/invoices/route.ts', 'app/api/admin/invoices/planner/route.ts', 'app/api/admin/contracts/[id]/facturatie/route.ts']) {
    assert.ok(!/from ['"]@\/lib\/clickup['"]/.test(lees(f)), `${f} mag lib/clickup niet importeren`)
  }
})

console.log(`\n${n} tests geslaagd`)

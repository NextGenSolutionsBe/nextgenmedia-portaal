// Vesting: kosten per contract, algemene kosten en het akkoord (handtekeningen) per contract.
// Uitvoeren: npx tsx tests/vesting-akkoord.test.ts
import assert from 'node:assert/strict'
import { STANDAARD_INSTELLINGEN as I, berekenVesting, type Contract, type WamRij, type WamKost } from '../lib/vesting'
import {
  akkoordStand, beschrijfAkkoord, contractAkkoord, controleerHandtekening, controleerKostLijn, controleerRegistratie, inhoudTekst,
  laatsteVolledigeVersie, leesVennoten, registratieAkkoord, registratiesVoorBerekening, vennootVan, wijzigingen,
  certificaatMail, certificaatRegels, controleerBewijsInvoer,
  type Handtekening, type KostLijn, type Registratie,
} from '../lib/vesting-akkoord'
import { controleerSnel, snelNaarRij, teBeoordelen } from '../lib/vesting-snel'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

const contract = (over: Partial<Contract> = {}): Contract => ({
  id: 'c1', nr: 'C-001', klant: 'Apex', ondertekend_op: '2026-09-01', start_dienst: '2026-09-01', einde_dienst: null, dienst: null,
  facturatiemodel: 'eenmalig', maandbedrag: null, duur_maanden: null, handmatige_totaalwaarde: 5000, uitgesloten_kosten: 2000,
  status: 'actief', betalingen_op_schema: true, appointment_door_marco: true, closed_door_marco: false,
  laatste_betaalde_maand: null, reden_stop: null, notitie: null, contract_id: null, ...over,
})
const lijnen: KostLijn[] = [
  { id: 'k1', vesting_contract_id: 'c1', soort: 'onderaanneming', omschrijving: 'Developer', bedrag: 1500 },
  { id: 'k2', vesting_contract_id: 'c1', soort: 'hosting', omschrijving: null, bedrag: 500 },
]

console.log('\nVesting — kosten en akkoord\n')

test('Het voorbeeld: €5.000 − €2.000 kosten = €3.000; enkel afspraak = €1.500 voor Marco', () => {
  const c = berekenVesting([contract()], [], [], I).contracten[0]
  assert.equal(c.netto, 3000)
  assert.equal(c.factor, 0.5)
  assert.equal(c.meetellend, 1500)
  const a = contractAkkoord(c, lijnen, 'Website')
  assert.equal(a.telt_mee, 1500)
  assert.equal(a.kosten_totaal, 2000)
  assert.equal(a.deel_pct, 50)
  // Afspraak én closing = alles.
  assert.equal(berekenVesting([contract({ closed_door_marco: true })], [], [], I).contracten[0].meetellend, 3000)
})

test('Algemene kosten (afsluiting WAM) gaan eerst van WAM af; wat overblijft van de contracten', () => {
  const wam: WamRij[] = [{ id: 'w1', nr: 'CW-1', klant: 'Oud', client_id: null, contractwaarde: 1000, netto_ontvangen: 1000, status: 'voltooid', betalingen_op_schema: true, notitie: null, start_datum: null, contract_maanden: null, bedrag_per_factuur: null, frequentie: null, btw_pct: 21, omschrijving: null }]
  const kost: WamKost[] = [{ id: 'x', datum: '2026-10-30', omschrijving: 'Afsluiting VOF', bedrag: 1600 }]
  const v = berekenVesting([contract({ uitgesloten_kosten: 0, closed_door_marco: true })], wam, kost, I)
  assert.equal(v.algemeneKosten.vanWam, 1000)
  assert.equal(v.algemeneKosten.vanContracten, 600)
  assert.equal(v.contracten[0].meetellend, 5000)             // het contract zelf blijft wat getekend is
  assert.equal(v.contracten[0].teltVoorAandeel, 4400)        // maar €600 kosten gaan eraf voor de aandelen
  assert.equal(v.meetellendeWaarde, 4400)
  // Genoeg WAM: de contracten blijven onaangeroerd.
  const genoeg = berekenVesting([contract()], [{ ...wam[0], netto_ontvangen: 10451 }], kost, I)
  assert.equal(genoeg.algemeneKosten.vanContracten, 0)
  assert.equal(genoeg.contracten[0].teltVoorAandeel, 1500)
})

test('Nog niet getekend door de klant: telt pas mee na ondertekening', () => {
  const v = berekenVesting([contract({ ondertekend_op: '' }), contract({ id: 'c2', nr: 'C-002' })], [], [], I)
  const wacht = v.contracten.find((c) => c.id === 'c1')!
  assert.equal(wacht.wachtOpKlant, true)
  assert.equal(wacht.teltVoorAandeel, 0)
  assert.equal(v.contracten[v.contracten.length - 1].id, 'c1')   // achteraan
  assert.equal(v.meetellendeWaarde, 1500)
})

test('Dezelfde cijfers geven exact dezelfde tekst, ook in een andere volgorde', () => {
  const c = berekenVesting([contract()], [], [], I).contracten[0]
  assert.equal(inhoudTekst(contractAkkoord(c, lijnen)), inhoudTekst(contractAkkoord(c, [...lijnen].reverse())))
})

test('Een handtekening geldt enkel voor de cijfers waarvoor getekend werd', () => {
  const c = berekenVesting([contract()], [], [], I).contracten[0]
  const nu = inhoudTekst(contractAkkoord(c, lijnen))
  const h = (vennoot: Handtekening['vennoot'], tekst: string, op = '2026-11-04T10:00:00Z'): Handtekening => ({ id: vennoot + op, onderwerp: 'contract', onderwerp_id: 'c1', vennoot, naam: null, getekend_op: op, inhoud_tekst: tekst })
  const s1 = akkoordStand(nu, [h('marco', nu), h('bram', nu), h('chiara', nu)])
  assert.equal(s1.volledig, true)
  // Closing toegevoegd: de cijfers veranderen, iedereen tekent opnieuw.
  const c2 = berekenVesting([contract({ closed_door_marco: true })], [], [], I).contracten[0]
  const nieuw = contractAkkoord(c2, lijnen)
  const s2 = akkoordStand(inhoudTekst(nieuw), [h('marco', nu), h('bram', nu)])
  assert.equal(s2.volledig, false)
  assert.equal(s2.per.marco.stand, 'opnieuw')
  assert.equal(s2.per.chiara.stand, 'open')
  const w = wijzigingen(s2.vorige, nieuw)
  assert.ok(w.some((x) => /Closing door Marco: nee → ja/.test(x)), w.join(' | '))
})

const reg = (over: Partial<Registratie> = {}): Registratie => ({
  id: 'r1', soort: 'inkomst', datum: '2026-11-04', omschrijving: 'Factuur WAM november', bedrag: 6000,
  verantwoording: 'Marco factureert WAM via de BV; WAM is de klant.', referentie: '2026-125', geschrapt: false, ...over,
})

test('Inkomst achteraf lager (factuur verminderd) = opnieuw tekenen, en je ziet wat veranderde', () => {
  const oud = inhoudTekst(registratieAkkoord(reg()))
  const nieuw = registratieAkkoord(reg({ bedrag: 5000 }))
  assert.notEqual(oud, inhoudTekst(nieuw))
  assert.deepEqual(wijzigingen(oud, nieuw), ['Bedrag €6.000 → €5.000'])
  assert.deepEqual(wijzigingen(oud, registratieAkkoord(reg({ geschrapt: true }))), ['Geschrapt'])
})

test('Inkomsten tellen zoals WAM (€5.000 = 1%), kosten gaan eraf, geschrapt telt niet', () => {
  const { inkomsten, kosten } = registratiesVoorBerekening([
    reg(), reg({ id: 'r2', bedrag: 5000, geschrapt: true }),
    reg({ id: 'k1', soort: 'kost', omschrijving: 'Afsluiting VOF', bedrag: 1600 }),
  ])
  assert.equal(inkomsten.length, 1)
  assert.equal(kosten.length, 1)
  const v = berekenVesting([], inkomsten, kosten, I)
  assert.equal(v.wam.nettoMeetellend, 4400)           // 6.000 − 1.600
  assert.equal(v.wam.voorlopig, 0)                      // nog geen volle 5.000
  const meer = registratiesVoorBerekening([reg({ bedrag: 11600 }), reg({ id: 'k1', soort: 'kost', omschrijving: 'Afsluiting VOF', bedrag: 1600 })])
  assert.equal(berekenVesting([], meer.inkomsten, meer.kosten, I).wam.voorlopig, 0.02)
})

test('Registreren vraagt omschrijving, bedrag, datum en een verantwoording', () => {
  assert.ok('fout' in controleerRegistratie({ soort: 'inkomst', datum: '2026-11-04', omschrijving: 'WAM', bedrag: 100, verantwoording: '' }))
  assert.ok('fout' in controleerRegistratie({ soort: 'iets', datum: '2026-11-04', omschrijving: 'WAM', bedrag: 100, verantwoording: 'via de BV' }))
  assert.ok('fout' in controleerRegistratie({ soort: 'kost', datum: '', omschrijving: 'WAM', bedrag: 100, verantwoording: 'via de BV' }))
  const ok = controleerRegistratie({ soort: 'kost', datum: '2026-11-04', omschrijving: ' Boekhouder ', bedrag: '1.600', verantwoording: 'Afsluiting WAM' })
  assert.ok('rij' in ok)
  if ('rij' in ok) { assert.equal(ok.rij.bedrag, 1600); assert.equal(ok.rij.omschrijving, 'Boekhouder') }
  // Aanpassen: enkel wat meegegeven wordt.
  const deel = controleerRegistratie({ bedrag: 5000 }, false)
  assert.ok('rij' in deel && deel.rij.bedrag === 5000 && deel.rij.omschrijving === undefined)
  assert.match(beschrijfAkkoord(registratieAkkoord(reg())), /Inkomst Factuur WAM november: €6\.000/)
})

test('Getekend is getekend: de laatste versie die alle drie tekenden blijft gelden', () => {
  const h = (vennoot: Handtekening['vennoot'], tekst: string, op: string) => ({ vennoot, inhoud_tekst: tekst, getekend_op: op })
  const lijst = [
    h('marco', 'v1', '2026-11-01T10:00:00Z'), h('bram', 'v1', '2026-11-01T11:00:00Z'), h('chiara', 'v1', '2026-11-02T09:00:00Z'),
    h('marco', 'v2', '2026-11-03T10:00:00Z'), h('bram', 'v2', '2026-11-03T11:00:00Z'),
  ]
  assert.deepEqual(laatsteVolledigeVersie(lijst), { tekst: 'v1', op: '2026-11-02T09:00:00Z' })
  assert.deepEqual(laatsteVolledigeVersie([...lijst, h('chiara', 'v2', '2026-11-04T08:00:00Z')]), { tekst: 'v2', op: '2026-11-04T08:00:00Z' })
  assert.equal(laatsteVolledigeVersie(lijst.slice(0, 2)), null)
})

test('Kostenlijnen: soort en bedrag verplicht, Belgische notatie', () => {
  assert.ok('fout' in controleerKostLijn({ soort: 'iets', bedrag: 10 }))
  assert.ok('fout' in controleerKostLijn({ soort: 'hosting', bedrag: 0 }))
  const ok = controleerKostLijn({ soort: 'advertentiebudget', bedrag: '1.500,50', omschrijving: ' Meta ' })
  assert.ok('lijn' in ok)
  if ('lijn' in ok) { assert.equal(ok.lijn.bedrag, 1500.5); assert.equal(ok.lijn.omschrijving, 'Meta') }
})

test('Enkel de eigen accounts van Marco, Bram en Chiara tekenen', () => {
  const v = leesVennoten({ marco: { user_ids: ['m'] }, bram: { user_ids: ['b'], naam: 'Bram Reinquin' }, chiara: { user_ids: ['c'] } })
  assert.equal(vennootVan('m', v), 'marco')
  assert.equal(vennootVan('b', v), 'bram')
  assert.equal(vennootVan('iemand', v), null)
  assert.equal(vennootVan(null, v), null)
  assert.equal(v.bram.naam, 'Bram Reinquin')
  assert.equal(v.marco.naam, 'Marco')
})

test('Handtekening: enkel een PNG uit het tekenvak', () => {
  assert.equal(controleerHandtekening('data:image/svg+xml;base64,AAAA'), null)
  assert.equal(controleerHandtekening('data:image/png;base64,AAAA'), null)   // te klein = leeg vak
  const png = 'data:image/png;base64,' + 'A'.repeat(500)
  assert.equal(controleerHandtekening(png), png)
})

test('Te beoordelen: ook contracten die de klant nog niet tekende, getekende eerst', () => {
  const m = [
    { id: '1', titel: 'Website', status: 'sent', client_id: null, klant: 'A', signed_at: null, start_date: null, waarde: null },
    { id: '2', titel: 'Social', status: 'signed', client_id: null, klant: 'B', signed_at: '2026-10-01', start_date: null, waarde: 900 },
    { id: '3', titel: 'Test', status: 'signed', client_id: null, klant: 'test', signed_at: '2026-10-02', start_date: null, waarde: 1 },
  ]
  assert.deepEqual(teBeoordelen(m, new Set(), new Set()).map((x) => x.id), ['2'])
  assert.deepEqual(teBeoordelen(m, new Set(), new Set(), { ookNietGetekend: true }).map((x) => x.id), ['2', '1'])
  // Telt mee zonder datum mag enkel bij een gekoppeld contract dat de klant nog moet tekenen.
  const basis = { klant: 'A', client_id: null, contract_id: '1', ondertekend_op: '', soort: 'eenmalig' as const, prijs: 1000, maanden: null, afspraak: true, closing: false }
  assert.match(String(controleerSnel(basis)), /datum/)
  assert.equal(controleerSnel({ ...basis, wachtOpKlant: true }), null)
  assert.equal(snelNaarRij({ ...basis, wachtOpKlant: true }).ondertekend_op, null)
})

test('Het bewijsstuk zit mee in wat getekend wordt: een ander document = opnieuw tekenen', () => {
  const bewijs = { pad: 'bewijs/00000000-0000-4000-8000-000000000001/factuur.pdf', naam: 'factuur.pdf', sha256: 'a'.repeat(64), grootte: 1000 }
  const met = registratieAkkoord(reg({ bewijs }))
  assert.deepEqual(met.bewijs, { naam: 'factuur.pdf', sha256: 'a'.repeat(64) })
  const ander = registratieAkkoord(reg({ bewijs: { ...bewijs, sha256: 'b'.repeat(64) } }))
  assert.deepEqual(wijzigingen(inhoudTekst(met), ander), ['Document vervangen'])
  // Zonder document blijft de tekst zoals voorheen (oude kaarten tekenen niet opnieuw voor niets).
  assert.equal(inhoudTekst(registratieAkkoord(reg())).includes('bewijs'), false)
})

test('Opgeladen documenten: enkel uit de map bewijs/ van de vestingopslag', () => {
  assert.deepEqual(controleerBewijsInvoer({ pad: 'bewijs/00000000-0000-4000-8000-000000000001/contract-wam.pdf', naam: 'Contract WAM.pdf' }), { pad: 'bewijs/00000000-0000-4000-8000-000000000001/contract-wam.pdf', naam: 'Contract WAM.pdf' })
  assert.equal(controleerBewijsInvoer({ pad: 'certificaten/VC-1.pdf', naam: 'x' }), null)
  assert.equal(controleerBewijsInvoer({ pad: 'bewijs/../geheim.pdf', naam: 'x' }), null)
  assert.equal(controleerBewijsInvoer(null), null)
})

test('Certificaat en mail naar legal@: cijfers, %, drie handtekeningen en de vingerafdruk', () => {
  const c = berekenVesting([contract()], [], [], I).contracten[0]
  const inhoud = contractAkkoord(c, lijnen, 'Webshop')
  const g = {
    nummer: 'VC-ABCDEF1234', inhoud, inhoud_sha256: 'f'.repeat(64), aandeel: c.ruweVesting, volledig_op: '2026-11-04T14:00:00Z',
    stand: { marco: 0.02, bram: 0.65, chiara: 0.33 },
    handtekeningen: [
      { vennoot: 'marco' as const, naam: 'Marco', email: 'marco@nextgenmedia.be', getekend_op: '2026-11-04T13:00:00Z' },
      { vennoot: 'bram' as const, naam: 'Bram', email: 'bram@nextgenmedia.be', getekend_op: '2026-11-04T13:30:00Z' },
      { vennoot: 'chiara' as const, naam: 'Chiara', email: 'chiara@nextgenmedia.be', getekend_op: '2026-11-04T14:00:00Z' },
    ],
  }
  const regels = Object.fromEntries(certificaatRegels(g))
  assert.equal(regels['Telt mee voor Marco'], '€1.500')
  assert.equal(regels['Levert Marco op'], '0,30%')
  assert.match(regels['Marco'], /afspraak gezet: 50%/)
  const mail = certificaatMail(g, { marco: 'Marco Castermans', bram: 'Bram Reinquin', chiara: 'Chiara Walmagh' })
  assert.match(mail.onderwerp, /getekend door alle drie – Apex \(C-001\)/)
  assert.match(mail.tekst, /Levert Marco op: 0,30%/)
  assert.match(mail.tekst, /Chiara Walmagh \(chiara@nextgenmedia\.be\)/)
  assert.match(mail.tekst, /VC-ABCDEF1234/)
  assert.match(mail.tekst, /Marco 2%, Bram 65%, Chiara 33%/)
})

console.log(`\n${n} tests geslaagd\n`)

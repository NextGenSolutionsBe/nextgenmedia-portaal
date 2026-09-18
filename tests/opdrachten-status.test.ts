// Tests voor de statusflow van opdrachten (pure logica).
// Uitvoeren: npx tsx tests/opdrachten-status.test.ts
import assert from 'node:assert/strict'
import {
  STATUSSEN, FASEN, OPEN_STATUSSEN, statusInfo, volgorde, volgendeStatus, afgeleideStatus, magAutomatischNaar,
  pastInFilter, isTeLaat, sorteer, waardeVan, verslag, type Opdracht, type Koppelingen,
} from '../lib/opdrachten'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const k = (deel: Partial<Koppelingen>): Koppelingen => ({ contract: null, facturen: [], facturatieOpen: false, ...deel })
const f = (status: string, id = status) => ({ id, status, invoice_date: '2026-09-01', amount_incl: 100, description: null })

console.log('Opdrachten — statusflow')

test('1. Elke status hoort bij een fase en de flow loopt van voorstel naar facturatie', () => {
  for (const s of STATUSSEN) assert.ok(FASEN.some((x) => x.key === s.fase), s.key)
  assert.ok(volgorde('voorstel_gevraagd') < volgorde('voorstel_klaar'))
  assert.ok(volgorde('voorstel_klaar') < volgorde('interesse'))
  assert.ok(volgorde('interesse') < volgorde('contract_verstuurd'))
  assert.ok(volgorde('contract_verstuurd') < volgorde('getekend'))
  assert.ok(volgorde('getekend') < volgorde('bezig'))
  assert.ok(volgorde('opgeleverd') < volgorde('te_factureren'))
  assert.ok(volgorde('te_factureren') < volgorde('factuur_verstuurd'))
  assert.ok(volgorde('factuur_verstuurd') < volgorde('betaald'))
})

test('2. Openstaand: alles behalve de eindpunten (geen interesse, betaald, afgerond, geannuleerd)', () => {
  assert.deepEqual(STATUSSEN.filter((s) => !OPEN_STATUSSEN.includes(s.key)).map((s) => s.key), ['geen_interesse', 'betaald', 'afgerond', 'geannuleerd'])
  assert.ok(OPEN_STATUSSEN.includes('factuur_verstuurd'), 'wachten op betaling telt nog als open')
  assert.ok(OPEN_STATUSSEN.includes('wacht'))
})

test('3. Volgende stap slaat zijsporen over en stopt op een eindpunt', () => {
  assert.equal(volgendeStatus('voorstel_gevraagd'), 'voorstel_bezig')
  assert.equal(volgendeStatus('interesse'), 'contract_verstuurd')   // niet "geen interesse"
  assert.equal(volgendeStatus('betaald'), null)
  assert.equal(volgendeStatus('factuur_verstuurd'), 'betaald')
  assert.equal(volgendeStatus('afgerond'), null)
  assert.equal(volgendeStatus('geen_interesse'), null)
})

test('4. Contract verstuurd/geopend → "Contract verstuurd"; getekend → "Getekend"', () => {
  assert.equal(afgeleideStatus(k({ contract: { id: 'c', title: 'x', status: 'verzonden' } })), 'contract_verstuurd')
  assert.equal(afgeleideStatus(k({ contract: { id: 'c', title: 'x', status: 'geopend' } })), 'contract_verstuurd')
  assert.equal(afgeleideStatus(k({ contract: { id: 'c', title: 'x', status: 'getekend' } })), 'getekend')
  assert.equal(afgeleideStatus(k({ contract: { id: 'c', title: 'x', status: 'klaar_voor_verzenden' } })), null)
  assert.equal(afgeleideStatus(k({ contract: { id: 'c', title: 'x', status: 'geannuleerd' } })), null)
  assert.equal(afgeleideStatus(null), null)
})

test('5. Facturen: te versturen → "Te factureren", verstuurd → "Factuur verstuurd", alles betaald → "Betaald"', () => {
  assert.equal(afgeleideStatus(k({ facturen: [f('te_versturen')] })), 'te_factureren')
  assert.equal(afgeleideStatus(k({ facturen: [f('verstuurd'), f('te_versturen', 'b')] })), 'factuur_verstuurd')
  assert.equal(afgeleideStatus(k({ facturen: [f('betaald'), f('betaald', 'b')] })), 'betaald')
  assert.equal(afgeleideStatus(k({ facturen: [f('geannuleerd')] })), null, 'een geannuleerde factuur zegt niets')
  assert.equal(afgeleideStatus(k({ contract: { id: 'c', title: 'x', status: 'getekend' }, facturatieOpen: true })), 'te_factureren')
})

test('6. De verst gevorderde aanwijzing wint', () => {
  assert.equal(afgeleideStatus(k({ contract: { id: 'c', title: 'x', status: 'getekend' }, facturen: [f('verstuurd')] })), 'factuur_verstuurd')
  assert.equal(afgeleideStatus(k({ contract: { id: 'c', title: 'x', status: 'verzonden' }, facturen: [f('betaald')] })), 'betaald')
})

test('7. Automatisch enkel vooruit, nooit weg van een eindpunt, en niet twee keer dezelfde afleiding', () => {
  assert.equal(magAutomatischNaar('interesse', 'getekend'), true)
  assert.equal(magAutomatischNaar('bezig', 'getekend'), false, 'terug naar getekend mag niet')
  assert.equal(magAutomatischNaar('afgerond', 'factuur_verstuurd'), false)
  assert.equal(magAutomatischNaar('geannuleerd', 'getekend'), false)
  assert.equal(magAutomatischNaar('geen_interesse', 'contract_verstuurd'), false)
  assert.equal(magAutomatischNaar('interesse', 'getekend', 'getekend'), false, 'handmatig overschreven → niet opnieuw toepassen')
  assert.equal(magAutomatischNaar('bezig', null), false)
})

test('8. Filter: status wint, dan fase, anders open (+ afgesloten op verzoek)', () => {
  const o = (status: Opdracht['status']) => ({ status })
  assert.equal(pastInFilter(o('afgerond'), { fase: 'open' }), false)
  assert.equal(pastInFilter(o('afgerond'), { fase: 'open', toonAfgesloten: true }), true)
  assert.equal(pastInFilter(o('wacht'), { fase: 'open' }), true)
  assert.equal(pastInFilter(o('voorstel_klaar'), { fase: 'voorstel' }), true)
  assert.equal(pastInFilter(o('getekend'), { fase: 'voorstel' }), false)
  assert.equal(pastInFilter(o('geen_interesse'), { fase: 'voorstel' }), true, 'geen interesse hoort bij de voorstelfase')
  assert.equal(pastInFilter(o('getekend'), { fase: 'voorstel', status: 'getekend' }), true, 'een gekozen status wint van de fase')
  assert.equal(pastInFilter(o('geannuleerd'), { fase: 'alle' }), true)
})

test('9. Te laat en sortering werken met de nieuwe statussen', () => {
  const nu = new Date('2026-09-18T10:00:00Z')
  assert.equal(isTeLaat({ status: 'voorstel_voorgelegd', deadline: '2026-09-17' }, nu), true)
  assert.equal(isTeLaat({ status: 'betaald', deadline: '2026-09-17' }, nu), false)
  const basis = { id: '', client_id: null, klant_vrij: null, titel: '', omschrijving: null, deadline: null, wie: null, afgerond_op: null, created_at: '2026-09-01' }
  const lijst: Opdracht[] = [{ ...basis, id: 'a', status: 'betaald' }, { ...basis, id: 'b', status: 'te_factureren' }, { ...basis, id: 'c', status: 'voorstel_gevraagd', deadline: '2026-09-20' }]
  assert.deepEqual(lijst.sort(sorteer).map((x) => x.id), ['c', 'b', 'a'])
})

test('10. Labels zijn de gevraagde benamingen', () => {
  assert.equal(statusInfo('voorstel_gevraagd').label, 'Projectvoorstel gevraagd')
  assert.equal(statusInfo('voorstel_klaar').label, 'Projectvoorstel klaar')
  assert.equal(statusInfo('interesse').label, 'Interesse')
  assert.equal(statusInfo('geen_interesse').label, 'Geen interesse')
  assert.equal(statusInfo('getekend').label, 'Getekend')
  assert.equal(statusInfo('factuur_verstuurd').label, 'Factuur verstuurd')
  assert.equal(statusInfo('onbekend').key, 'open', 'onbekende waarde valt terug op Nieuw')
})

test('11. Waarde: ingevuld bedrag wint, anders de som van de gekoppelde facturen (excl. btw)', () => {
  const fac = [{ ...f('verstuurd'), amount_excl: 1000 }, { ...f('te_versturen', 'b'), amount_excl: 500 }, { ...f('geannuleerd', 'c'), amount_excl: 999 }]
  assert.deepEqual(waardeVan({ bedrag_excl: 4950, facturen: fac }), { waarde: 4950, bron: 'opdracht' })
  assert.deepEqual(waardeVan({ bedrag_excl: null, facturen: fac }), { waarde: 1500, bron: 'facturen' })
  assert.deepEqual(waardeVan({ bedrag_excl: 0, facturen: fac }), { waarde: 0, bron: 'opdracht' })
  assert.deepEqual(waardeVan({ bedrag_excl: null, facturen: [] }), { waarde: null, bron: null })
})

test('12. Verslag: aantallen en waarde per stuk van de flow', () => {
  const nu = new Date('2026-09-18T10:00:00Z')
  const r = (status: Opdracht['status'], bedrag_excl: number | null, deadline: string | null = null) => ({ status, bedrag_excl, deadline, facturen: [] })
  const v = verslag([
    r('voorstel_gevraagd', 4950), r('interesse', 7950), r('geen_interesse', 3000),
    r('getekend', 14950, '2026-09-10'), r('bezig', null), r('factuur_verstuurd', 1250), r('betaald', 2450), r('geannuleerd', 100), r('afgerond', 800),
  ], nu)
  assert.deepEqual(v.open, { aantal: 5, waarde: 29100, zonderWaarde: 1 })
  assert.deepEqual(v.voorstel, { aantal: 2, waarde: 12900, zonderWaarde: 0 })
  assert.deepEqual(v.contract, { aantal: 1, waarde: 14950, zonderWaarde: 0 })
  assert.deepEqual(v.uitvoering, { aantal: 1, waarde: 0, zonderWaarde: 1 })
  assert.deepEqual(v.facturatie, { aantal: 1, waarde: 1250, zonderWaarde: 0 })
  assert.deepEqual(v.betaald, { aantal: 1, waarde: 2450, zonderWaarde: 0 })
  assert.deepEqual(v.verloren, { aantal: 2, waarde: 3100, zonderWaarde: 0 })
  assert.deepEqual(v.teLaat, { aantal: 1, waarde: 14950, zonderWaarde: 0 })
})

console.log(`\n${n} tests geslaagd`)

// Acceptatietests voor de centrale instellingen (pure logica, geen databank).
// Uitvoeren: npx tsx tests/instellingen.test.ts
import assert from 'node:assert/strict'
import {
  standaardInstellingen, samenvoegen, moduleBeschikbaar, magActie, actieVoorMethode, rolVanStaff, standaardRechten,
  MODULE_INSTELLINGEN_KEY, MODULE_WERKNEMERS_KEY, MODULE_DASHBOARD_KEY, MODULES, ROLLEN,
} from '../lib/instellingen/model'
import {
  valideerOrganisatie, valideerFacturatie, valideerDocumenten, valideerModules, valideerRechten, isGeldigBtw, isGeldigIban,
  bevestigingstekstVerbergen, verschillen, uittreksel,
} from '../lib/instellingen/valideer'
import { maskeerPuur, schoonMetadataPuur } from './hulp-instellingen'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const std = standaardInstellingen()
const hoofd = { rol: 'hoofdbeheerder' as const, modules: null }
const medew = (mods: string[]) => ({ rol: 'medewerker' as const, modules: mods })
const beheer = (mods: string[]) => ({ rol: 'beheerder' as const, modules: mods })
const lezer = (mods: string[]) => ({ rol: 'alleen_lezen' as const, modules: mods })

console.log('Centrale instellingen')

test('1. Standaard = gedrag van vroeger: alles zichtbaar (behalve wat in code uit staat)', () => {
  for (const m of MODULES) assert.equal(std.modules[m.key].zichtbaar, !m.uitgeschakeld, m.key)
  assert.ok(moduleBeschikbaar(std, hoofd, 'invoices'))
  assert.ok(moduleBeschikbaar(std, medew(['invoices']), 'invoices'))
  assert.ok(!moduleBeschikbaar(std, medew(['clients']), 'invoices'), 'werknemer zonder module ziet ze niet')
})

test('2. Globaal verborgen wint van alles — ook voor de hoofdbeheerder (URL/API dicht)', () => {
  const inst = samenvoegen({ modules: { invoices: { zichtbaar: false, rollen: ['hoofdbeheerder', 'beheerder', 'medewerker', 'alleen_lezen'] } } })
  assert.ok(!moduleBeschikbaar(inst, hoofd, 'invoices'))
  assert.ok(!moduleBeschikbaar(inst, medew(['invoices']), 'invoices'))
  assert.ok(!magActie(inst, medew(['invoices']), 'invoices', 'bekijken'))
})

test('3. Instellingen kan nooit globaal verborgen worden', () => {
  const inst = samenvoegen({ modules: { [MODULE_INSTELLINGEN_KEY]: { zichtbaar: false, rollen: [] } } })
  assert.equal(inst.modules[MODULE_INSTELLINGEN_KEY].zichtbaar, true)
  const v = valideerModules({ [MODULE_INSTELLINGEN_KEY]: { zichtbaar: false, rollen: [] } }, std.modules, [])
  assert.ok(!v.ok && /Instellingen/.test(v.fout))
})

test('4. Command Center blijft altijd zichtbaar en bereikbaar', () => {
  const inst = samenvoegen({ modules: { [MODULE_DASHBOARD_KEY]: { zichtbaar: false, rollen: [] } } })
  assert.equal(inst.modules[MODULE_DASHBOARD_KEY].zichtbaar, true)
  assert.ok(moduleBeschikbaar(inst, medew([]), MODULE_DASHBOARD_KEY))
})

test('5. Essentieel tabblad verbergen vereist een bevestiging per tabblad', () => {
  const nieuw = { ...std.modules, invoices: { ...std.modules.invoices, zichtbaar: false } }
  const zonder = valideerModules(nieuw, std.modules, [])
  assert.ok(!zonder.ok && /Facturen/.test(zonder.fout))
  const met = valideerModules(nieuw, std.modules, ['invoices'])
  assert.ok(met.ok && met.waarde.invoices.zichtbaar === false)
  // Weer tonen vraagt geen bevestiging.
  const terug = valideerModules(std.modules, met.ok ? met.waarde : std.modules, [])
  assert.ok(terug.ok)
})

test('6. De bevestigingstekst is exact zoals afgesproken', () => {
  assert.equal(bevestigingstekstVerbergen('Facturen'), 'Weet je zeker dat je het tabblad Facturen wilt verbergen? Het tabblad en de gegevens worden niet verwijderd. Je kunt het later opnieuw activeren via Instellingen.')
})

test('7. Toegang per rol: een rol die niet aangevinkt staat, komt er niet in', () => {
  const inst = samenvoegen({ modules: { invoices: { zichtbaar: true, rollen: ['hoofdbeheerder', 'beheerder'] } } })
  assert.ok(moduleBeschikbaar(inst, beheer(['invoices']), 'invoices'))
  assert.ok(!moduleBeschikbaar(inst, medew(['invoices']), 'invoices'))
  assert.ok(moduleBeschikbaar(inst, hoofd, 'invoices'))
})

test('8. Hoofdbeheerder staat altijd in de rollenlijst, ook als iemand hem probeert weg te halen', () => {
  const inst = samenvoegen({ modules: { clients: { zichtbaar: true, rollen: ['medewerker'] } } })
  assert.ok(inst.modules.clients.rollen.includes('hoofdbeheerder'))
})

test('9. Rechtenmatrix: standaard alleen-lezen mag bekijken en exporteren, niets anders', () => {
  const p = lezer(['invoices'])
  assert.ok(magActie(std, p, 'invoices', 'bekijken'))
  assert.ok(magActie(std, p, 'invoices', 'exporteren'))
  assert.ok(!magActie(std, p, 'invoices', 'toevoegen'))
  assert.ok(!magActie(std, p, 'invoices', 'aanpassen'))
  assert.ok(!magActie(std, p, 'invoices', 'verwijderen'))
})

test('10. HTTP-methode → actie (backend-afdwinging in de middleware)', () => {
  assert.equal(actieVoorMethode('GET', '/api/admin/invoices'), 'bekijken')
  assert.equal(actieVoorMethode('POST', '/api/admin/invoices'), 'toevoegen')
  assert.equal(actieVoorMethode('PATCH', '/api/admin/invoices/1'), 'aanpassen')
  assert.equal(actieVoorMethode('PUT', '/api/admin/invoices/1'), 'aanpassen')
  assert.equal(actieVoorMethode('DELETE', '/api/admin/invoices/1'), 'verwijderen')
  assert.equal(actieVoorMethode('GET', '/api/admin/export/xlsx?dashboard=invoices'), 'exporteren')
})

test('11. Een recht wegnemen werkt meteen door in magActie (medewerker mag dan niet meer verwijderen)', () => {
  const rechten = standaardRechten()
  rechten.medewerker.invoices = ['bekijken', 'toevoegen', 'aanpassen']
  const inst = samenvoegen({ rechten })
  assert.ok(!magActie(inst, medew(['invoices']), 'invoices', 'verwijderen'))
  assert.ok(magActie(inst, medew(['invoices']), 'invoices', 'aanpassen'))
  assert.ok(magActie(inst, hoofd, 'invoices', 'verwijderen'), 'hoofdbeheerder blijft alles mogen')
})

test('12. Hoofdbeheerder-rechten zijn niet te wijzigen via de opgeslagen waarde', () => {
  const inst = samenvoegen({ rechten: { hoofdbeheerder: { invoices: [] } } })
  assert.ok(magActie(inst, hoofd, 'invoices', 'verwijderen'))
})

test('13. Rechten valideren: zonder "bekijken" vervallen de andere acties niet stilletjes — bekijken wordt toegevoegd', () => {
  const r = valideerRechten({ medewerker: { invoices: ['aanpassen'] } })
  assert.ok(r.ok && r.waarde.medewerker.invoices.includes('bekijken') && r.waarde.medewerker.invoices.includes('aanpassen'))
})

test('14. Werknemers is enkel voor hoofdbeheerders; Instellingen enkel voor beheerder mét het recht', () => {
  assert.ok(!moduleBeschikbaar(std, beheer([]), MODULE_WERKNEMERS_KEY))
  assert.ok(moduleBeschikbaar(std, beheer([]), MODULE_INSTELLINGEN_KEY), 'standaard mag een beheerder de instellingen')
  const rechten = standaardRechten(); rechten.beheerder[MODULE_INSTELLINGEN_KEY] = ['bekijken']
  assert.ok(!moduleBeschikbaar(samenvoegen({ rechten }), beheer([]), MODULE_INSTELLINGEN_KEY), 'zonder het recht: geen instellingen')
  assert.ok(!moduleBeschikbaar(std, medew([]), MODULE_INSTELLINGEN_KEY))
})

test('15. Veilige standaard bij kapotte of ontbrekende opslag', () => {
  assert.deepEqual(samenvoegen(null), std)
  assert.deepEqual(samenvoegen({ modules: 'kapot' as unknown as Record<string, unknown>, rechten: 42 as unknown as Record<string, unknown> }), std)
  assert.equal(rolVanStaff('onzin'), 'medewerker')
  assert.equal(rolVanStaff(null), 'medewerker')
  assert.equal(rolVanStaff('beheerder'), 'beheerder')
})

test('16. Bedrijfsgegevens: btw-nummer en IBAN worden echt gecontroleerd', () => {
  assert.ok(isGeldigBtw('BE 0417.497.106'))
  assert.ok(!isGeldigBtw('BE 0417.497.107'))
  assert.ok(isGeldigIban('BE68 5390 0754 7034'))
  assert.ok(!isGeldigIban('BE68 5390 0754 7035'))
  const fout = valideerOrganisatie({ vennootschapsnaam: 'X', btw_nummer: 'BE0000000000' })
  assert.ok(!fout.ok)
  const goed = valideerOrganisatie({ vennootschapsnaam: 'NextGenMedia BV', btw_nummer: 'BE0417497106', iban: 'be68539007547034', email: 'INFO@nextgenmedia.be', betalingstermijn_dagen: '30' })
  assert.ok(goed.ok && goed.waarde.iban === 'BE68 5390 0754 7034' && goed.waarde.email === 'info@nextgenmedia.be')
})

test('17. Facturatie: ClickUp-ids enkel cijfers; de rest netjes begrensd', () => {
  assert.ok(!valideerFacturatie({ clickup_lijst_id: 'abc' }).ok)
  assert.ok(!valideerFacturatie({ standaard_btw_pct: 140 }).ok)
  const v = valideerFacturatie({ clickup_lijst_id: ' 1200340000002297 ', standaard_btw_pct: '21' })
  assert.ok(v.ok && v.waarde.clickup_lijst_id === '1200340000002297' && v.waarde.standaard_btw_pct === 21)
})

test('18. Documenten: kleuren als hex, patroon met {nummer}, logo enkel via de uploadroute', () => {
  assert.ok(!valideerDocumenten({ primaire_kleur: 'geel', secundaire_kleur: '#000000', bestandsnaam_patroon: '{nummer}' }, std.documenten).ok)
  assert.ok(!valideerDocumenten({ primaire_kleur: '#fff848', secundaire_kleur: '#000000', bestandsnaam_patroon: '{type}_{datum}' }, std.documenten).ok)
  assert.ok(!valideerDocumenten({ primaire_kleur: '#fff848', secundaire_kleur: '#000000', bestandsnaam_patroon: '{nummer}/{x}' }, std.documenten).ok)
  const v = valideerDocumenten({ primaire_kleur: '#FFF848', secundaire_kleur: '#111111', bestandsnaam_patroon: '{type}_{nummer}', logo_path: 'hack/pad.png' }, { ...std.documenten, logo_path: 'branding/echt.png' })
  assert.ok(v.ok && v.waarde.logo_path === 'branding/echt.png' && v.waarde.primaire_kleur === '#fff848')
})

test('19. Logboek: enkel gewijzigde velden, en nooit geheimen', () => {
  const velden = verschillen({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, d: 4 })
  assert.deepEqual(velden, ['b', 'c', 'd'])
  assert.deepEqual(uittreksel({ a: 1, b: 9 }, ['b', 'c']), { b: 9, c: null })
  assert.equal(maskeerPuur('sk-ant-api03-abcdef4A2F'), '••••••••4A2F')
  assert.equal(maskeerPuur(''), null)
  const schoon = schoonMetadataPuur({ api_key: 'geheim', naam: 'ok', diep: { wachtwoord: 'x', token: 'y', waarde: 'sk-ant-api03-zzzzzzzzzzzzzzzz' } }) as Record<string, unknown>
  assert.equal(schoon.api_key, '[verborgen]'); assert.equal(schoon.naam, 'ok')
  const diep = schoon.diep as Record<string, unknown>
  assert.equal(diep.wachtwoord, '[verborgen]'); assert.equal(diep.token, '[verborgen]'); assert.equal(diep.waarde, '[verborgen]')
})

test('20. Alle vier rollen bestaan met een label; werknemersrollen zijn beheerder/medewerker/alleen lezen', () => {
  assert.deepEqual(ROLLEN.map((r) => r.key), ['hoofdbeheerder', 'beheerder', 'medewerker', 'alleen_lezen'])
  assert.ok(ROLLEN.every((r) => r.label && r.uitleg))
})

console.log(`\n${n} tests geslaagd`)

// Open punten van het verbeterplan (27 nov 2026): agenda per bedrijf, merkgegevens in mails,
// Meeting boeken per bedrijf, ABM-activiteit per bedrijf en Solutions in de klantapp.
//   npx tsx tests/open-punten.test.ts
import assert from 'node:assert/strict'
import { bedrijfVanItem, enkelBedrijfPerKlant, kleurVan, BEDRIJF_KLEUR, type Item, type Lijst, type Map as AgMap } from '../lib/agenda/model'
import { merkStijl, zetMerkGegevens, netteWebsite, MERK_STIJL } from '../lib/merk-mail'
import { buildEmailHtml, buildEmailText } from '../lib/email-html'
import { teamVoorKlant, teamGroepen } from '../lib/meetings/klantboeking'
import { salesActiviteit } from '../lib/sales/verkoopcijfers'
import { klantZietStories, magKlantGoedkeuren } from '../lib/ngs/levering'
import { pastBijFilter } from '../lib/bedrijven/model'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

const map = (id: string, naam: string, extra: Partial<AgMap> = {}): AgMap => ({ id, space_id: 's', parent_id: null, naam, kleur: null, client_id: null, prive: false, volgorde: 0, clickup_id: null, ...extra })
const lijst = (id: string, map_id: string | null, extra: Partial<Lijst> = {}): Lijst => ({ id, space_id: 's', map_id, naam: 'Lijst', kleur: null, client_id: null, prive: false, volgorde: 0, clickup_id: null, ...extra })
const ctx = {
  labels: {}, klantKleuren: {},
  mappen: {
    m1: map('m1', 'NextGenMedia'), m2: map('m2', 'NextGen Solutions'), m3: map('m3', 'Group Cé', { client_id: 'k1' }),
    m4: map('m4', 'Verheyen', { client_id: 'k2' }), m5: map('m5', 'Sub', { parent_id: 'm6' }), m6: map('m6', 'Klant X', { bedrijf: 'nextgensolutions', client_id: 'k1' }),
  } as Record<string, AgMap>,
  lijsten: { l1: lijst('l1', 'm1'), l2: lijst('l2', 'm2'), l3: lijst('l3', 'm3'), l4: lijst('l4', 'm4'), l5: lijst('l5', 'm5'), l6: lijst('l6', null) } as Record<string, Lijst>,
  klantBedrijf: { k1: 'nextgenmedia' } as Record<string, string>,
}
const item = (lijst_id: string | null, extra: Partial<Item> = {}) => ({ client_id: null, lijst_id, kleur: null, labels: [], clickup_status_kleur: null, status: 'open', bron: 'ag', ...extra }) as Item

test('agenda: bedrijf uit de eigen map, een gekozen bedrijf, de klant of de meeting', () => {
  assert.equal(bedrijfVanItem(item('l1'), ctx), 'nextgenmedia')
  assert.equal(bedrijfVanItem(item('l2'), ctx), 'nextgensolutions')
  assert.equal(bedrijfVanItem(item('l3'), ctx), 'nextgenmedia') // klant enkel bij Media
  assert.equal(bedrijfVanItem(item('l4'), ctx), null) // klant niet gekend: geen gok
  assert.equal(bedrijfVanItem(item('l5'), ctx), 'nextgensolutions') // gekozen op de map erboven gaat voor de klant
  assert.equal(bedrijfVanItem(item('l6'), ctx), null)
  assert.equal(bedrijfVanItem(item(null, { bron: 'meeting', bedrijf: 'nextgensolutions' }), ctx), 'nextgensolutions')
})

test('agenda: een klant telt enkel als hij bij één bedrijf klant is', () => {
  const k = enkelBedrijfPerKlant([
    { client_id: 'a', bedrijf: 'nextgenmedia' }, { client_id: 'a', bedrijf: 'nextgenmedia' },
    { client_id: 'b', bedrijf: 'nextgenmedia' }, { client_id: 'b', bedrijf: 'nextgensolutions' },
    { client_id: 'c', bedrijf: 'algemeen' }, { client_id: null, bedrijf: 'nextgenmedia' },
  ])
  assert.deepEqual(k, { a: 'nextgenmedia' })
})

test('agenda: kleur volgens bedrijf, onbekend grijs; filter laat onbekend altijd staan', () => {
  assert.equal(kleurVan(item('l2'), ctx, 'bedrijf'), BEDRIJF_KLEUR.nextgensolutions)
  assert.equal(kleurVan(item('l4'), ctx, 'bedrijf'), '#e5e7eb')
  assert.equal(pastBijFilter('nextgensolutions', bedrijfVanItem(item('l1'), ctx)), false)
  assert.equal(pastBijFilter('nextgensolutions', bedrijfVanItem(item('l4'), ctx)), true)
})

test('mails: merkgegevens uit de databank in de voet, ongeldige waarden vallen terug', () => {
  zetMerkGegevens({})
  assert.equal(merkStijl('nextgenmedia').adres, MERK_STIJL.nextgenmedia.adres)
  zetMerkGegevens({ nextgenmedia: { adres: 'hallo@nextgenmedia.be', website: 'https://www.nextgenmedia.be/', voettekst: 'BTW BE 1044.961.303' }, nextgensolutions: { adres: 'geen adres', website: 'javascript:alert(1)' } })
  const m = merkStijl('nextgenmedia')
  assert.equal(m.adres, 'hallo@nextgenmedia.be')
  assert.equal(m.website, 'www.nextgenmedia.be')
  assert.equal(m.voettekst, 'BTW BE 1044.961.303')
  assert.equal(m.van, MERK_STIJL.nextgenmedia.van) // de afzender verandert nooit mee
  const s = merkStijl('nextgensolutions')
  assert.equal(s.adres, MERK_STIJL.nextgensolutions.adres)
  assert.equal(s.website, MERK_STIJL.nextgensolutions.website)
  const html = buildEmailHtml({ bodyText: 'Hallo', merk: 'nextgenmedia' })
  assert.ok(html.includes('hallo@nextgenmedia.be') && html.includes('BTW BE 1044.961.303'))
  assert.ok(buildEmailText({ bodyText: 'Hallo', merk: 'nextgenmedia' }).endsWith('BTW BE 1044.961.303'))
  zetMerkGegevens({ nextgenmedia: { voettekst: '<script>x</script>' } })
  assert.ok(!buildEmailHtml({ bodyText: 'x', merk: 'nextgenmedia' }).includes('<script>'))
  zetMerkGegevens({})
  assert.equal(netteWebsite('nextgensolutions.be'), 'nextgensolutions.be')
  assert.equal(netteWebsite('geen site'), null)
})

test('meeting boeken: klant van één bedrijf ziet enkel wie daarbij hoort, anders per bedrijf', () => {
  const team = [{ id: 'b', bedrijven: ['nextgenmedia'] }, { id: 'm', bedrijven: ['nextgensolutions'] }, { id: 'c', bedrijven: [] }]
  assert.deepEqual(teamVoorKlant(team, ['nextgenmedia']).map((t) => t.id), ['b', 'c'])
  assert.deepEqual(teamVoorKlant(team, ['nextgenmedia', 'nextgensolutions']).map((t) => t.id), ['b', 'm', 'c'])
  assert.deepEqual(teamVoorKlant(team, []).map((t) => t.id), ['b', 'm', 'c'])
  const g = teamGroepen(team)
  assert.equal(g.length, 3)
  assert.ok(g[0].titel?.includes('NextGen Media') && g[1].titel?.includes('NextGen Solutions'))
  assert.deepEqual(teamGroepen([{ id: 'x', bedrijven: [] }]), [{ titel: null, leden: [{ id: 'x', bedrijven: [] }] }])
  // Niemand meer over voor dat bedrijf: dan toch iedereen (nooit een lege keuze).
  assert.equal(teamVoorKlant([{ id: 'm', bedrijven: ['nextgensolutions'] }], ['nextgenmedia']).length, 1)
})

test('ABM: gesprekken per bedrijf, zonder bedrijf telt enkel het totaal', () => {
  const a = salesActiviteit([
    { door: 'Bram', uitkomst: 'Gesproken', soort: null, created_at: 'x', bedrijf: 'nextgenmedia' },
    { door: 'Bram', uitkomst: 'Interesse', soort: null, created_at: 'x', bedrijf: 'nextgensolutions' },
    { door: 'Bram', uitkomst: 'Niet opgenomen', soort: null, created_at: 'x' },
  ])
  assert.equal(a[0].gesprekken, 3)
  assert.equal(a[0].media, 1)
  assert.equal(a[0].solutions, 1)
})

test('klantapp Solutions: stories pas zichtbaar vanaf Wacht op akkoord, goedkeuren tot de review', () => {
  assert.equal(klantZietStories('briefing'), false)
  assert.equal(klantZietStories('user_stories'), false)
  assert.equal(klantZietStories('akkoord'), true)
  assert.equal(klantZietStories('care'), true)
  assert.equal(magKlantGoedkeuren('akkoord', { klant_akkoord_op: null }), true)
  assert.equal(magKlantGoedkeuren('review', { klant_akkoord_op: null }), true)
  assert.equal(magKlantGoedkeuren('klaar', { klant_akkoord_op: null }), false)
  assert.equal(magKlantGoedkeuren('akkoord', { klant_akkoord_op: '2026-11-27T10:00:00Z' }), false)
})

console.log(`\n${n} tests geslaagd`)

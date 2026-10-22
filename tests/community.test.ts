// Community management — regels en het parsen van de Metricool-inbox.
//
//   npx tsx tests/community.test.ts

import assert from 'node:assert/strict'
import { antwoordMogelijkTot, statusNaIndelen, verstuurBlokkade, schoneVoorstellen, resterend, magNaarStatus, isOpen, CATEGORIEEN, OPEN_STATUSSEN } from '../lib/community/model'
import { toolsVoor } from '../lib/mcp/content.mjs'
import { COMMUNITY_TOOLS, statusNaIndelen as mjsStatusNaIndelen, CATEGORIEEN as MJS_CATEGORIEEN, OPEN as MJS_OPEN } from '../lib/mcp/community.mjs'
import { STANDAARDREGELS } from '../lib/community/standaardregels'
import { parseCommentThreads, parseGesprekken, merkIdsUitGesprekken, merkIdsUitThreads } from '../lib/metricool-inbox-parse'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nCommunity management\n')

test('Deadline: comment IG/FB +24 u, DM IG/FB +7 d, andere netwerken geen grens', () => {
  assert.equal(antwoordMogelijkTot('comment', 'instagram', '2026-10-22T10:00:00Z'), '2026-10-23T10:00:00.000Z')
  assert.equal(antwoordMogelijkTot('dm', 'facebook', '2026-10-22T10:00:00Z'), '2026-10-29T10:00:00.000Z')
  assert.equal(antwoordMogelijkTot('comment', 'linkedin', '2026-10-22T10:00:00Z'), null)
  assert.equal(antwoordMogelijkTot('comment', 'instagram', null), null)
})

test('Status na indelen volgt de afspraken', () => {
  assert.equal(statusNaIndelen('luchtig', true), 'te_beantwoorden')
  assert.equal(statusNaIndelen('trefwoord', true), 'te_beantwoorden')
  assert.equal(statusNaIndelen('toxisch', true), 'te_beantwoorden')
  assert.equal(statusNaIndelen('vraag', true), 'bij_klant')
  assert.equal(statusNaIndelen('kritiek', true), 'bij_klant')
  assert.equal(statusNaIndelen('kritiek', false), 'te_beantwoorden') // klant keurt niet goed → wij handelen af
  assert.equal(statusNaIndelen('negatief_zonder_inhoud', true), 'genegeerd')
})

test('Versturen weigert bij lege bevestiging, verkeerde status of verlopen deadline', () => {
  const nu = Date.parse('2026-10-22T12:00:00Z')
  const ok = { status: 'te_beantwoorden', antwoord_mogelijk_tot: '2026-10-22T20:00:00Z' }
  assert.equal(verstuurBlokkade(ok, 'Dank je!', 'Chiara', nu), null)
  assert.equal(verstuurBlokkade({ ...ok, status: 'klant_gekozen' }, 'Dank je!', 'Chiara', nu), null)
  assert.match(verstuurBlokkade(ok, 'Dank je!', '  ', nu)!, /bevestigd_door/)
  assert.match(verstuurBlokkade({ ...ok, status: 'bij_klant' }, 'Dank je!', 'Chiara', nu)!, /Bij klant/)
  assert.match(verstuurBlokkade({ ...ok, status: 'verstuurd' }, 'Dank je!', 'Chiara', nu)!, /Verstuurd/)
  assert.match(verstuurBlokkade({ ...ok, antwoord_mogelijk_tot: '2026-10-22T11:59:00Z' }, 'Dank je!', 'Chiara', nu)!, /voorbij/)
  assert.equal(verstuurBlokkade({ ...ok, antwoord_mogelijk_tot: null }, 'Dank je!', 'Chiara', nu), null) // LinkedIn e.d.: geen grens
})

test('Voorstellen: schoongemaakt, max 5, lege weg', () => {
  assert.deepEqual(schoneVoorstellen(['  Top! ', '', { tekst: 'Dank je', toelichting: 'kort' }]), [{ tekst: 'Top!' }, { tekst: 'Dank je', toelichting: 'kort' }])
  assert.equal(schoneVoorstellen(Array(8).fill('x')).length, 5)
  assert.deepEqual(schoneVoorstellen('geen lijst'), [])
})

test('Resterende tijd: rood onder 4 uur', () => {
  const nu = Date.parse('2026-10-22T12:00:00Z')
  assert.deepEqual(resterend('2026-10-22T15:30:00Z', nu), { tekst: '3 u 30 min', dringend: true, voorbij: false })
  assert.equal(resterend('2026-10-23T12:00:00Z', nu)!.dringend, false)
  assert.equal(resterend('2026-10-22T11:00:00Z', nu)!.voorbij, true)
  assert.equal(resterend(null, nu), null)
})

test('Handmatige statuswijzigingen', () => {
  assert.equal(magNaarStatus('nieuw', 'genegeerd'), true)
  assert.equal(magNaarStatus('genegeerd', 'nieuw'), true)
  assert.equal(magNaarStatus('verstuurd', 'nieuw'), false) // verstuurd blijft verstuurd
  assert.equal(magNaarStatus('verlopen', 'genegeerd'), false)
  assert.equal(magNaarStatus('te_beantwoorden', 'bij_klant'), true)
  assert.equal(isOpen('klant_gekozen'), true)
})

test('Standaardregels bestaan als tekst (voorstel, niet in de databank)', () => {
  assert.match(STANDAARDREGELS, /webinar/)
  assert.match(STANDAARDREGELS, /niet op reageren/)
})

// ── Parsen volgens de OpenAPI-spec ──
const thread = {
  id: 't1', provider: 'INSTAGRAM', participants: [{ id: 'merk', name: 'Straight Line' }, { id: 'u1', name: 'Anna' }, { id: 'u2', name: 'Bert' }],
  root: {
    id: 'c1', owner: 'u1', text: 'Waar kan ik me inschrijven voor het webinar?', creationDate: '2026-10-22T09:00:00Z',
    element: { id: 'p1', owner: { id: 'merk', name: 'Straight Line' }, link: 'https://instagram.com/p/1', text: 'Nieuwe training!' },
    comments: [
      { id: 'c2', parentId: 'c1', owner: 'merk', text: 'Via de link in bio!', creationDate: '2026-10-22T09:30:00Z' },
      { id: 'c3', parentId: 'c1', owner: 'u2', text: 'Ik ook graag', creationDate: '2026-10-22T10:00:00Z' },
    ],
  },
}

test('Comments: root + reacties; reactie van het merk wordt niet opgeslagen maar markeert de parent als beantwoord', () => {
  const r = parseCommentThreads([thread], 'instagram')
  assert.deepEqual(r.berichten.map((b) => b.extern_id), ['c1', 'c3'])
  assert.deepEqual(r.alBeantwoord, ['c1'])
  const c1 = r.berichten[0]
  assert.equal(c1.auteur_naam, 'Anna'); assert.equal(c1.post_extern_id, 'p1'); assert.equal(c1.post_url, 'https://instagram.com/p/1')
  assert.equal(c1.post_tekst, 'Nieuwe training!'); assert.equal(c1.parent_extern_id, null)
  assert.equal(r.berichten[1].parent_extern_id, 'c1')
  assert.deepEqual(merkIdsUitThreads([thread]), ['merk'])
})

test('DM: het merk zit in elk gesprek; berichten van het merk tellen niet; eerder bericht met merkantwoord = beantwoord', () => {
  const convs = [
    { id: 'g1', participants: [{ id: 'merk' }, { id: 'u1', name: 'Anna' }], messages: [
      { id: 'm1', from: 'u1', to: 'merk', text: 'Hallo', publicationDateTime: '2026-10-22T08:00:00Z' },
      { id: 'm2', from: 'merk', to: 'u1', text: 'Dag Anna', publicationDateTime: '2026-10-22T08:10:00Z' },
      { id: 'm3', from: 'u1', to: 'merk', text: 'Nog een vraag', publicationDateTime: '2026-10-22T09:00:00Z' },
    ] },
    { id: 'g2', participants: [{ id: 'merk' }, { id: 'u2', name: 'Bert' }], messages: [{ id: 'm4', from: 'u2', to: 'merk', text: 'Hoi', publicationDateTime: '2026-10-22T07:00:00Z' }] },
  ]
  const merk = merkIdsUitGesprekken(convs)
  assert.deepEqual([...merk], ['merk'])
  const r = parseGesprekken(convs, 'instagram', merk)
  assert.deepEqual(r.berichten.map((b) => b.extern_id), ['m1', 'm3', 'm4'])
  assert.deepEqual(r.alBeantwoord, ['m1'])
  assert.equal(r.berichten[1].parent_extern_id, 'g1'); assert.equal(r.berichten[1].ontvanger_id, 'u1')
  // Eén gesprek: het merk is enkel gekend via de comments van hetzelfde merk.
  assert.deepEqual([...merkIdsUitGesprekken([convs[0]], ['merk'])], ['merk'])
  assert.equal(merkIdsUitGesprekken([convs[0]]).size, 0)
})

// ── Vorm zoals live gezien (22 okt 2026): `self`, datums met +0200, geen page-veld ──
test('Live vorm: self = merk, datums naar ISO, merkcomment als root wordt overgeslagen', () => {
  const live = [
    { id: 'r1', self: 'MERK', participants: [{ id: 'ri', name: 'ri' }, { id: 'MERK', name: 'merk' }],
      root: { id: 'r1', owner: 'ri', text: 'Gunther', creationDate: '2026-10-22T06:41:31+0200', element: { id: 'p', owner: { id: 'MERK' }, link: 'https://x' },
        comments: [{ id: 'r2', parentId: 'r1', owner: 'MERK', text: 'Link is verstuurd!', creationDate: '2026-10-22T06:41:41+0200' }] } },
    { id: 'l1', self: 'urn:org', participants: [{ id: 'urn:org', name: 'Inner Stance' }],
      root: { id: 'l1', owner: 'urn:org', text: '👉 link', creationDate: '2026-10-15T14:03:30+0200', element: { id: 'lp', owner: { id: 'urn:org' } }, comments: [] } },
  ]
  const r = parseCommentThreads(live, 'instagram')
  assert.deepEqual(r.berichten.map((b) => b.extern_id), ['r1'])
  assert.equal(r.berichten[0].ontvangen_op, '2026-10-22T04:41:31.000Z')
  assert.deepEqual(r.alBeantwoord, ['r1'])
  const gesprek = [{ id: 'g', self: 'MERK', participants: [{ id: 'k', name: 'ri' }, { id: 'MERK' }], messages: [
    { id: 'a', from: 'k', to: 'MERK', text: 'hoi', publicationDateTime: '2026-10-22T06:00:00+0200' },
    { id: 'b', from: 'MERK', to: 'k', text: '', publicationDateTime: '2026-10-22T06:41:40+0200' },
  ] }]
  const merk = merkIdsUitGesprekken(gesprek)
  assert.ok(merk.has('MERK')) // ook met één gesprek, dankzij self
  const d = parseGesprekken(gesprek, 'instagram', merk)
  assert.deepEqual(d.berichten.map((b) => b.extern_id), ['a'])
  assert.deepEqual(d.alBeantwoord, ['a'])
})

// ── MCP: zichtbaarheid en gelijke regels in .mjs ──
test('MCP: community-tools enkel met schrijven én context (OAuth), nooit via de sleutelroute', () => {
  const ctx = { community: { actor: { userId: 'u', email: 'a@b', naam: 'Test' }, standaardregels: STANDAARDREGELS, verstuur: async () => ({ ok: true }) } }
  const namen = (tools: { name: string }[]) => tools.map((t) => t.name)
  assert.ok(namen(toolsVoor(true, ctx)).includes('community_versturen'))
  assert.ok(!namen(toolsVoor(false, ctx)).some((x: string) => x.startsWith('community_'))) // sleutelroute: magSchrijven false
  assert.ok(!namen(toolsVoor(true, null)).some((x: string) => x.startsWith('community_'))) // lokaal programma: geen context
  const desc = COMMUNITY_TOOLS.find((t: { name: string }) => t.name === 'community_versturen')!.description
  assert.ok(desc.includes('Alleen gebruiken nadat een mens in dit gesprek expliciet heeft bevestigd welke tekst verstuurd wordt. Nooit gebruiken vanuit een scheduled task.'))
})

test('MCP-regels (.mjs) zijn gelijk aan lib/community/model.ts', () => {
  for (const c of CATEGORIEEN) for (const k of [true, false]) assert.equal(mjsStatusNaIndelen(c, k), statusNaIndelen(c, k), `${c}/${k}`)
  assert.deepEqual([...MJS_CATEGORIEEN], [...CATEGORIEEN])
  assert.deepEqual([...MJS_OPEN], [...OPEN_STATUSSEN])
})

console.log(`\n${n} tests geslaagd\n`)

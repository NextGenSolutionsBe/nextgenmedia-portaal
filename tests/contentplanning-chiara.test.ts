import assert from 'node:assert/strict'
import { leesCp, kalenderPuntGeldt, leesMeetingExtra, shootHerinnering, STANDAARD_CP } from '../lib/contentplanning/model'

// Standaard: INN · SLL · K · J als één rij bij Meetings inplannen (samen één klant); twee vervolgstappen in reeks 1.
const cp = leesCp({})
assert.deepEqual(cp.meeting_extra.map((e) => [e.key, e.naam]), [['inn_sll_k_j', 'INN · SLL · K · J']])
assert.deepEqual(cp.reeks_vervolg.map((t) => [t.key, t.reeks]), [['kalender_bram', 1], ['shootbriefing', 1]])
assert.deepEqual(cp.meeting_verborgen, [])
// Wat in de databank staat, gaat voor; onzin valt weg.
const eigen = leesCp({ meeting_verborgen: ['a', 3], meeting_extra: [{ key: 'inn', naam: 'INN', client_id: '58fdd8b5-d9b4-4d22-a385-f29557c1bc96' }, { key: '', naam: 'x' }], reeks_vervolg: [] })
assert.deepEqual(eigen.meeting_verborgen, ['a'])
assert.equal(eigen.meeting_extra.length, 1)
assert.equal(eigen.meeting_extra[0].client_id, '58fdd8b5-d9b4-4d22-a385-f29557c1bc96')
assert.deepEqual(eigen.reeks_vervolg, [])
assert.deepEqual(leesMeetingExtra([{ key: 'k', naam: 'K', client_id: 'geen-uuid' }]), [{ key: 'k', naam: 'K', client_id: null }])
// De werkwijze van reeks 1 en 3 bevat de nieuwe stappen.
assert.match(STANDAARD_CP.reeks_detail[1], /# Contentkalender doorgeven aan Bram/)
assert.match(STANDAARD_CP.reeks_detail[1], /# Shootbriefings opstellen en doorsturen/)
assert.match(STANDAARD_CP.reeks_detail[3], /contentshoot voor de volgende maand vastleggen/)
assert.equal(shootHerinnering('december'), 'Contentshoot voor december vastleggen')

// Aandachtspunten: altijd, één maand of een reeks maanden.
assert.equal(kalenderPuntGeldt({ maand: null }, '2026-12', '2027-02'), true)
assert.equal(kalenderPuntGeldt({ maand: '2026-12' }, '2026-12', '2027-02'), true)
assert.equal(kalenderPuntGeldt({ maand: '2026-12' }, '2027-01', '2027-03'), false)
assert.equal(kalenderPuntGeldt({ maand: '2026-12', tot_maand: '2027-02' }, '2027-01', '2027-03'), true)
assert.equal(kalenderPuntGeldt({ maand: '2026-12', tot_maand: '2027-02' }, '2027-03', '2027-05'), false)
assert.equal(kalenderPuntGeldt({ maand: '2026-12', tot_maand: '2027-02' }, '2026-09', '2026-11'), false)
assert.equal(kalenderPuntGeldt({ maand: '2026-12' }, null, null), true)
console.log('contentplanning-chiara: ok')

// Levering NextGenSolutions (verbeterplan fase 5).
//   npx tsx tests/ngs-levering.test.ts
import assert from 'node:assert/strict'
import {
  PROJECT_FASES, netteBriefing, briefingOntbreekt, LEGE_BRIEFING, tijdscanLeeg, TIJDSCAN_SJABLOON, controleerStory, storyZin,
  nieuweDod, netteDod, waaromNietKlaar, planUitStories, urenStand, planTeLaat, waaromNietNaar, actiepuntenUit,
  controleerCare, volgendeControle, leesLeveringVoorstel, leadSoortVoorstel, type UserStory,
} from '../lib/ngs/levering'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const story = (x: Partial<UserStory>): UserStory => ({ id: 's', project_id: 'p', nummer: 1, titel: 'T', als: '', wil: '', zodat: '', acceptatiecriteria: ['ok'], schatting_uren: 4, bestede_uren: 0, status: 'goedgekeurd', dod: nieuweDod(), klant_akkoord_op: null, klant_akkoord_door: null, volgorde: 1, ...x })

test('fases in de juiste volgorde, van briefing tot care', () => {
  assert.deepEqual(PROJECT_FASES.map((f) => f.key), ['briefing', 'user_stories', 'akkoord', 'bouw', 'review', 'klaar', 'care'])
})

test('briefing: netjes en zegt wat ontbreekt', () => {
  const b = netteBriefing({ doel: ' Sneller offertes ', onbekend: 'x', succes: 'in 5 min' })
  assert.equal(b.doel, 'Sneller offertes')
  assert.deepEqual(briefingOntbreekt(b), ['Hoe het nu gaat', 'Hoe het moet gaan'])
  assert.equal(briefingOntbreekt(LEGE_BRIEFING).length, 4)
})

test('tijdscan: het lege sjabloon telt als leeg', () => {
  assert.equal(tijdscanLeeg(TIJDSCAN_SJABLOON), true)
  assert.equal(tijdscanLeeg(''), true)
  assert.equal(tijdscanLeeg(TIJDSCAN_SJABLOON.replace('Systemen en tools:\n- ', 'Systemen en tools:\n- Teamleader')), false)
})

test('user story: titel verplicht, criteria uit regels, uren per kwartier', () => {
  assert.equal(controleerStory({ titel: '' }).ok, false)
  const c = controleerStory({ titel: 'Offerte uit mail', acceptatiecriteria: '- PDF wordt gelezen\n\n* Klant krijgt concept', schatting_uren: '3,3' })
  assert.ok(c.ok && c.story.acceptatiecriteria.length === 2 && c.story.acceptatiecriteria[0] === 'PDF wordt gelezen' && c.story.schatting_uren === 3.25)
  assert.ok(controleerStory({ titel: 'x', schatting_uren: '-1' }).ok)
  const z = controleerStory({ titel: 'x', schatting_uren: 'veel' })
  assert.ok(z.ok && z.story.schatting_uren === null)
})

test('user story als zin', () => {
  assert.equal(storyZin({ als: 'verkoper', wil: 'een offerte in één klik', zodat: 'ik sneller antwoord' }), 'Als verkoper, wil ik een offerte in één klik, zodat ik sneller antwoord.')
  assert.equal(storyZin({ als: '', wil: '', zodat: '' }), '')
})

test('definitie van klaar: alles afvinken en criteria nodig', () => {
  assert.equal(nieuweDod().length, 5)
  assert.deepEqual(netteDod([{ titel: ' A ', gedaan: true }, { titel: '' }, 'x']), [{ titel: 'A', gedaan: true }])
  assert.ok(waaromNietKlaar({ dod: nieuweDod(), acceptatiecriteria: ['x'] })?.startsWith('Nog af te vinken'))
  assert.equal(waaromNietKlaar({ dod: nieuweDod().map((p) => ({ ...p, gedaan: true })), acceptatiecriteria: ['x'] }), null)
  assert.equal(waaromNietKlaar({ dod: [], acceptatiecriteria: [] }), 'Er staan nog geen acceptatiecriteria bij.')
})

test('plan: enkel goedgekeurde stories tellen, prijs = uren × tarief', () => {
  const s = [story({ schatting_uren: 4 }), story({ schatting_uren: 6, status: 'bouw' }), story({ schatting_uren: 10, status: 'voorstel' }), story({ schatting_uren: null })]
  assert.deepEqual(planUitStories(s, 95), { stories: 3, uren: 10, zonderSchatting: 1, prijs: 950 })
  assert.equal(planUitStories(s, null).prijs, null)
})

test('uren: geschat tegenover besteed', () => {
  assert.deepEqual(urenStand([story({ schatting_uren: 4, bestede_uren: 5 }), story({ schatting_uren: 6, bestede_uren: 2 })]), { geschat: 10, besteed: 7, pct: 70, over: false })
  assert.equal(urenStand([story({ schatting_uren: 2, bestede_uren: 3 })]).over, true)
  assert.equal(urenStand([]).pct, null)
})

test('waarschuwing: 5 dagen na de tijdscan geen plan', () => {
  assert.equal(planTeLaat({ tijdscan_op: '2026-11-20', plan_goedgekeurd_op: null, fase: 'user_stories' }, '2026-11-25'), null)
  assert.equal(planTeLaat({ tijdscan_op: '2026-11-20', plan_goedgekeurd_op: null, fase: 'user_stories' }, '2026-11-27'), 7)
  assert.equal(planTeLaat({ tijdscan_op: '2026-11-20', plan_goedgekeurd_op: '2026-11-22', fase: 'akkoord' }, '2026-11-27'), null)
  assert.equal(planTeLaat({ tijdscan_op: '2026-11-20', plan_goedgekeurd_op: null, fase: 'bouw' }, '2026-11-27'), null)
  assert.equal(planTeLaat({ tijdscan_op: null, plan_goedgekeurd_op: null, fase: 'briefing' }, '2026-11-27'), null)
})

test('fases: briefing eerst, dan stories, plan voor de bouw, alles klaar voor Klaar', () => {
  const p = { fase: 'briefing' as const, briefing_bevestigd_op: null, plan_goedgekeurd_op: null }
  assert.ok(waaromNietNaar(p, 'user_stories', [])?.includes('briefing'))
  const q = { ...p, briefing_bevestigd_op: 'x', fase: 'user_stories' as const }
  assert.equal(waaromNietNaar(q, 'user_stories', []), null)
  assert.ok(waaromNietNaar(q, 'akkoord', [story({ status: 'voorstel' })])?.includes('user story'))
  assert.equal(waaromNietNaar(q, 'akkoord', [story({})]), null)
  assert.ok(waaromNietNaar(q, 'bouw', [story({})])?.includes('plan'))
  const r = { ...q, plan_goedgekeurd_op: 'x', fase: 'review' as const }
  assert.ok(waaromNietNaar(r, 'klaar', [story({ status: 'review' })])?.includes('niet klaar'))
  assert.equal(waaromNietNaar(r, 'klaar', [story({ status: 'klaar' }), story({ status: 'voorstel' })]), null)
  assert.equal(waaromNietNaar(r, 'briefing', []), null, 'terug kan altijd')
})

test('reviewnotities worden actiepunten', () => {
  assert.deepEqual(actiepuntenUit('Algemeen goed\n- Koppeling Teamleader testen\n* Mail naar klant\n[ ] Demo opnemen'), ['Koppeling Teamleader testen', 'Mail naar klant', 'Demo opnemen'])
  assert.deepEqual(actiepuntenUit('Factuur sturen\nok'), ['Factuur sturen'])
})

test('care: nakijken en volgende controle', () => {
  assert.equal(controleerCare({ naam: '' }).ok, false)
  assert.equal(controleerCare({ naam: 'x', maandbedrag: 'veel' }).ok, false)
  const c = controleerCare({ naam: 'Offertebot', systemen: 'Make\nTeamleader', maandbedrag: '79,5', controle_elke_dagen: '30', laatste_controle: '2026-11-01', care_contract: true })
  assert.ok(c.ok && c.care.systemen.length === 2 && c.care.maandbedrag === 79.5 && c.care.status === 'actief')
  assert.deepEqual(volgendeControle({ status: 'actief', controle_elke_dagen: 30, laatste_controle: '2026-10-20' }, '2026-11-27'), { op: '2026-11-19', teLaat: 8 })
  assert.deepEqual(volgendeControle({ status: 'actief', controle_elke_dagen: 30, laatste_controle: '2026-11-20' }, '2026-11-27'), { op: '2026-12-20', teLaat: null })
  assert.deepEqual(volgendeControle({ status: 'gestopt', controle_elke_dagen: 30, laatste_controle: null }, '2026-11-27'), { op: null, teLaat: null })
  assert.deepEqual(volgendeControle({ status: 'actief', controle_elke_dagen: 30, laatste_controle: null }, '2026-11-27'), { op: '2026-11-27', teLaat: 0 })
})

test('AI-voorstel: enkel bruikbare velden en stories', () => {
  const v = leesLeveringVoorstel('hier: {"briefing": {"doel": "Sneller", "onbekend": "x"}, "stories": [{"titel": "A", "acceptatiecriteria": ["x"], "schatting_uren": 3}, {"titel": ""}]}')
  assert.ok(v && v.briefing.doel === 'Sneller' && v.stories.length === 1 && v.stories[0].schatting_uren === 3)
  assert.equal(leesLeveringVoorstel('geen json'), null)
  assert.equal(leesLeveringVoorstel('{"briefing": {}, "stories": []}'), null)
})

test('vesting: voorstel voor de leadsoort, nooit een gok', () => {
  assert.equal(leadSoortVoorstel('nextgensolutions', 'outbound', null), 'outbound')
  assert.equal(leadSoortVoorstel('nextgenmedia', 'inbound', 'Bram'), 'inbound_ngm')
  assert.equal(leadSoortVoorstel('nextgensolutions', 'inbound', 'Marco'), 'inbound_ngs_marco')
  assert.equal(leadSoortVoorstel('nextgensolutions', 'inbound', 'Bram Reinquin'), 'inbound_ngs_bram')
  assert.equal(leadSoortVoorstel('nextgensolutions', 'inbound', 'Gezamenlijke lead'), null)
  assert.equal(leadSoortVoorstel('nextgensolutions', null, 'Marco'), null)
  assert.equal(leadSoortVoorstel(null, 'inbound', 'Marco'), null)
})

console.log(`\n${n} tests geslaagd`)

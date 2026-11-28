import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bouwDagenGeteld, bouwDeadline, bouwTeLaat, wachtStart, wachtStop, nazorgStand, leesZelfCalls, dodVan,
  waaromNietNaarWf, faseWissel, leesLink, projectFaseUitWorkflows, tijdlijnBalken, klantWfLevering, videoMail, type WfLevering,
} from '../lib/ngs/workflow-levering'
import { STANDAARD_WERKING, leesWerking } from '../lib/werking/instellingen'

const L = STANDAARD_WERKING.levering
const wf = (p: Partial<WfLevering> = {}): WfLevering => ({
  id: 'w1', project_id: 'p1', deal_id: 'd1', naam: 'Offertes opmaken', oplossing: 'Generator', maat: 'klein', prijs: 3350, interface_of_logboek: true, volgorde: 1,
  fase: 'gepland', fase_sinds: null, bouw_start: null, wacht_op_klant: false, wacht_reden: null, wacht_sinds: null, wacht_dagen: 0,
  opname_link: null, video_link: null, video_gestuurd_op: null, oplevering_op: null, nazorg_start: null, nazorg_calls: [], klaar_op: null, verantwoordelijke: 'Jonathan', ...p,
})

test('instellingen: levering heeft beginwaarden en kijkt na', () => {
  assert.deepEqual(L, { bouw_dagen: 14, nazorg_weken: 2, nazorg_call_min: 30, verantwoordelijke: 'Jonathan' })
  const x = leesWerking({ levering: { bouw_dagen: '21', nazorg_weken: -1, verantwoordelijke: '<script>' } }).levering
  assert.equal(x.bouw_dagen, 21)
  assert.equal(x.nazorg_weken, 2)
  assert.equal(x.verantwoordelijke, 'Jonathan')
})

test('bouw: 14 dagen, wachten op de klant telt niet mee', () => {
  const w = wf({ fase: 'bouw', bouw_start: '2026-11-01T09:00:00Z' })
  assert.equal(bouwDagenGeteld(w, '2026-11-10'), 9)
  assert.equal(bouwDeadline(w, L), '2026-11-15')
  assert.equal(bouwTeLaat(w, '2026-11-15', L), null)
  assert.equal(bouwTeLaat(w, '2026-11-18', L), 3)
  // 4 dagen gewacht: de deadline schuift 4 dagen op
  const w2 = wf({ fase: 'bouw', bouw_start: '2026-11-01T09:00:00Z', wacht_dagen: 4 })
  assert.equal(bouwDeadline(w2, L), '2026-11-19')
  assert.equal(bouwTeLaat(w2, '2026-11-18', L), null)
  // wacht nu: nooit te laat, en de lopende wachtdagen tellen niet
  const w3 = wf({ fase: 'bouw', bouw_start: '2026-11-01T09:00:00Z', wacht_op_klant: true, wacht_sinds: '2026-11-05T09:00:00Z' })
  assert.equal(bouwTeLaat(w3, '2026-12-20', L), null)
  assert.equal(bouwDagenGeteld(w3, '2026-11-10'), 4)
})

test('wachten: enkel in bouw, met reden; stoppen telt de dagen op', () => {
  assert.equal(wachtStart(wf(), 'logins', 'x').ok, false)
  assert.equal(wachtStart(wf({ fase: 'bouw' }), '', 'x').ok, false)
  const s = wachtStart(wf({ fase: 'bouw' }), '  wachten op   logins ', '2026-11-05T10:00:00Z')
  assert.ok(s.ok && s.patch.wacht_reden === 'wachten op logins' && s.patch.wacht_op_klant)
  const stop = wachtStop(wf({ wacht_op_klant: true, wacht_sinds: '2026-11-05T10:00:00Z', wacht_dagen: 2 }), '2026-11-08T10:00:00Z')
  assert.deepEqual(stop, { wacht_op_klant: false, wacht_sinds: null, wacht_dagen: 5 })
  assert.equal(wachtStop(wf(), 'x'), null)
})

test('nazorg: een week zonder call is te laat, een geplande call niet', () => {
  const w = wf({ fase: 'nazorg', nazorg_start: '2026-11-02T09:00:00Z' })
  assert.equal(nazorgStand(w, [], '2026-11-09', L).teLaat, null)
  assert.equal(nazorgStand(w, [], '2026-11-11', L).teLaat, 2)
  assert.equal(nazorgStand(w, [{ op: '2026-11-14T10:00:00Z' }], '2026-11-11', L).teLaat, null)
  const een = nazorgStand(w, [{ op: '2026-11-06T10:00:00Z' }], '2026-11-12', L)
  assert.equal(een.volgendeTegen, '2026-11-13')
  assert.equal(een.teLaat, null)
  assert.equal(nazorgStand(w, [{ op: '2026-11-06T10:00:00Z' }], '2026-11-15', L).teLaat, 2)
  // twee calls gehouden = nazorg rond
  const rond = nazorgStand(w, [{ op: '2026-11-06' }, { op: '2026-11-13' }], '2026-12-30', L)
  assert.equal(rond.teLaat, null)
  assert.equal(rond.gehouden, 2)
  assert.deepEqual(leesZelfCalls([{ op: '2026-11-06', notitie: ' ok ' }, { op: 'gisteren' }]), [{ op: '2026-11-06', notitie: 'ok' }])
})

test('definitie van klaar en de stappen vooruit', () => {
  const w = wf({ fase: 'oplevering' })
  assert.match(waaromNietNaarWf(w, 'nazorg', []) ?? '', /link naar de opname/)
  const metLinks = wf({ fase: 'oplevering', opname_link: 'https://x.be/o', video_link: 'https://x.be/v' })
  assert.match(waaromNietNaarWf(metLinks, 'nazorg', []) ?? '', /video naar de klant/)
  const gestuurd = { ...metLinks, video_gestuurd_op: '2026-11-20T10:00:00Z' }
  assert.equal(waaromNietNaarWf(gestuurd, 'nazorg', []), null)
  assert.match(waaromNietNaarWf(gestuurd, 'klaar', [{ status: 'bouw' }, { status: 'voorstel' }]) ?? '', /user stories/)
  assert.equal(waaromNietNaarWf(gestuurd, 'klaar', [{ status: 'klaar' }, { status: 'voorstel' }]), null)
  assert.match(waaromNietNaarWf({ ...gestuurd, interface_of_logboek: false }, 'klaar', []) ?? '', /interface/)
  // terug mag altijd
  assert.equal(waaromNietNaarWf(wf({ fase: 'nazorg' }), 'bouw', []), null)
  assert.equal(dodVan(gestuurd, [{ status: 'klaar' }]).every((d) => d.ok), true)
})

test('fase wisselen: datums vooruit, terug wist ze, wachten stopt', () => {
  const nu = '2026-11-10T09:00:00Z'
  const p = faseWissel(wf(), 'bouw', nu)
  assert.equal(p.bouw_start, nu)
  assert.equal(p.fase, 'bouw')
  const w = wf({ fase: 'bouw', bouw_start: '2026-11-01T09:00:00Z', wacht_op_klant: true, wacht_sinds: '2026-11-08T09:00:00Z' })
  const naar = faseWissel(w, 'oplevering', nu)
  assert.equal(naar.oplevering_op, nu)
  assert.equal(naar.wacht_op_klant, false)
  assert.equal(naar.wacht_dagen, 2)
  const terug = faseWissel(wf({ fase: 'nazorg', bouw_start: 'a', oplevering_op: 'b', nazorg_start: 'c' }), 'bouw', nu)
  assert.equal(terug.oplevering_op, null)
  assert.equal(terug.nazorg_start, null)
  assert.equal(terug.bouw_start, undefined)
})

test('links: enkel http(s)', () => {
  assert.deepEqual(leesLink(''), { ok: true, link: null })
  assert.equal(leesLink('javascript:alert(1)').ok, false)
  assert.equal(leesLink('https://www.loom.com/share/abc').ok, true)
})

test('het project volgt de vroegste workflow die loopt', () => {
  assert.equal(projectFaseUitWorkflows([], 'briefing'), null)
  assert.equal(projectFaseUitWorkflows([{ fase: 'gepland', volgorde: 1 }], 'akkoord'), null)
  assert.equal(projectFaseUitWorkflows([{ fase: 'nazorg', volgorde: 1 }, { fase: 'bouw', volgorde: 2 }], 'akkoord'), 'review')
  assert.equal(projectFaseUitWorkflows([{ fase: 'klaar', volgorde: 1 }, { fase: 'bouw', volgorde: 2 }], 'review'), 'bouw')
  assert.equal(projectFaseUitWorkflows([{ fase: 'klaar', volgorde: 1 }], 'bouw'), 'klaar')
  assert.equal(projectFaseUitWorkflows([{ fase: 'klaar', volgorde: 1 }], 'care'), null)
})

test('tijdlijn: balken in procenten, overlap zichtbaar', () => {
  const t = tijdlijnBalken([
    { id: 'a', naam: 'A', fase: 'nazorg', bouw_start: '2026-11-01T09:00:00Z', klaar_op: null, volgorde: 1 },
    { id: 'b', naam: 'B', fase: 'bouw', bouw_start: '2026-11-11T09:00:00Z', klaar_op: null, volgorde: 2 },
    { id: 'c', naam: 'C', fase: 'gepland', bouw_start: null, klaar_op: null, volgorde: 3 },
  ], '2026-11-20')
  assert.ok(t)
  assert.equal(t!.balken.length, 2)
  assert.equal(t!.balken[0].links, 0)
  assert.equal(t!.balken[0].breedte, 100)
  assert.equal(t!.balken[1].links, 50)
  assert.equal(tijdlijnBalken([{ id: 'c', naam: 'C', fase: 'gepland', bouw_start: null, klaar_op: null, volgorde: 1 }], '2026-11-20'), null)
})

test('klant ziet nooit prijs, uren of wie bouwt', () => {
  const k = klantWfLevering(wf({ fase: 'bouw', video_link: 'https://x.be/v', wacht_reden: 'intern: logins Marco' }))
  assert.deepEqual(Object.keys(k).sort(), ['faseLabel', 'fase', 'id', 'naam', 'oplossing', 'uitleg', 'video', 'wachtOpJou'].sort())
  assert.equal(k.video, null)
  const tekst = JSON.stringify(klantWfLevering(wf({ fase: 'nazorg', wacht_op_klant: true, wacht_reden: 'intern', video_link: 'https://x.be/v', video_gestuurd_op: 'x' })))
  assert.ok(!tekst.includes('3350') && !tekst.includes('Jonathan') && !tekst.includes('intern'))
})

test('videomail: een voorstel, nazorg enkel als die er is', () => {
  const m = videoMail({ naam: 'Offertes opmaken', nazorgWeken: 2, afzender: 'Jonathan' })
  assert.match(m.tekst, /bellen we je/)
  assert.match(m.tekst, /\[voornaam\]/)
  assert.doesNotMatch(videoMail({ naam: 'X', nazorgWeken: 0, afzender: null }).tekst, /bellen/)
})

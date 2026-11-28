// Nieuwe werking fase 2: verkoop bij Solutions (fases, auditprijs, audit, belpogingen, vervolgafspraak, Projecten).
//   npx tsx tests/ngs-verkoop.test.ts
import assert from 'node:assert/strict'
import { FASES, OPEN_FASES, isOpvolgFase, controleerAudit, volgendeBelDatum, vervolgVan, vervolgOntbreekt, leesChecklist, presentatieMinuten, verplaatsing } from '../lib/ngs/model'
import { auditPrijs, STANDAARD_WERKING, leesWerking } from '../lib/werking/instellingen'
import { faseVoorKaart } from '../lib/sales/solutions-kaarten'
import { wordtSolutions } from '../lib/opdrachten-kanban'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const V = STANDAARD_WERKING.verkoop
const regels = { max_processen: V.max_processen, presentatie_max_dagen: V.presentatie_max_dagen, prijs: (k: number) => auditPrijs(k, V) }

test('zeven fases in de juiste volgorde, de oude sleutels blijven', () => {
  assert.deepEqual(FASES.map((f) => f.key), ['afspraak', 'voorstel', 'opvolgen', 'audit', 'opvolgen_rapport', 'won', 'lost'])
  assert.equal(FASES.find((f) => f.key === 'voorstel')!.label, 'Voorstel')
  assert.equal(FASES.find((f) => f.key === 'opvolgen')!.label, 'Opvolgen voorstel')
  assert.deepEqual(OPEN_FASES, ['afspraak', 'voorstel', 'opvolgen', 'audit', 'opvolgen_rapport'])
  assert.ok(isOpvolgFase('opvolgen') && isOpvolgFase('opvolgen_rapport') && !isOpvolgFase('audit'))
  assert.equal(verplaatsing({ start_datum: null }, 'audit', {}, '2026-11-28', 'x').ok, true)
})

test('auditprijs: € 450 + € 295 per proces (instellingen)', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((k) => auditPrijs(k, V)), [745, 1040, 1335, 1630, 1925])
  const ander = leesWerking({ verkoop: { audit_basis: 500, audit_per_proces: 300 } }).verkoop
  assert.equal(auditPrijs(2, ander), 1100)
})

test('naar Audit: alles verplicht, presentatie na de auditdag, te laat = waarschuwing', () => {
  const ok = controleerAudit({ processen: 3, audit_buiten_app: true, auditdag_op: '2026-12-08', presentatie_op: '2026-12-12' }, regels)
  assert.ok(ok.ok && ok.audit.audit_prijs === 1335 && ok.waarschuwing === null && ok.audit.audit_buiten_app)
  const laat = controleerAudit({ processen: 1, audit_contract_id: '00000000-0000-0000-0000-000000000001', auditdag_op: '2026-12-08', presentatie_op: '2026-12-20' }, regels)
  assert.ok(laat.ok && laat.waarschuwing && laat.waarschuwing.includes('12 dagen') && !laat.audit.audit_buiten_app)
  assert.equal(controleerAudit({ processen: 6, audit_buiten_app: true, auditdag_op: '2026-12-08', presentatie_op: '2026-12-09' }, regels).ok, false)
  assert.equal(controleerAudit({ processen: 2, auditdag_op: '2026-12-08', presentatie_op: '2026-12-09' }, regels).ok, false) // geen getekend voorstel
  assert.equal(controleerAudit({ processen: 2, audit_buiten_app: true, presentatie_op: '2026-12-09' }, regels).ok, false) // geen auditdag
  assert.equal(controleerAudit({ processen: 2, audit_buiten_app: true, auditdag_op: '2026-12-08', presentatie_op: '2026-12-07' }, regels).ok, false) // vóór de auditdag
})

test('belpoging: volgende opvolging 7 dagen later, nooit in het weekend', () => {
  assert.equal(volgendeBelDatum('2026-11-30', 7), '2026-12-07') // ma → ma
  assert.equal(volgendeBelDatum('2026-12-05', 7), '2026-12-14') // za + 7 = za → maandag
  assert.equal(volgendeBelDatum('2026-12-06', 7), '2026-12-14') // zo + 7 = zo → maandag
  assert.equal(volgendeBelDatum('2026-12-01', 3), '2026-12-04')
})

test('vervolgafspraak: meeting gaat voor, zonder (of voorbij) = gele waarschuwing in Voorstel', () => {
  assert.equal(vervolgVan({ vervolg_op: '2026-12-04T13:00:00Z' }, { starts_at: '2026-12-05T09:00:00Z' }), '2026-12-05T09:00:00Z')
  assert.equal(vervolgVan({ vervolg_op: '2026-12-04T13:00:00Z' }, null), '2026-12-04T13:00:00Z')
  const nu = '2026-11-28T10:00:00Z'
  assert.equal(vervolgOntbreekt({ fase: 'voorstel' }, null, nu), true)
  assert.equal(vervolgOntbreekt({ fase: 'voorstel' }, '2026-11-01T10:00:00Z', nu), true)
  assert.equal(vervolgOntbreekt({ fase: 'voorstel' }, '2026-12-04T13:00:00Z', nu), false)
  assert.equal(vervolgOntbreekt({ fase: 'afspraak' }, null, nu), false)
})

test('checklist en presentatieduur', () => {
  assert.deepEqual(leesChecklist({ rapport: '2026-12-10T10:00:00Z', raar: 'x' }), { auditdag: null, briefing: null, rapport: '2026-12-10T10:00:00Z', presentatie: null })
  assert.equal(presentatieMinuten(3, 10), 30)
  assert.equal(presentatieMinuten(null, 10), 10)
})

test('Solutions-kaarten: fase uit de status, nooit vanzelf Audit', () => {
  assert.equal(faseVoorKaart('open'), 'afspraak')
  assert.equal(faseVoorKaart('voorstel_voorgelegd'), 'opvolgen')
  assert.equal(faseVoorKaart('bezig'), 'won')
  assert.equal(faseVoorKaart('geen_interesse'), 'lost')
  assert.ok(!['audit', 'opvolgen_rapport'].includes(faseVoorKaart('interesse')))
})

test('Projecten: een kaart kan geen Solutions worden, wat het al was blijft', () => {
  assert.equal(wordtSolutions(null, { merk: 'nextgensolutions', diensten: [] }), true)
  assert.equal(wordtSolutions(null, { merk: null, diensten: ['ngs'] }), true)
  assert.equal(wordtSolutions(null, { merk: 'nextgenmedia', diensten: ['social'] }), false)
  assert.equal(wordtSolutions({ merk: 'nextgenmedia', diensten: [] }, { merk: 'nextgensolutions' }), true)
  assert.equal(wordtSolutions({ merk: 'nextgensolutions', diensten: [] }, { diensten: ['ngs'] }), false)
})

console.log(`\n${n} tests geslaagd`)

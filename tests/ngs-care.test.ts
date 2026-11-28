import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pakketVan, volgendPakket, werkdagUren, reactieLabel, opslagStand, opslagMelding, urenDezeMaand, deadlineNaWerkuren,
  supportStatus, monitoringAlarm, leesOverdracht, leesCareLinks,
} from '../lib/ngs/care'
import { STANDAARD_WERKING, leesWerking } from '../lib/werking/instellingen'

const C = STANDAARD_WERKING.care

test('pakketten: voorstel uit de opdracht, nog te bevestigen', () => {
  assert.deepEqual(C.pakketten.map((p) => [p.naam, p.prijs, p.db_gb, p.bestanden_gb, p.uren_per_maand, p.monitoring]), [
    ['Basis', 59, 2, 10, 0, false], ['Plus', 149, 5, 50, 1, false], ['Pro', 349, 8, 100, 3, true],
  ])
  assert.equal(C.bevestigd, false)
  assert.equal(reactieLabel(pakketVan('basis', C)!.reactie_werkuren, C), '2 werkdagen')
  assert.equal(reactieLabel(pakketVan('plus', C)!.reactie_werkuren, C), '1 werkdag')
  assert.equal(reactieLabel(pakketVan('pro', C)!.reactie_werkuren, C), '4 werkuren')
  assert.equal(werkdagUren(C), 8)
  assert.equal(volgendPakket('basis', C)?.key, 'plus')
  assert.equal(volgendPakket('pro', C), null)
  // aanpassen in Instellingen
  const x = leesWerking({ care: { pakketten: [{ key: 'plus', prijs: '169' }], werkdag_van: '18:00', werkdag_tot: '09:00', bevestigd: true } }).care
  assert.equal(pakketVan('plus', x)!.prijs, 169)
  assert.equal(x.werkdag_van, '09:00')
  assert.equal(x.bevestigd, true)
})

test('opslag: 85% van de limiet = melding met het voorstel om te upgraden', () => {
  const s = opslagStand({ db_gb: 1.7, bestanden_gb: 3 }, pakketVan('basis', C), C)
  assert.ok(s)
  assert.equal(s!.db.pct, 85)
  assert.equal(s!.waarschuwing, true)
  assert.equal(s!.voorstel?.naam, 'Plus')
  assert.match(opslagMelding('Offertes', s) ?? '', /85% van de databank .* Stel Plus voor/)
  const ok = opslagStand({ db_gb: 1, bestanden_gb: 3 }, pakketVan('basis', C), C)
  assert.equal(ok!.waarschuwing, false)
  assert.equal(opslagMelding('x', ok), null)
  assert.match(opslagMelding('x', opslagStand({ db_gb: 7.5, bestanden_gb: 1 }, pakketVan('pro', C), C)) ?? '', /hoogste pakket/)
})

test('uren: elke eerste van de maand opnieuw, niets schuift door', () => {
  const rijen = [{ datum: '2026-11-03', uren: 1 }, { datum: '2026-11-20', uren: 1.5 }, { datum: '2026-10-30', uren: 2 }]
  const nov = urenDezeMaand(rijen, '2026-11-28', pakketVan('pro', C))
  assert.deepEqual(nov, { gebruikt: 2.5, beschikbaar: 3, resterend: 0.5, over: false })
  const dec = urenDezeMaand(rijen, '2026-12-01', pakketVan('pro', C))
  assert.deepEqual(dec, { gebruikt: 0, beschikbaar: 3, resterend: 3, over: false })
  assert.equal(urenDezeMaand([{ datum: '2026-11-03', uren: 2 }], '2026-11-28', pakketVan('plus', C)).over, true)
})

test('reactietijd in werkuren, Belgische tijd', () => {
  // vrijdag 27 nov 2026 16:00 Brussel (15:00 UTC) + 4 werkuren = maandag 30 nov 12:00 Brussel (11:00 UTC)
  assert.equal(deadlineNaWerkuren('2026-11-27T15:00:00Z', 4, C), '2026-11-30T11:00:00.000Z')
  // zaterdag binnen = maandag 9:00 + 8 uur = maandag 17:00
  assert.equal(deadlineNaWerkuren('2026-11-28T10:00:00Z', 8, C), '2026-11-30T16:00:00.000Z')
  // zomertijd: dinsdag 2 juni 2026 10:00 Brussel (08:00 UTC) + 16 werkuren = donderdag 4 juni 10:00 (08:00 UTC)
  assert.equal(deadlineNaWerkuren('2026-06-02T08:00:00Z', 16, C), '2026-06-04T08:00:00.000Z')
  const nu = new Date('2026-11-30T10:00:00Z')
  assert.equal(supportStatus({ deadline: '2026-11-30T11:00:00Z', opgelost_op: null }, nu).status, 'bijna')
  assert.equal(supportStatus({ deadline: '2026-11-30T09:00:00Z', opgelost_op: null }, nu).status, 'te_laat')
  assert.equal(supportStatus({ deadline: '2026-12-02T09:00:00Z', opgelost_op: null }, nu).status, 'loopt')
  assert.equal(supportStatus({ deadline: '2026-11-30T09:00:00Z', opgelost_op: 'x' }, nu).status, 'opgelost')
})

test('monitoring: twee mislukte checks na elkaar = alarm', () => {
  assert.equal(monitoringAlarm([{ ok: false }, { ok: false }, { ok: true }]), true)
  assert.equal(monitoringAlarm([{ ok: false }, { ok: true }]), false)
  assert.equal(monitoringAlarm([{ ok: false }]), false)
})

test('overdracht en links', () => {
  assert.deepEqual(leesOverdracht({ vercel: { op: '2026-11-28', door: 'Marco' }, raar: { op: 'x' } }), { vercel: { op: '2026-11-28', door: 'Marco' } })
  const l = leesCareLinks({ vercel_url: 'https://vercel.com/team/app', supabase_ref: 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst', github_url: '' })
  assert.ok(l.ok && l.waarde.supabase_ref === 'abcdefghijklmnopqrst' && l.waarde.github_url === null)
  assert.equal(leesCareLinks({ monitor_url: 'javascript:alert(1)' }).ok, false)
})

test('monitoring vraagt enkel publieke https-adressen op', async () => {
  const { veiligeMonitorUrl } = await import('../lib/ngs/care')
  assert.equal(veiligeMonitorUrl('https://app.klant.be/api/health'), true)
  for (const x of ['http://app.klant.be', 'https://localhost/x', 'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.1', 'https://169.254.169.254/latest', 'https://intern', 'https://user:pw@klant.be', 'https://[::1]/']) assert.equal(veiligeMonitorUrl(x), false, x)
})

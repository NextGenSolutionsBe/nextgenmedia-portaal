// Tweestapsverificatie met een authenticator-app (TOTP) — alle regels.
//
//   npx tsx tests/twofa.test.ts
//
// De kern (lib/twofa/kern.ts) draait hier tegen een opslag in het geheugen met
// DEZELFDE atomische voorwaarden als de Supabase-opslag ("enkel als nog niet
// gebruikt"). De middleware-beslissing en de sessiecontrole zijn pure functies.

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  bevestigSetup, controleerFactor, FOUT_CODE, FOUT_HERBEVESTIGING, FOUT_TE_VEEL, nieuweHerstelcodes,
  resetVoorAnder, schakelUit, startSetup, type Kern, type TotpRij, type TwofaOpslag,
} from '../lib/twofa/kern'
import { codeVoor, controleerTotp, otpauthUri, TOTP_PERIODE } from '../lib/twofa/totp'
import { genereerHerstelcodes, hashHerstelcode, leesSleutel, normaliseerHerstelcode, ontsleutel, versleutel } from '../lib/twofa/geheimen'
import { sessieIdUitToken, sessieStatus, tweedeStapActie, appVerplichtVoor, SESSIE_TTL_MS, type SessieRij } from '../lib/twofa/sessie'
import { twoFactorRequired } from '../lib/two-factor'

let n = 0
const test = async (naam: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log(`  ✓ ${naam}`) }

// ── Opslag in het geheugen (zelfde voorwaarden als lib/twofa/server.ts) ──
function geheugenOpslag() {
  const totp = new Map<string, TotpRij>()
  const codes: { user_id: string; code_hash: string; gebruikt_op: string | null }[] = []
  const opslag: TwofaOpslag = {
    async lees(u) { const r = totp.get(u); return r ? { ...r } : null },
    async bewaarSetup(u, enc, op) {
      const r = totp.get(u)
      if (r?.actief) return false
      totp.set(u, { user_id: u, secret_enc: r?.secret_enc ?? null, actief: false, geactiveerd_op: null, laatste_stap: null, setup_secret_enc: enc, setup_gestart_op: op })
      return true
    },
    async activeer(u, enc, stap, op) {
      const r = totp.get(u)
      if (!r || r.actief || r.setup_secret_enc !== enc) return false
      totp.set(u, { ...r, secret_enc: enc, actief: true, geactiveerd_op: op, laatste_stap: stap, setup_secret_enc: null, setup_gestart_op: null })
      return true
    },
    async claimStap(u, stap) {
      const r = totp.get(u)
      if (!r?.actief || (r.laatste_stap !== null && r.laatste_stap >= stap)) return false
      r.laatste_stap = stap
      return true
    },
    async verwijder(u) { totp.delete(u) },
    async vervangHerstelcodes(u, hashes) {
      for (let i = codes.length - 1; i >= 0; i--) if (codes[i].user_id === u) codes.splice(i, 1)
      for (const h of hashes) codes.push({ user_id: u, code_hash: h, gebruikt_op: null })
    },
    async gebruikHerstelcode(u, h, op) {
      const c = codes.find((x) => x.user_id === u && x.code_hash === h && x.gebruikt_op === null)
      if (!c) return false
      c.gebruikt_op = op
      return true
    },
    async aantalHerstelcodes(u) { return codes.filter((x) => x.user_id === u && !x.gebruikt_op).length },
  }
  return { opslag, totp, codes }
}

/** Limiet in het geheugen: telt pogingen per sleutel binnen het venster. */
function geheugenLimiet(nu: () => number) {
  const hits = new Map<string, number[]>()
  return async (k: string, limiet: number, sec: number) => {
    const t = nu(), lijst = (hits.get(k) ?? []).filter((x) => x > t - sec * 1000)
    if (lijst.length >= limiet) { hits.set(k, lijst); return false }
    lijst.push(t); hits.set(k, lijst); return true
  }
}

function maakOmgeving() {
  let klok = Date.parse('2026-09-27T10:00:00Z')
  const g = geheugenOpslag()
  const sleutel = randomBytes(32)
  const kern: Kern = { opslag: g.opslag, sleutel, nu: () => klok, limiet: geheugenLimiet(() => klok) }
  return {
    kern, ...g, sleutel,
    tik: (sec: number) => { klok += sec * 1000 },
    nu: () => klok,
  }
}

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

/** Volledige activatie; geeft het geheim + de herstelcodes terug. */
async function activeer(o: ReturnType<typeof maakOmgeving>, user = A) {
  const s = await startSetup(o.kern, user, 'test@nextgen.be')
  assert.ok(s.ok)
  const r = await bevestigSetup(o.kern, user, codeVoor(s.geheim, o.nu()))
  assert.ok(r.ok, JSON.stringify(r))
  o.tik(TOTP_PERIODE) // volgende tijdstap, zodat een nieuwe code geen replay is
  return { geheim: s.geheim, herstelcodes: r.herstelcodes }
}

async function main() {
  console.log('\nTweestapsverificatie (TOTP)\n')

  await test('1. Normale login zonder app-2FA: geen app-factor, mailcode-pad; vrijgesteld account = door', async () => {
    const o = maakOmgeving()
    const r = await controleerFactor(o.kern, A, { code: '123456' })
    assert.equal(r.ok, false) // zonder actieve app bestaat er geen app-factor → route gebruikt de mailcode
    assert.equal(tweedeStapActie('nodig', false, '/admin'), 'door')      // login_settings: vrijgesteld
    assert.equal(tweedeStapActie('nodig', true, '/admin'), 'verificatie') // standaard: code verplicht
  })

  await test('2. Correcte 2FA-login met de app (standaard otpauth-URI, 6 cijfers, 30 s)', async () => {
    const o = maakOmgeving()
    const { geheim } = await activeer(o)
    const uri = otpauthUri(geheim, 'bram@nextgenmedia.be')
    assert.match(uri, /^otpauth:\/\/totp\/NextGen:bram%40nextgenmedia\.be\?/)
    assert.match(uri, /issuer=NextGen/); assert.match(uri, /digits=6/); assert.match(uri, /period=30/)
    const r = await controleerFactor(o.kern, A, { code: codeVoor(geheim, o.nu()) })
    assert.deepEqual(r, { ok: true, methode: 'totp' })
  })

  await test('3. Verkeerde TOTP-code → vage melding', async () => {
    const o = maakOmgeving()
    const { geheim } = await activeer(o)
    const juist = codeVoor(geheim, o.nu())
    const fout = String((Number(juist) + 1) % 1_000_000).padStart(6, '0')
    const r = await controleerFactor(o.kern, A, { code: fout })
    assert.deepEqual(r, { ok: false, fout: FOUT_CODE, status: 400 })
    assert.equal((await controleerFactor(o.kern, A, { code: '12ab56' })).ok, false)
  })

  await test('4. Verlopen code (2 minuten oud) geweigerd; klokverschil van 1 stap aanvaard', async () => {
    const o = maakOmgeving()
    const { geheim } = await activeer(o)
    const oud = codeVoor(geheim, o.nu() - 120_000)
    assert.equal(controleerTotp(geheim, oud, o.nu()), null)
    assert.equal((await controleerFactor(o.kern, A, { code: oud })).ok, false)
    const netVorige = codeVoor(geheim, o.nu() - TOTP_PERIODE * 1000)
    assert.notEqual(controleerTotp(geheim, netVorige, o.nu()), null)
  })

  await test('   Replay: dezelfde code twee keer binnen hetzelfde venster → tweede keer geweigerd', async () => {
    const o = maakOmgeving()
    const { geheim } = await activeer(o)
    const code = codeVoor(geheim, o.nu())
    assert.equal((await controleerFactor(o.kern, A, { code })).ok, true)
    assert.equal((await controleerFactor(o.kern, A, { code })).ok, false)
    // Een oudere (nog in het venster) code na een nieuwere → ook geweigerd.
    o.tik(TOTP_PERIODE)
    const nieuw = codeVoor(geheim, o.nu())
    assert.equal((await controleerFactor(o.kern, A, { code: nieuw })).ok, true)
    assert.equal((await controleerFactor(o.kern, A, { code })).ok, false)
  })

  await test('5. Herstelcode gebruiken in plaats van een app-code (ook met spaties/kleine letters)', async () => {
    const o = maakOmgeving()
    const { herstelcodes } = await activeer(o)
    assert.equal(herstelcodes.length, 8)
    const r = await controleerFactor(o.kern, A, { herstelcode: herstelcodes[0].toLowerCase().replace(/-/g, ' ') })
    assert.deepEqual(r, { ok: true, methode: 'herstelcode', herstelcodesOver: 7 })
  })

  await test('6. Herstelcode twee keer → tweede keer ongeldig', async () => {
    const o = maakOmgeving()
    const { herstelcodes } = await activeer(o)
    assert.equal((await controleerFactor(o.kern, A, { herstelcode: herstelcodes[1] })).ok, true)
    assert.deepEqual(await controleerFactor(o.kern, A, { herstelcode: herstelcodes[1] }), { ok: false, fout: FOUT_CODE, status: 400 })
  })

  await test('   Herstelcodes staan enkel gehasht opgeslagen; TOTP-geheim enkel versleuteld', async () => {
    const o = maakOmgeving()
    const { geheim, herstelcodes } = await activeer(o)
    const opgeslagen = JSON.stringify([...o.totp.values(), o.codes])
    assert.ok(!opgeslagen.includes(geheim), 'geheim staat leesbaar in de opslag')
    for (const c of herstelcodes) {
      assert.ok(!opgeslagen.includes(c) && !opgeslagen.includes(c.replace(/-/g, '')), 'herstelcode staat leesbaar in de opslag')
    }
    const rij = o.totp.get(A)!
    assert.equal(ontsleutel(o.sleutel, rij.secret_enc!), geheim)
    assert.throws(() => ontsleutel(randomBytes(32), rij.secret_enc!)) // andere sleutel → onleesbaar
    assert.equal(leesSleutel('te-kort'), null)
    assert.equal(leesSleutel(randomBytes(32).toString('base64'))?.length, 32)
  })

  await test('7. 2FA activeren zonder (geldige) verificatiecode → blijft niet actief', async () => {
    const o = maakOmgeving()
    const s = await startSetup(o.kern, A, 'a@x.be'); assert.ok(s.ok)
    assert.equal((await bevestigSetup(o.kern, A, '')).ok, false)
    assert.equal((await bevestigSetup(o.kern, A, '000000')).ok || codeVoor(s.geheim, o.nu()) === '000000', false)
    assert.equal(o.totp.get(A)!.actief, false)
    assert.equal((await controleerFactor(o.kern, A, { code: codeVoor(s.geheim, o.nu()) })).ok, false) // setup ≠ actief
    // Setup-QR verloopt na 15 minuten.
    o.tik(16 * 60)
    assert.equal((await bevestigSetup(o.kern, A, codeVoor(s.geheim, o.nu()))).ok, false)
  })

  await test('   Setup-QR hergebruiken: een nieuwe setup maakt de vorige ongeldig; na activeren geen nieuwe setup', async () => {
    const o = maakOmgeving()
    const s1 = await startSetup(o.kern, A, 'a@x.be'); assert.ok(s1.ok)
    const s2 = await startSetup(o.kern, A, 'a@x.be'); assert.ok(s2.ok)
    assert.notEqual(s1.geheim, s2.geheim)
    const oud = codeVoor(s1.geheim, o.nu())
    if (oud !== codeVoor(s2.geheim, o.nu())) assert.equal((await bevestigSetup(o.kern, A, oud)).ok, false)
    assert.equal((await bevestigSetup(o.kern, A, codeVoor(s2.geheim, o.nu()))).ok, true)
    const s3 = await startSetup(o.kern, A, 'a@x.be')
    assert.deepEqual(s3, { ok: false, fout: 'Tweestapsverificatie met een app is al actief.', status: 409 })
  })

  await test('8. 2FA uitschakelen zonder (juist) wachtwoord → geweigerd, geen herstelcode verbruikt', async () => {
    const o = maakOmgeving()
    const { geheim, herstelcodes } = await activeer(o)
    const r = await schakelUit(o.kern, A, { wachtwoordOk: false, code: codeVoor(geheim, o.nu()) })
    assert.deepEqual(r, { ok: false, fout: FOUT_HERBEVESTIGING, status: 400 })
    const r2 = await schakelUit(o.kern, A, { wachtwoordOk: false, herstelcode: herstelcodes[0] })
    assert.equal(r2.ok, false)
    assert.equal(await o.opslag.aantalHerstelcodes(A), 8)
    assert.equal(o.totp.get(A)!.actief, true)
  })

  await test('9. 2FA uitschakelen zonder tweede factor → geweigerd; mét → uit en alles gewist', async () => {
    const o = maakOmgeving()
    const { geheim } = await activeer(o)
    assert.equal((await schakelUit(o.kern, A, { wachtwoordOk: true })).ok, false)
    assert.equal((await schakelUit(o.kern, A, { wachtwoordOk: true, code: '000001' })).ok, false)
    assert.equal(o.totp.get(A)!.actief, true)
    o.tik(TOTP_PERIODE)
    assert.equal((await schakelUit(o.kern, A, { wachtwoordOk: true, code: codeVoor(geheim, o.nu()) })).ok, true)
    assert.equal(o.totp.has(A), false)
    assert.equal(await o.opslag.aantalHerstelcodes(A), 0)
  })

  await test('10. Rate limiting: na 5 foute pogingen wordt ook een juiste code geweigerd', async () => {
    const o = maakOmgeving()
    const { geheim } = await activeer(o)
    for (let i = 0; i < 5; i++) assert.equal((await controleerFactor(o.kern, A, { code: '000000' })).ok || false, false)
    const r = await controleerFactor(o.kern, A, { code: codeVoor(geheim, o.nu()) })
    assert.deepEqual(r, { ok: false, fout: FOUT_TE_VEEL, status: 429 })
    o.tik(301) // venster van 5 minuten voorbij
    assert.equal((await controleerFactor(o.kern, A, { code: codeVoor(geheim, o.nu()) })).ok, true)
    // Ook herstelcodes en activatie hebben een limiet.
    const o2 = maakOmgeving()
    await startSetup(o2.kern, B, 'b@x.be')
    for (let i = 0; i < 5; i++) await bevestigSetup(o2.kern, B, '000000')
    assert.equal((await bevestigSetup(o2.kern, B, '111111')).status, 429)
  })

  await test('11. Beschermd pad vóór de tweede stap: geen/andere/verlopen sessierij → verificatie', async () => {
    const nu = Date.parse('2026-09-27T10:00:00Z')
    const geldig: SessieRij = { user_id: A, verloopt_op: new Date(nu + 1000).toISOString() }
    assert.equal(sessieStatus(null, A, nu), 'nodig')                                         // enkel wachtwoord
    assert.equal(sessieStatus({ ...geldig, user_id: B }, A, nu), 'nodig')                     // rij van iemand anders
    assert.equal(sessieStatus({ ...geldig, verloopt_op: new Date(nu - 1).toISOString() }, A, nu), 'nodig') // verlopen
    assert.equal(sessieStatus(geldig, A, nu), 'ok')
    for (const pad of ['/admin', '/admin/facturen', '/api/admin/invoices', '/kantoor']) {
      assert.equal(tweedeStapActie(sessieStatus(null, A, nu), true, pad), 'verificatie')
    }
    // Rol vereist een app die nog niet ingesteld is → enkel het instelscherm.
    const inst: SessieRij = { ...geldig, totp_instellen: true }
    assert.equal(tweedeStapActie(sessieStatus(inst, A, nu), true, '/admin/facturen'), 'instellen')
    assert.equal(tweedeStapActie(sessieStatus(inst, A, nu), true, '/admin/account'), 'door')
    assert.equal(appVerplichtVoor('admin', { app_verplicht: ['admin'] }), true)
    assert.equal(appVerplichtVoor('employee', { app_verplicht: ['admin'] }), false)
    assert.equal(appVerplichtVoor('admin', null), false)
    assert.equal(SESSIE_TTL_MS, 12 * 3600 * 1000)
  })

  await test('12. Andere gebruiker: A\'s codes en herstelcodes werken niet voor B (alles per eigen user-id)', async () => {
    const o = maakOmgeving()
    const a = await activeer(o, A)
    await activeer(o, B)
    assert.equal((await controleerFactor(o.kern, B, { code: codeVoor(a.geheim, o.nu()) })).ok, false)
    assert.equal((await controleerFactor(o.kern, B, { herstelcode: a.herstelcodes[0] })).ok, false)
    assert.equal(await o.opslag.aantalHerstelcodes(A), 8) // niets van A verbruikt
    // Admin-reset: nooit voor jezelf, en enkel met eigen wachtwoord + eigen app-code.
    assert.equal((await resetVoorAnder(o.kern, A, A, { wachtwoordOk: true, code: codeVoor(a.geheim, o.nu()) })).ok, false)
    assert.equal((await resetVoorAnder(o.kern, A, B, { wachtwoordOk: false, code: codeVoor(a.geheim, o.nu()) })).ok, false)
    assert.equal(o.totp.get(B)!.actief, true)
    assert.equal((await resetVoorAnder(o.kern, A, B, { wachtwoordOk: true, code: codeVoor(a.geheim, o.nu()) })).ok, true)
    assert.equal(o.totp.has(B), false)
    const o3 = maakOmgeving() // admin zonder eigen app kan niemand resetten
    await activeer(o3, B)
    assert.equal((await resetVoorAnder(o3.kern, A, B, { wachtwoordOk: true, code: '123456' })).status, 403)
  })

  await test('13. Nieuwe herstelcodes: vereist wachtwoord + app-code (herstelcode volstaat niet)', async () => {
    const o = maakOmgeving()
    const { geheim, herstelcodes } = await activeer(o)
    assert.equal((await nieuweHerstelcodes(o.kern, A, { wachtwoordOk: false, code: codeVoor(geheim, o.nu()) })).ok, false)
    assert.equal((await nieuweHerstelcodes(o.kern, A, { wachtwoordOk: true, code: herstelcodes[0] })).ok, false)
    const r = await nieuweHerstelcodes(o.kern, A, { wachtwoordOk: true, code: codeVoor(geheim, o.nu()) })
    assert.ok(r.ok)
    assert.equal(r.herstelcodes.length, 8)
    assert.equal(new Set(r.herstelcodes).size, 8)
    assert.ok(r.herstelcodes.every((c) => !herstelcodes.includes(c)))
  })

  await test('14. Oude herstelcodes werken niet meer na vernieuwen; nieuwe wel', async () => {
    const o = maakOmgeving()
    const { geheim, herstelcodes } = await activeer(o)
    const r = await nieuweHerstelcodes(o.kern, A, { wachtwoordOk: true, code: codeVoor(geheim, o.nu()) })
    assert.ok(r.ok)
    for (const oud of herstelcodes.slice(0, 3)) assert.equal((await controleerFactor(o.kern, A, { herstelcode: oud })).ok, false)
    o.tik(301)
    assert.equal((await controleerFactor(o.kern, A, { herstelcode: r.herstelcodes[0] })).ok, true)
  })

  await test('15. Uitloggen / intrekken: zonder sessierij is de tweede stap weg; token → juiste session_id', async () => {
    const nu = Date.now()
    const sessies = new Map<string, SessieRij>()
    sessies.set('sessie-1', { user_id: A, verloopt_op: new Date(nu + SESSIE_TTL_MS).toISOString() })
    sessies.set('sessie-2', { user_id: A, verloopt_op: new Date(nu + SESSIE_TTL_MS).toISOString() })
    assert.equal(sessieStatus(sessies.get('sessie-1') ?? null, A, nu), 'ok')
    sessies.delete('sessie-1') // /api/auth/2fa/logout wist de rij van DEZE sessie
    assert.equal(sessieStatus(sessies.get('sessie-1') ?? null, A, nu), 'nodig')
    assert.equal(sessieStatus(sessies.get('sessie-2') ?? null, A, nu), 'ok') // ander toestel blijft
    sessies.delete('sessie-2') // securitywijziging: andere sessies ingetrokken
    assert.equal(sessieStatus(sessies.get('sessie-2') ?? null, A, nu), 'nodig')
    const payload = Buffer.from(JSON.stringify({ sub: A, session_id: 'abc-123' })).toString('base64url')
    assert.equal(sessieIdUitToken(`x.${payload}.y`), 'abc-123')
    assert.equal(sessieIdUitToken('kapot'), null)
  })

  await test('   Vrijstelling (login_settings) kan een actieve app NIET omzeilen; leesfout = verplicht', async () => {
    const db = (settings: unknown, app: unknown, fout = false) => ({
      from: (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (
        t === 'login_settings' ? { data: settings, error: null } : { data: app, error: fout ? { message: 'x' } : null }
      ) }) }) }),
    })
    assert.equal(await twoFactorRequired(db({ two_factor_required: false }, null), A), false)
    assert.equal(await twoFactorRequired(db({ two_factor_required: false }, { actief: true }), A), true)
    assert.equal(await twoFactorRequired(db({ two_factor_required: false }, null, true), A), true)
    assert.equal(await twoFactorRequired(db(null, null), A), true)
  })

  await test('   Corrupt TOTP-geheim: app-code faalt veilig, herstelcode blijft werken (geen lockout)', async () => {
    const o = maakOmgeving()
    const { geheim, herstelcodes } = await activeer(o)
    o.totp.get(A)!.secret_enc = 'v1:kapot:kapot:kapot'
    assert.equal((await controleerFactor(o.kern, A, { code: codeVoor(geheim, o.nu()) })).ok, false)
    assert.equal((await controleerFactor(o.kern, A, { herstelcode: herstelcodes[2] })).ok, true)
  })

  await test('   Herstelcodes: formaat, uniek, normaliseren, hash hangt af van de sleutel', async () => {
    const c = genereerHerstelcodes()
    assert.equal(c.length, 8)
    assert.ok(c.every((x) => /^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/.test(x)))
    assert.equal(normaliseerHerstelcode('abcd efgh jkmn'), 'ABCDEFGHJKMN')
    assert.equal(normaliseerHerstelcode('ABCD-EFGH-JKM0'), null) // 0 zit niet in het alfabet
    const k1 = randomBytes(32), k2 = randomBytes(32)
    assert.notEqual(hashHerstelcode(k1, 'ABCDEFGHJKMN'), hashHerstelcode(k2, 'ABCDEFGHJKMN'))
    const enc = versleutel(k1, 'GEHEIM')
    assert.notEqual(versleutel(k1, 'GEHEIM'), enc) // willekeurige IV
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })

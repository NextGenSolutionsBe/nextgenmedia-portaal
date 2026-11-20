// Klantaccount: activatielink, wachtwoordregels en de welkomstmail.
// Uitvoeren: npx tsx tests/klant-account.test.ts
import assert from 'node:assert/strict'
import { activatieStatus, controleerNieuwWachtwoord, geldigEmail, tokenVorm, welkomstMail, ACTIVATIE_DAGEN } from '../lib/klant-account'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nKlantaccount\n')

test('Activatielink: geldig, verlopen, gebruikt, onbekend', () => {
  const nu = new Date('2026-11-12T10:00:00Z')
  assert.equal(activatieStatus({ verloopt_op: '2026-11-19T10:00:00Z', gebruikt_op: null }, nu), 'geldig')
  assert.equal(activatieStatus({ verloopt_op: '2026-11-12T09:59:59Z', gebruikt_op: null }, nu), 'verlopen')
  assert.equal(activatieStatus({ verloopt_op: '2026-11-19T10:00:00Z', gebruikt_op: '2026-11-12T09:00:00Z' }, nu), 'gebruikt')
  assert.equal(activatieStatus(null, nu), 'onbekend')
  assert.equal(ACTIVATIE_DAGEN, 7)
})

test('Token-vorm: enkel base64url van de juiste lengte', () => {
  assert.ok(tokenVorm('a'.repeat(43)))
  assert.equal(tokenVorm('kort'), null)
  assert.equal(tokenVorm('a'.repeat(42) + '/'), null)
})

test('Wachtwoord: minstens 10, niet enkel cijfers, niet het e-mailadres', () => {
  assert.match(controleerNieuwWachtwoord('kort') ?? '', /10 tekens/)
  assert.match(controleerNieuwWachtwoord('1234567890') ?? '', /cijfers/)
  assert.match(controleerNieuwWachtwoord('klant@voorbeeld.be', 'Klant@Voorbeeld.be') ?? '', /e-mailadres/)
  assert.equal(controleerNieuwWachtwoord('mijn fiets is blauw'), null)
  assert.equal(geldigEmail(' Info@Remels.BE '), 'info@remels.be')
  assert.equal(geldigEmail('geen-mail'), null)
})

test('Welkomstmail: nooit een wachtwoord, wel de login en de 2FA-uitleg', () => {
  const m = welkomstMail({ klant: 'REMELS HVAC', contact: 'Gino Remels', email: 'info@remels.be' })
  assert.match(m.tekst, /^Dag Gino,/)
  assert.match(m.tekst, /Je logt in met info@remels\.be/)
  assert.match(m.tekst, /QR-code/)
  assert.doesNotMatch(m.tekst, /wachtwoord:\s*\S/i)
  assert.equal(m.knop, 'Wachtwoord kiezen')
})

console.log(`\n${n} tests geslaagd\n`)

// Herinneringsmail om een contract te ondertekenen (handmatig, via de MailComposer).
//
//   npx tsx tests/contract-herinnering.test.ts

import assert from 'node:assert/strict'
import { DEFAULT_TEMPLATES } from '../lib/email-templates-defaults'
import { renderTemplate, PLACEHOLDERS } from '../lib/email-render'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

console.log('\nContracten — herinneringsmail\n')

const t = DEFAULT_TEMPLATES.find((x) => x.kind === 'contract_herinnering')!
const vars = { klantnaam: 'Rob Hasevoets', contractnaam: 'Videografie opdracht - ERA NOBIS', contract_link: 'https://app.nextgenmedia.be/sign/abc' }

test('1. Er is precies één standaard herinneringsmail, met een eigen naam', () => {
  assert.ok(t)
  assert.equal(DEFAULT_TEMPLATES.filter((x) => x.kind === 'contract_herinnering').length, 1)
  assert.equal(new Set(DEFAULT_TEMPLATES.map((x) => x.name)).size, DEFAULT_TEMPLATES.length)
})

test('2. Gevuld met de contractgegevens: geen losse placeholders meer', () => {
  const tekst = renderTemplate(`${t.subject}\n${t.body}`, vars)
  assert.ok(!/\{\{/.test(tekst))
  assert.match(tekst, /Hallo Rob Hasevoets/)
  assert.match(tekst, /"Videografie opdracht - ERA NOBIS"/)
  assert.match(renderTemplate(t.subject, vars), /^Herinnering: Videografie opdracht - ERA NOBIS ondertekenen$/)
})

test('3. Knop "Bekijken" naar de tekenlink', () => {
  assert.equal(t.cta_text, 'Bekijken')
  assert.equal(renderTemplate(t.cta_link, vars), vars.contract_link)
})

test('4. Gebruikt enkel gekende placeholders', () => {
  const gebruikt = `${t.subject} ${t.body} ${t.cta_link}`.match(/\{\{\s*[a-z_]+\s*\}\}/gi) ?? []
  for (const p of gebruikt) assert.ok(PLACEHOLDERS.includes(p.replace(/\s/g, '')), p)
})

console.log(`\n${n} tests geslaagd\n`)

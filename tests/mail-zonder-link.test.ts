import assert from 'node:assert/strict'
import { zonderLosseLink } from '../lib/email-html'

let ok = 0
function test(naam: string, fn: () => void) { fn(); ok++; console.log(`  ✓ ${naam}`) }

const LINK = 'https://app.nextgenmedia.be/sign/9f3c2a7e4b1d8c6a5e0f3b2d1c9a8e7f6d5c4b3a'

test('de link op een eigen regel valt weg, de zin wijst naar de knop', () => {
  const tekst = `Hallo Jan,\n\nEr werd een nieuw contract toegevoegd aan jouw portaal.\n\nBekijk en onderteken het contract via onderstaande link.\n${LINK}\n\nGroetjes\nNextGenMedia`
  const uit = zonderLosseLink(tekst, LINK)
  assert.ok(!uit.includes(LINK))
  assert.ok(!uit.includes('https://'))
  assert.match(uit, /via onderstaande knop\.\n\nGroetjes/)
  assert.ok(uit.startsWith('Hallo Jan,'))
})

test('een link midden in een zin valt weg met de dubbelepunt', () => {
  assert.equal(zonderLosseLink(`Teken hier: ${LINK} vandaag nog.`, LINK), 'Teken hier vandaag nog.')
  assert.equal(zonderLosseLink(`Link: <${LINK}>`, LINK), 'Link')
})

test('andere links en tekst zonder de link blijven zoals ze zijn', () => {
  const tekst = 'Meer info op https://nextgenmedia.be/algemene-voorwaarden.\n\nGroetjes'
  assert.equal(zonderLosseLink(tekst, LINK), tekst)
  assert.equal(zonderLosseLink(tekst, null), tekst)
  assert.equal(zonderLosseLink(`Via de link ${LINK}`, ''), `Via de link ${LINK}`)
})

console.log(`\n${ok} tests geslaagd`)

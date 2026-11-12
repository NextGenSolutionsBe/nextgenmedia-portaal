// Algemene voorwaarden en privacyverklaring bij het ondertekenen van een
// contract: beide verplicht, bewaard als bewijs en zichtbaar op het
// certificaat.
//
//   npx tsx tests/voorwaarden.test.ts

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { controleerAkkoord, akkoordDetails, akkoordRegels, VOORWAARDEN_URL, PRIVACY_PAD, PRIVACY_VERSIE } from '../lib/voorwaarden'
import { certificaatBlokken, type Dossier } from '../lib/contract-archief-model'

let n = 0
const test = async (naam: string, f: () => void | Promise<void>) => { await f(); n++; console.log(`  ✓ ${naam}`) }
const lees = (f: string) => readFileSync(f, 'utf8')

const dossier: Dossier = {
  contractId: 'f7c952e5-0f5b-4179-aea1-b10759ea7d9f', referentie: 'NGM-F7C952E5', certificaatNr: 'NGM-CERT-2026-00012',
  contactNaam: null, bedrijfsnaam: 'NextGenMedia', titel: 'Contract', contractType: null, klantNaam: 'Bakkerij Peeters',
  signerName: 'An Peeters', signerEmail: 'an@voorbeeld.be', signedAt: '2026-11-02T09:54:48.000Z', sentAt: null,
  ipAdres: null, userAgent: null, startDatum: null, eindDatum: null, verwachtAantal: null, verwachtBedragExcl: null, frequentie: null,
  gebeurtenissen: [], sha256Contract: 'ab12cd34', bron: 'tekenlink', versie: 1, gearchiveerdOp: '2026-11-02T10:00:00.000Z', app: 'NextGenMedia Portal',
}

async function main() {
  console.log('\nAlgemene voorwaarden en privacyverklaring bij ondertekenen\n')

  await test('1. Zonder beide vinkjes wordt er niet getekend, met een duidelijke reden', () => {
    assert.equal(controleerAkkoord({ akkoord_voorwaarden: true, akkoord_privacy: true }).ok, true)
    assert.match((controleerAkkoord({}) as { fout: string }).fout, /algemene voorwaarden en de privacyverklaring/)
    assert.match((controleerAkkoord({ akkoord_voorwaarden: true }) as { fout: string }).fout, /privacyverklaring/)
    assert.match((controleerAkkoord({ akkoord_privacy: true }) as { fout: string }).fout, /algemene voorwaarden/)
    assert.equal(controleerAkkoord({ akkoord_voorwaarden: 'true', akkoord_privacy: 1 }).ok, false, 'enkel echte vinkjes tellen')
  })

  await test('2. Bewijs: tekst, links, versie en tijdstip; de voorwaarden gelden ook voor toekomstige opdrachten', () => {
    const d = akkoordDetails('2026-11-02T09:54:48.000Z', 'https://app.nextgenmedia.be/')
    assert.equal(d.voorwaarden.url, 'https://nextgenmedia.be/algemene-voorwaarden')
    assert.match(d.voorwaarden.tekst, /toekomstige samenwerking/)
    assert.equal(d.privacy.url, 'https://app.nextgenmedia.be/documenten/privacyverklaring-nextgenmedia.pdf')
    assert.equal(d.privacy.versie, PRIVACY_VERSIE)
    assert.equal(d.voorwaarden.op, '2026-11-02T09:54:48.000Z')
  })

  await test('3. De privacyverklaring staat als PDF in de app (publiek, buiten de middleware)', () => {
    const pad = `public${PRIVACY_PAD}`
    assert.ok(existsSync(pad), pad)
    assert.equal(readFileSync(pad).subarray(0, 5).toString(), '%PDF-')
    assert.match(lees('middleware.ts'), /pdf\|/, 'pdf-bestanden gaan niet door de login-middleware')
  })

  await test('4. Certificaat toont het akkoord; oudere contracten zonder akkoord blijven ongewijzigd', () => {
    const met = Object.fromEntries(certificaatBlokken({ ...dossier, akkoordVoorwaardenOp: dossier.signedAt, akkoordPrivacyOp: dossier.signedAt, privacyVersie: PRIVACY_VERSIE }).flatMap((b) => b.regels))
    assert.match(met['Algemene voorwaarden'], /Aanvaard, ook voor toekomstige opdrachten/)
    assert.match(met['Privacyverklaring'], /Aanvaard \(versie van 2 november 2026\)/)
    const zonder = Object.fromEntries(certificaatBlokken(dossier).flatMap((b) => b.regels))
    assert.equal(zonder['Algemene voorwaarden'], undefined)
    assert.equal(zonder['Privacyverklaring'], undefined)
    assert.deepEqual(akkoordRegels({}), [])
    assert.ok(lees('lib/contract-archief.ts').includes('akkoordVoorwaardenOp: (sig?.voorwaarden_akkoord_op'), 'het dossier leest het akkoord uit de handtekening')
  })

  await test('5. Tekenpagina en server: beide vinkjes verplicht, kleine leeslinks, akkoord bewaard bij de handtekening', () => {
    const form = lees('app/sign/[token]/signature-form.tsx')
    assert.ok(form.includes('Lees nu de algemene voorwaarden') && form.includes('Lees nu de privacyverklaring'))
    assert.ok(form.includes('VOORWAARDEN_URL') && form.includes('PRIVACY_PAD'))
    assert.match(form, /disabled=\{loading \|\| !hasSig \|\| !agreed \|\| !voorwaarden \|\| !privacy/)
    const api = lees('app/api/sign/route.ts')
    assert.ok(api.indexOf('controleerAkkoord') < api.indexOf('PDFDocument.load'), 'eerst het akkoord, dan pas tekenen')
    assert.ok(api.includes('voorwaarden_akkoord_op') && api.includes('akkoord_details'))
    assert.equal(VOORWAARDEN_URL, 'https://nextgenmedia.be/algemene-voorwaarden')
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })

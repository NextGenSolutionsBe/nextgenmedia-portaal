// Tests voor het contractarchief en het ondertekeningscertificaat (pure logica).
// Uitvoeren: npx tsx tests/contract-archief.test.ts
import assert from 'node:assert/strict'
import {
  referentie, tijdstipBrussel, veiligeNaam, archiefPaden, certificaatBestandsnaam, vingerafdrukLeesbaar,
  certificaatBlokken, meldingTekst, gebeurtenisLabel, legalOntvangers, meldingAlVerstuurd, meldingOpnieuwNodig, documentBestandsnaam, contentDisposition, type Dossier,
} from '../lib/contract-archief-model'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

const dossier: Dossier = {
  contractId: 'f7c952e5-0f5b-4179-aea1-b10759ea7d9f', referentie: 'NGM-F7C952E5', certificaatNr: 'NGM-CERT-2026-00012',
  contactNaam: null, bedrijfsnaam: 'NextGenMedia',
  titel: 'Contract website aanpassingen', contractType: 'Websitecontract', klantNaam: 'Bakkerij Éclair & Zo',
  signerName: 'An Peeters', signerEmail: 'an@voorbeeld.be', signedAt: '2026-09-11T09:54:48.000Z', sentAt: '2026-09-11T09:48:00.000Z',
  ipAdres: '81.82.83.84', userAgent: 'Mozilla/5.0 (iPhone)', startDatum: '2026-10-01', eindDatum: null,
  verwachtAantal: 1, verwachtBedragExcl: 1350, frequentie: 'eenmalig',
  gebeurtenissen: [
    { event_type: 'sent', created_at: '2026-09-11T09:48:00.000Z', actor: 'info@nextgenmedia.be', ip_address: null, user_agent: null },
    { event_type: 'downloaded_signed', created_at: '2026-09-11T10:00:00.000Z', actor: null, ip_address: null, user_agent: null },
    { event_type: 'signed', created_at: '2026-09-11T09:54:48.000Z', actor: 'an@voorbeeld.be', ip_address: '81.82.83.84', user_agent: null },
  ],
  sha256Contract: 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12', bron: 'tekenlink', versie: 1,
  gearchiveerdOp: '2026-09-21T06:00:00.000Z', app: 'NextGenMedia Portal · https://app.nextgenmedia.be',
}

console.log('Contractarchief en certificaat')

test('1. Referentie en bestandsnamen zijn stabiel en bestandsveilig', () => {
  assert.equal(referentie('f7c952e5-0f5b-4179-aea1-b10759ea7d9f'), 'NGM-F7C952E5')
  assert.equal(veiligeNaam('Bakkerij Éclair & Zo'), 'bakkerij-eclair-zo')
  assert.equal(veiligeNaam('   '), 'contract')
  assert.equal(certificaatBestandsnaam('Contract website aanpassingen', dossier.contractId), 'certificaat-contract-website-aanpassingen-ngm-f7c952e5.pdf')
  assert.deepEqual(archiefPaden('abc', 2), { contract: 'abc/v2/contract-getekend.pdf', certificaat: 'abc/v2/certificaat.pdf', dossier: 'abc/v2/dossier.json' })
})

test('2. Tijdstippen in Brusselse tijd, op de seconde', () => {
  assert.equal(tijdstipBrussel('2026-09-11T09:54:48.000Z'), '11/09/2026 om 11:54:48')   // CEST
  assert.equal(tijdstipBrussel('2026-12-03T08:30:05.000Z'), '03/12/2026 om 09:30:05')   // CET
  assert.equal(tijdstipBrussel(null), '—')
  assert.equal(tijdstipBrussel('geen datum'), '—')
})

test('3. De vingerafdruk wordt leesbaar gegroepeerd', () => {
  assert.equal(vingerafdrukLeesbaar('ab12cd34ef56ab12'), 'ab12cd34 ef56ab12')
})

test('4. Het certificaat bevat certificaat, contract, ondertekening, integriteit en tijdlijn (zonder downloads)', () => {
  const blokken = certificaatBlokken(dossier)
  assert.deepEqual(blokken.map((b) => b.kop), ['Certificaat', 'Contract', 'Ondertekening', 'Integriteit', 'Tijdlijn'])
  const plat = Object.fromEntries(blokken.flatMap((b) => b.regels))
  assert.equal(plat['Certificaatnummer'], 'NGM-CERT-2026-00012')
  assert.equal(plat['Status'], 'Succesvol ondertekend')
  assert.equal(plat['Titel'], 'Contract website aanpassingen')
  assert.equal(plat['Contractnummer'], 'NGM-F7C952E5 (f7c952e5-0f5b-4179-aea1-b10759ea7d9f)')
  assert.equal(plat['Klant'], 'Bakkerij Éclair & Zo')
  assert.equal(plat['Bedrijf'], 'NextGenMedia')
  assert.equal(plat['Ondertekend door'], 'An Peeters')
  assert.equal(plat['E-mailadres'], 'an@voorbeeld.be')
  assert.equal(plat['Datum en tijdstip'], '11/09/2026 om 11:54:48')
  assert.equal(plat['Tijdzone'], 'Europe/Brussels (CET/CEST)')
  assert.equal(plat['IP-adres'], '81.82.83.84')
  assert.equal(plat['SHA-256 van het getekende PDF'], vingerafdrukLeesbaar(dossier.sha256Contract))
  const tijdlijn = blokken[4].regels.map((r) => r[1])
  assert.equal(tijdlijn.length, 2, 'downloads horen niet in de tijdlijn')
  assert.equal(gebeurtenisLabel('onbekend_type'), 'onbekend_type')
  const zonderAudit = Object.fromEntries(certificaatBlokken({ ...dossier, ipAdres: null, userAgent: null }).flatMap((b) => b.regels))
  assert.equal(zonderAudit['IP-adres'], undefined, 'IP enkel als het geregistreerd is')
})

test('5. De melding naar Legal: onderwerp, velden en link', () => {
  const m = meldingTekst(dossier, { adminUrl: 'https://app.nextgenmedia.be/admin/contracts/x', ontvangstUrl: null })
  assert.equal(m.onderwerp, 'Contract getekend – Bakkerij Éclair & Zo – Contract website aanpassingen')
  for (const r of [/Klantnaam:\s+Bakkerij/, /Bedrijfsnaam:\s+NextGenMedia/, /Contractnummer:\s+NGM-F7C952E5/, /Ondertekenaar:\s+An Peeters <an@voorbeeld.be>/, /Ondertekend op:\s+11\/09\/2026 om 11:54:48/, /Certificaatnummer:\s+NGM-CERT-2026-00012/, /Contract in de app: https:\/\/app.nextgenmedia.be\/admin\/contracts\/x/]) assert.match(m.tekst, r)
})

test('6. Legal-ontvangers: standaard legal@, nooit info@', () => {
  assert.deepEqual(legalOntvangers({}), ['legal@nextgenmedia.be'])
  assert.deepEqual(legalOntvangers({ CONTRACT_LEGAL_EMAIL: 'info@nextgenmedia.be' }), ['legal@nextgenmedia.be'])
  assert.deepEqual(legalOntvangers({ CONTRACT_LEGAL_EMAIL: 'Legal@nextgenmedia.be, jurist@kantoor.be' }), ['legal@nextgenmedia.be', 'jurist@kantoor.be'])
})

test('7. Eén melding per archiefversie: herladen of dubbelklikken stuurt niets opnieuw', () => {
  const verstuurd = [{ event_type: 'melding_verstuurd', created_at: '2026-09-21T10:00:00Z', meta: { archief_id: 'a1', versie: 1 } }]
  assert.equal(meldingAlVerstuurd(verstuurd, { versie: 1, archiefId: 'a1' }), true)
  assert.equal(meldingAlVerstuurd(verstuurd, { versie: 2, archiefId: 'a2' }), false)
  assert.equal(meldingAlVerstuurd([], { versie: 1 }), false)
  assert.equal(meldingOpnieuwNodig([{ event_type: 'melding_mislukt', created_at: '2026-09-21T10:00:00Z' }], true), true)
  assert.equal(meldingOpnieuwNodig(verstuurd, true), false)
  assert.equal(meldingOpnieuwNodig([], true), true)
  assert.equal(meldingOpnieuwNodig([], false), false)
})

test('8. Bestandsnamen volgens de afspraak, veilig voor elk besturingssysteem', () => {
  const g = documentBestandsnaam('getekend_contract', 'Bakkerij Éclair & Zo', 'Contract website', '2026-09-11T09:54:48.000Z')
  assert.match(g, /^Getekend_contract_.*Bakkerij.*Contract.*2026-09-11\.pdf$/)
  assert.ok(/^[A-Za-z0-9_.\-]+$/.test(g), 'enkel veilige tekens: ' + g)
  assert.match(documentBestandsnaam('certificaat', 'X', 'Y', '2026-09-11T09:54:48.000Z'), /^Ondertekeningscertificaat_X_Y_2026-09-11\.pdf$/)
  assert.match(contentDisposition('Getekend_contract_Éclair.pdf'), /filename\*=UTF-8''/)
})

console.log(`\n${n} tests geslaagd`)

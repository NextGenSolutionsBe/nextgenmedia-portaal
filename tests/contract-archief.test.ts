// Tests voor het contractarchief en het ondertekeningscertificaat (pure logica).
// Uitvoeren: npx tsx tests/contract-archief.test.ts
import assert from 'node:assert/strict'
import {
  referentie, tijdstipBrussel, veiligeNaam, archiefPaden, certificaatBestandsnaam, vingerafdrukLeesbaar,
  certificaatBlokken, meldingTekst, gebeurtenisLabel, type Dossier,
} from '../lib/contract-archief-model'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

const dossier: Dossier = {
  contractId: 'f7c952e5-0f5b-4179-aea1-b10759ea7d9f', referentie: 'NGM-F7C952E5',
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

test('4. Het certificaat bevat contract, ondertekening, integriteit en tijdlijn (zonder downloads)', () => {
  const blokken = certificaatBlokken(dossier)
  assert.deepEqual(blokken.map((b) => b.kop), ['Contract', 'Ondertekening', 'Integriteit', 'Tijdlijn'])
  const plat = Object.fromEntries(blokken.flatMap((b) => b.regels))
  assert.equal(plat['Titel'], 'Contract website aanpassingen')
  assert.equal(plat['Klant'], 'Bakkerij Éclair & Zo')
  assert.equal(plat['Ondertekend door'], 'An Peeters')
  assert.equal(plat['Tijdstip'], '11/09/2026 om 11:54:48')
  assert.equal(plat['IP-adres'], '81.82.83.84')
  assert.equal(plat['Wijze'], 'Digitale ondertekening via de tekenlink')
  assert.match(plat['Verwachte facturatie'], /1×.*1\.350,00.*eenmalig/)
  assert.equal(plat['SHA-256 van het getekende PDF'], vingerafdrukLeesbaar(dossier.sha256Contract))
  const tijdlijn = blokken[3].regels.map((r) => r[1])
  assert.equal(tijdlijn.length, 2, 'downloads horen niet in de tijdlijn')
  assert.ok(tijdlijn.some((t) => t.startsWith('Ondertekend — an@voorbeeld.be (81.82.83.84)')))
  assert.equal(gebeurtenisLabel('onbekend_type'), 'onbekend_type')
})

test('5. De interne melding noemt wie, wat, wanneer en de facturatiestand', () => {
  const m = meldingTekst(dossier, { adminUrl: 'https://app.nextgenmedia.be/admin/contracts/x', ontvangstUrl: 'https://app.nextgenmedia.be/sign/t/receipt', facturatie: '1 facturatieopdracht(en) aangemaakt, 1 in ClickUp gezet' })
  assert.equal(m.onderwerp, 'Contract ondertekend: Contract website aanpassingen — Bakkerij Éclair & Zo')
  assert.match(m.tekst, /An Peeters \(an@voorbeeld.be\) heeft "Contract website aanpassingen" ondertekend op 11\/09\/2026 om 11:54:48/)
  assert.match(m.tekst, /Facturatie:\s+1 facturatieopdracht\(en\) aangemaakt, 1 in ClickUp gezet/)
  assert.match(m.tekst, /Ontvangstpagina: https:\/\/app.nextgenmedia.be\/sign\/t\/receipt/)
  const zonder = meldingTekst({ ...dossier, klantNaam: null }, { adminUrl: 'x', ontvangstUrl: null, facturatie: null })
  assert.equal(zonder.onderwerp, 'Contract ondertekend: Contract website aanpassingen')
  assert.match(zonder.tekst, /geen facturatieafspraken/)
})

console.log(`\n${n} tests geslaagd`)

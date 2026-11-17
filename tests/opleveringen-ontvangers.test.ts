// Wie krijgt de mail over een oplevering: alle accounts van de klant, "Alle gebruikers", aanhef per persoon.
// Uitvoeren: npx tsx tests/opleveringen-ontvangers.test.ts
import assert from 'node:assert/strict'
import { aanhefVoor, adresSleutel, alleGebruikers, extraAdressen, metAanhef, ontvangersVan, standaardKeuze, voornaamVan } from '../lib/opleveringen-ontvangers'

let ok = 0
const t = (naam: string, f: () => void) => { f(); ok++; void naam }

const eraNobis = () => ontvangersVan({
  klantEmail: 'info@eranobis.be',
  eigenaar: { email: 'julie@eranobis.be', naam: 'Julie Peeters' },
  gebruikers: [
    { email: 'melanie@eranobis.be', name: 'Melanie Janssens', active: true, permissions: {} },
    { email: 'rob@eranobis.be', name: 'Rob', active: true, permissions: { opleveringen: { view: true, download: true, feedback: true } } },
    { email: 'boekhouding@eranobis.be', name: 'Boekhouding', active: true, permissions: { opleveringen: { view: false } } },
    { email: 'oud@eranobis.be', name: 'Oud account', active: false, permissions: {} },
    { email: 'JULIE@eranobis.be', name: 'Julie (dubbel)', active: true, permissions: {} },
    { email: null, name: 'Zonder mail', active: true, permissions: {} },
  ],
})

t('alle accounts van de klant, zonder dubbels, met het klantadres achteraan', () => {
  const l = eraNobis()
  assert.deepEqual(l.map((o) => o.email), ['julie@eranobis.be', 'melanie@eranobis.be', 'rob@eranobis.be', 'boekhouding@eranobis.be', 'oud@eranobis.be', 'info@eranobis.be'])
  assert.equal(l[0].soort, 'eigenaar')
  assert.equal(l[5].soort, 'klantadres')
})

t('wie Opleveringen niet mag zien of gedeactiveerd is, kan niet gekozen worden', () => {
  const l = eraNobis()
  const per = (e: string) => l.find((o) => o.email === e)!
  assert.equal(per('melanie@eranobis.be').kan, true, 'lege rechten = alles, zoals de klantapp')
  assert.equal(per('boekhouding@eranobis.be').kan, false)
  assert.equal(per('boekhouding@eranobis.be').reden, 'Geen toegang tot Opleveringen')
  assert.equal(per('oud@eranobis.be').reden, 'Account gedeactiveerd')
  // Andere modules uitgezet, opleveringen niet vermeld: standaard aan (STANDAARD_AAN).
  const m = ontvangersVan({ gebruikers: [{ email: 'a@b.be', name: null, active: true, permissions: { social_media: { view: true } } }] })
  assert.equal(m[0].kan, true)
})

t('Alle gebruikers = elk account dat de oplevering kan bekijken (niet het algemene adres)', () => {
  assert.deepEqual(alleGebruikers(eraNobis()), ['julie@eranobis.be', 'melanie@eranobis.be', 'rob@eranobis.be'])
})

t('zonder keuze: het algemene adres (zoals vroeger), anders het hoofdaccount', () => {
  assert.deepEqual(standaardKeuze(eraNobis()), ['info@eranobis.be'])
  assert.deepEqual(standaardKeuze(ontvangersVan({ eigenaar: { email: 'julie@eranobis.be', naam: null } })), ['julie@eranobis.be'])
  assert.deepEqual(standaardKeuze([]), [])
  // Het klantadres is ook een account: één regel, als account.
  const zelfde = ontvangersVan({ klantEmail: 'Julie@eranobis.be', eigenaar: { email: 'julie@eranobis.be', naam: 'Julie' } })
  assert.equal(zelfde.length, 1)
  assert.equal(zelfde[0].soort, 'eigenaar')
})

t('andere adressen: komma, puntkomma of nieuwe regel; ongeldige apart', () => {
  assert.deepEqual(extraAdressen(' a@b.be, c@d.be;\nfout, '), { geldig: ['a@b.be', 'c@d.be'], ongeldig: ['fout'] })
  assert.deepEqual(extraAdressen(''), { geldig: [], ongeldig: [] })
})

t('aanhef per ontvanger', () => {
  const tekst = 'Beste [voornaam],\n\nDe eerste versie staat klaar.'
  assert.equal(metAanhef(tekst, 'Julie'), 'Beste Julie,\n\nDe eerste versie staat klaar.')
  assert.equal(metAanhef(tekst, null), 'Beste,\n\nDe eerste versie staat klaar.')
  assert.equal(voornaamVan('  Melanie Janssens '), 'Melanie')
  assert.equal(aanhefVoor({ soort: 'gebruiker', naam: 'Rob De Smet' }, 'Era Nobis'), 'Rob')
  assert.equal(aanhefVoor({ soort: 'klantadres', naam: null }, 'Era Nobis'), 'Era Nobis')
  assert.equal(aanhefVoor({ soort: 'extra', naam: null }, 'Era Nobis'), null)
})

t('verzendsleutel per adres: vast, verschillend per persoon, geldig voor de server', () => {
  const basis = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const a = adresSleutel(basis, 'julie@eranobis.be')
  assert.equal(a, adresSleutel(basis, ' JULIE@eranobis.be '))
  assert.notEqual(a, adresSleutel(basis, 'rob@eranobis.be'))
  assert.match(a, /^[0-9a-zA-Z-]{8,64}$/)
})

console.log(`opleveringen-ontvangers: ${ok} tests geslaagd`)

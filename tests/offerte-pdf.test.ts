// De opgemaakte offerte als pdf: alle onderdelen, handtekening, voorwaarden achteraan.
//   npx tsx tests/offerte-pdf.test.ts [pad-om-te-bewaren.pdf]
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'fs'
import { PDFDocument } from 'pdf-lib'
import { maakOffertePdf, type OffertePdfInvoer } from '../lib/offerte-pdf'
import { leesInhoud } from '../lib/offerte-fiche'
import { offerteBedrijf, contactUitPersoneel } from '../lib/offerte-afzender'

export const VOORBEELD: Omit<OffertePdfInvoer, 'handtekening'> = {
  merk: 'nextgenmedia',
  bedrijf: offerteBedrijf({ naam: 'NextGenMedia', website: 'nextgenmedia.be' }),
  contact: contactUitPersoneel('bram', { voornaam: 'Bram', achternaam: 'Reinquin', email: 'bram@nextgenmedia.be', telefoon: '+32 470 00 00 00' }),
  foto: process.env.OFFERTE_FOTO ? readFileSync(process.env.OFFERTE_FOTO) : null,
  betalingstermijn: 14,
  klant: { naam: 'Bakkerij Peeters BV', contact: 'Jan Peeters', email: 'jan@bakkerijpeeters.be', telefoon: '011 22 33 44', adres: 'Kerkstraat 1, 3500 Hasselt', btw: 'BE0123456749' },
  nummer: 'OF-2026-014',
  inhoud: leesInhoud({
    algemeen: { datum: '2026-11-09', geldig_tot: '2026-12-09', projectnaam: 'Social media en reels 2027', doel: 'Meer zichtbaarheid in Hasselt en omgeving, en elke maand nieuwe klanten voor de taartenwinkel.\nFocus op Instagram en Facebook.', startdatum: '1 januari 2027', looptijd: '12 maanden', feedback_contact: 'Jan Peeters (zaakvoerder)' },
    diensten: ['social_media', 'video_foto'],
    fiches: {
      social_media: { pakket: 'Groei', looptijd: '12', kanalen: ['Instagram', 'Facebook'], posts: '12', reels: '4', stories: '8', draaidagen: '1 per maand', community: 'ja', community_detail: 'Instagram en Facebook, elke werkdag', planning: 'ja', rapportering: 'ja', rapportering_freq: 'maandelijks', strategie: 'ja', strategie_freq: 'elk kwartaal', ads_beheer: 'nee', ads_budget: 'nee', feedbackrondes: '2', aanleveren: 'Logo, huisstijl en toegang tot de accounts. Info over acties en nieuwe producten.', niet_inbegrepen: 'Drukwerk\nExtra draaidagen' },
      video_foto: { type: ['Reels', 'Bedrijfsvideo'], videos: '4', draaidagen: '1', duur_draaidag: 'halve dag', locaties: 'Winkel in Hasselt', formaten: ['9:16'], ondertiteling: 'ja', muziek: 'ja', ruwe_beelden: 'nee', verplaatsing: 'nee' },
    },
    prijs: { setup: '500', maandelijks: '1.250', maanden: '12', advertentiebudget: '300', btw: '21', betaling: 'Opstart bij akkoord, daarna maandelijks.' },
    extra: [{ omschrijving: 'Extra fotoshoot producten', bedrag: '450' }],
  }),
}

;(async () => {
  const leeg = await maakOffertePdf({ ...VOORBEELD, voorbeeld: true })
  const doc = await PDFDocument.load(leeg)
  assert.ok(doc.getPageCount() >= 2, 'minstens twee pagina’s (inhoud + voorwaarden)')
  assert.match(doc.getTitle() ?? '', /OF-2026-014/)

  const png = readFileSync('public/logo-pdf.png')
  const getekend = await maakOffertePdf({ ...VOORBEELD, handtekening: { png, naam: 'Jan Peeters', op: '2026-11-10T09:15:00Z' } })
  assert.ok((await PDFDocument.load(getekend)).getPageCount() >= 2)
  if (process.argv[2]) { writeFileSync(process.argv[2], getekend); console.log('bewaard:', process.argv[2]) }
  console.log('  ✓ offerte-pdf: voorbeeld en getekende versie')
})().catch((e) => { console.error(e); process.exit(1) })

// Dicteren — pure regels (client-safe, getest in tests/dicteren.test.ts).
//
// De browser zet spraak om naar ruwe tekst (Chrome, Edge en Safari, in het
// Nederlands met Belgische uitspraak). Daarna maakt de AI er nette tekst van:
// leestekens, hoofdletters, cijfers, namen uit de context, zonder "euh". Ze
// verandert niets aan de inhoud. Lijkt het resultaat geen opkuis maar iets
// anders (veel korter of langer), dan gebruiken we de ruwe tekst.

export const TAAL = 'nl-BE'
export const MAX_DICTEERTEKST = 8000

/** Ruwe herkenning wat opfrissen: spaties, eerste letter groot, punt op het einde. */
export function ruwNetjes(t: string): string {
  const s = t.replace(/\s+/g, ' ').trim()
  if (!s) return ''
  const groot = s.charAt(0).toLocaleUpperCase('nl-BE') + s.slice(1)
  return /[.!?…:]$/.test(groot) ? groot : `${groot}.`
}

/** Nieuwe tekst achter wat er al staat: op een nieuwe regel als er al iets staat. */
export function voegToe(oud: string, nieuw: string): string {
  const n = nieuw.trim()
  if (!n) return oud
  const o = oud.replace(/\s+$/, '')
  return o ? `${o}\n${n}` : n
}

/** Een stuk tekst vervangen (bv. de opgekuiste versie terug door de ruwe), enkel als het er nog staat. */
export function vervangLaatste(tekst: string, oud: string, nieuw: string): string {
  const i = tekst.lastIndexOf(oud)
  return i < 0 ? tekst : tekst.slice(0, i) + nieuw + tekst.slice(i + oud.length)
}

/** De vraag aan de AI: opkuisen, niets toevoegen, niets samenvatten. */
export function opkuisPrompt(tekst: string, context: string | null): string {
  return `Hieronder staat een ruwe spraakherkenning van een interne notitie, ingesproken in het Nederlands of Vlaams door iemand van NextGenMedia (een Belgisch marketingbureau; ook NextGenSolutions en Founders of Flanders; het team: Bram, Marco, Chiara).${context ? `\nDe notitie hoort bij: ${context.slice(0, 300)}` : ''}

Maak er nette, leesbare tekst van:
- leestekens, hoofdletters en zinnen; nieuwe alinea's waar de spreker duidelijk van onderwerp verandert;
- bedragen, datums, uren en aantallen in cijfers (bv. € 1.500, 12 januari, 14u30);
- herstel woorden die duidelijk verkeerd herkend zijn, vooral namen van klanten, mensen, diensten en onze bedrijfsnamen uit de context hierboven;
- laat stopwoorden en herhalingen weg (euh, ehm, allez, ja ja, zeg maar);
- gesproken leestekens ("punt", "komma", "nieuwe lijn") worden het teken zelf.
Verander niets aan de inhoud: niets toevoegen, niets samenvatten, geen eigen uitleg, niet beleefder maken. Twijfel je over een woord, laat het staan.
Geef UITSLUITEND de opgekuiste tekst terug, zonder aanhalingstekens of inleiding.

Ruwe tekst:
${tekst.slice(0, MAX_DICTEERTEKST)}`
}

/**
 * Het antwoord van de AI nakijken. Te kort (samengevat) of te lang (iets
 * toegevoegd) tegenover de ruwe tekst = we vertrouwen het niet en geven de
 * ruwe tekst terug.
 */
export function naarOpgekuist(antwoord: string | null | undefined, ruw: string): { tekst: string; opgekuist: boolean } {
  const basis = ruwNetjes(ruw)
  let a = String(antwoord ?? '').trim().replace(/^["“„']+|["”']+$/g, '').trim()
  a = a.replace(/^(opgekuiste tekst|hier is de opgekuiste tekst)\s*:\s*/i, '').trim()
  if (!a) return { tekst: basis, opgekuist: false }
  const r = ruw.replace(/\s+/g, ' ').trim().length
  const n = a.replace(/\s+/g, ' ').trim().length
  // Stopwoorden weglaten maakt korter, leestekens langer; buiten die marge is het geen opkuis meer.
  if (r >= 40 && (n < r * 0.5 || n > r * 1.5 + 40)) return { tekst: basis, opgekuist: false }
  return { tekst: a, opgekuist: true }
}

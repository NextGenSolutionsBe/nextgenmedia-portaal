// Maandnamen in titels en omschrijvingen laten meeschuiven — pure module
// (client-safe, getest in tests/facturatie-maanden.test.ts).
//
// "Sociale media management oktober" wordt bij de volgende factuur
// "… november", dan "… december". Staat er een jaartal na de maand
// ("oktober 2026"), dan schuift dat mee over de jaarwissel.

export const MAANDNAMEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const MAAND = new RegExp(`\\b(${MAANDNAMEN.join('|')})\\b(\\s+(\\d{4}))?`, 'gi')

/** Staat er een maandnaam in de tekst? */
export const heeftMaand = (tekst: string | null | undefined): boolean => new RegExp(MAAND.source, 'i').test(String(tekst ?? ''))

const zelfdeHoofdletters = (bron: string, doel: string) =>
  bron === bron.toUpperCase() && bron.length > 1 ? doel.toUpperCase() : bron[0] === bron[0].toUpperCase() ? doel[0].toUpperCase() + doel.slice(1) : doel

/** Elke maandnaam in de tekst `n` maanden verder (n mag negatief zijn). */
export function verschuifMaanden(tekst: string, n: number): string {
  if (!tekst || !n) return tekst
  return tekst.replace(MAAND, (_heel, naam: string, metJaar: string | undefined, jaar: string | undefined) => {
    const i = MAANDNAMEN.indexOf(naam.toLowerCase())
    const totaal = i + n
    const nieuw = ((totaal % 12) + 12) % 12
    const jaren = Math.floor(totaal / 12)
    const woord = zelfdeHoofdletters(naam, MAANDNAMEN[nieuw])
    return metJaar && jaar ? `${woord}${metJaar.slice(0, metJaar.length - jaar.length)}${Number(jaar) + jaren}` : woord
  })
}

/** Aantal maanden tussen twee maanden 'JJJJ-MM' (b − a). */
export function maandenTussen(a: string, b: string): number {
  if (!/^\d{4}-\d{2}/.test(a) || !/^\d{4}-\d{2}/.test(b)) return 0
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)))
}

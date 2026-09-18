/**
 * Framer-sites: rekenwerk rond verlengingen.
 *
 * De opgeslagen `renew_op` is een ANKERDATUM — de dag waarop het abonnement
 * ooit begon te verlengen. De eerstvolgende verlenging rekenen we daaruit,
 * in plaats van de datum in de database telkens vooruit te schuiven. Anders
 * staat er over drie maanden een datum uit het verleden omdat niemand hem
 * bijgewerkt heeft, en dan vertrouwt niemand het scherm nog.
 *
 * Los van de database zodat het te testen is: een verlengdatum die er een maand
 * naast zit, merk je pas als er onaangekondigd afgeschreven wordt.
 */

export type Facturatie = 'monthly' | 'annual'

/** Datum zonder tijd, in lokale termen — verlengingen gaan over dagen, niet uren. */
function alsDag(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function parse(datum: string | Date): Date {
  if (datum instanceof Date) return alsDag(datum)
  const [j, m, d] = String(datum).slice(0, 10).split('-').map(Number)
  return new Date(j, (m || 1) - 1, d || 1)
}

/**
 * De eerstvolgende verlenging op of ná `vanaf`.
 *
 * Schuift met hele maanden of jaren op vanaf het anker. Valt de ankerdag niet
 * in de doelmaand (31 januari → februari), dan wordt het de laatste dag van die
 * maand; JavaScript zou er anders 2 of 3 maart van maken.
 */
export function volgendeVerlenging(
  anker: string | Date, facturatie: Facturatie, vanaf: Date = new Date(),
): Date {
  const start = parse(anker)
  const grens = alsDag(vanaf)
  if (start >= grens) return start

  const stapMaanden = facturatie === 'monthly' ? 1 : 12
  const dag = start.getDate()

  // Grof springen naar de juiste periode, daarna hoogstens één stap corrigeren.
  const maandenVerschil =
    (grens.getFullYear() - start.getFullYear()) * 12 + (grens.getMonth() - start.getMonth())
  let stappen = Math.floor(maandenVerschil / stapMaanden)

  const bouw = (n: number) => {
    const maand = start.getMonth() + n * stapMaanden
    const jaar = start.getFullYear() + Math.floor(maand / 12)
    const m = ((maand % 12) + 12) % 12
    const laatsteDag = new Date(jaar, m + 1, 0).getDate()
    return new Date(jaar, m, Math.min(dag, laatsteDag))
  }

  let kandidaat = bouw(stappen)
  // Hoogstens twee correcties nodig; de lus is een vangnet, geen zoekactie.
  for (let i = 0; i < 3 && kandidaat < grens; i++) kandidaat = bouw(++stappen)
  return kandidaat
}

/** Dagen tot de eerstvolgende verlenging. Negatief kan niet voorkomen. */
export function dagenTotVerlenging(
  anker: string | Date, facturatie: Facturatie, vanaf: Date = new Date(),
): number {
  const volgende = volgendeVerlenging(anker, facturatie, vanaf)
  return Math.round((volgende.getTime() - alsDag(vanaf).getTime()) / 86_400_000)
}

/** Wat dit abonnement per maand kost, ongeacht hoe er gefactureerd wordt. */
export function perMaand(bedragExcl: number, facturatie: Facturatie): number {
  if (!Number.isFinite(bedragExcl) || bedragExcl <= 0) return 0
  return facturatie === 'annual' ? bedragExcl / 12 : bedragExcl
}

/** Wat dit abonnement per jaar kost. */
export function perJaar(bedragExcl: number, facturatie: Facturatie): number {
  return perMaand(bedragExcl, facturatie) * 12
}

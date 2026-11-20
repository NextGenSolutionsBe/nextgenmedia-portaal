// Factuurstatussen — pure module (client-safe, testbaar).
//
// Twee losse assen die je niet door elkaar mag halen:
//  · de VERZENDSTATUS: is de factuur al naar de klant? (te versturen → verstuurd,
//    of geannuleerd / gecrediteerd)
//  · de BETAALSTATUS: is ze betaald? (enkel zinvol zodra ze verstuurd is)
// Zo kan een factuur "Verstuurd" én "Niet betaald" zijn.
//
// De kleuren zijn overal dezelfde: Facturen-module, contractdetail, planner,
// tabellen, badges en totalen. Grijs = nog te versturen (géén foutstatus).

export type Verzendstatus = 'te_versturen' | 'verstuurd' | 'geannuleerd' | 'gecrediteerd'
export type StatusInfo<K extends string> = { key: K; label: string; cls: string; stip: string; uitleg: string }

export const VERZENDSTATUSSEN: StatusInfo<Verzendstatus>[] = [
  { key: 'te_versturen', label: 'Te factureren', cls: 'bg-gray-100 text-gray-700 border-gray-200', stip: 'bg-gray-400', uitleg: 'De factuur moet nog opgemaakt en verstuurd worden.' },
  { key: 'verstuurd', label: 'Verstuurd', cls: 'bg-green-100 text-green-800 border-green-200', stip: 'bg-green-500', uitleg: 'De factuur werd effectief naar de klant verstuurd.' },
  { key: 'geannuleerd', label: 'Geannuleerd', cls: 'bg-red-100 text-red-700 border-red-200', stip: 'bg-red-500', uitleg: 'De factuur hoeft niet meer verstuurd te worden.' },
  { key: 'gecrediteerd', label: 'Gecrediteerd', cls: 'bg-red-100 text-red-700 border-red-200', stip: 'bg-red-600', uitleg: 'De factuur werd geheel gecrediteerd.' },
]
export const VERZENDSTATUS = Object.fromEntries(VERZENDSTATUSSEN.map((s) => [s.key, s])) as Record<Verzendstatus, StatusInfo<Verzendstatus>>

/** Oude en afwijkende waarden naar het model van nu. */
export function normaliseerVerzendstatus(s: string | null | undefined): Verzendstatus {
  switch ((s ?? '').toLowerCase()) {
    case 'verstuurd': case 'gefactureerd': case 'betaald': return 'verstuurd'
    case 'geannuleerd': return 'geannuleerd'
    case 'gecrediteerd': return 'gecrediteerd'
    default: return 'te_versturen'
  }
}

export type Betaalstatus = 'niet_betaald' | 'gedeeltelijk_betaald' | 'betaald' | 'achterstallig'
export const BETAALSTATUSSEN: StatusInfo<Betaalstatus>[] = [
  { key: 'niet_betaald', label: 'Niet betaald', cls: 'bg-gray-100 text-gray-600 border-gray-200', stip: 'bg-gray-400', uitleg: 'Nog geen betaling ontvangen.' },
  { key: 'gedeeltelijk_betaald', label: 'Gedeeltelijk betaald', cls: 'bg-amber-100 text-amber-800 border-amber-200', stip: 'bg-amber-500', uitleg: 'Een deel van het bedrag is ontvangen.' },
  { key: 'betaald', label: 'Betaald', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', stip: 'bg-emerald-600', uitleg: 'Volledig ontvangen.' },
  { key: 'achterstallig', label: 'Achterstallig', cls: 'bg-red-100 text-red-700 border-red-200', stip: 'bg-red-500', uitleg: 'Vervaldatum voorbij en nog niet (volledig) betaald.' },
]
export const BETAALSTATUS = Object.fromEntries(BETAALSTATUSSEN.map((s) => [s.key, s])) as Record<Betaalstatus, StatusInfo<Betaalstatus>>

const bijnaGelijk = (a: number, b: number) => Math.abs(a - b) < 0.005

/**
 * De betaalstatus volgt uit wat er ontvangen is en of de vervaldatum voorbij
 * is. Enkel voor verstuurde facturen; anders null (niet van toepassing).
 */
export function afgeleideBetaalstatus(p: {
  verzendstatus: Verzendstatus
  betaaldBedrag: number | null | undefined
  totaalIncl: number
  vervaldatum: string | null | undefined
  vandaag: string
}): Betaalstatus | null {
  if (p.verzendstatus !== 'verstuurd') return null
  const betaald = Math.max(0, Number(p.betaaldBedrag) || 0)
  if (p.totaalIncl > 0 && (betaald >= p.totaalIncl || bijnaGelijk(betaald, p.totaalIncl))) return 'betaald'
  if (betaald > 0) return 'gedeeltelijk_betaald'
  if (p.vervaldatum && p.vervaldatum < p.vandaag) return 'achterstallig'
  return 'niet_betaald'
}

/**
 * De facturenmodule is een interne planner, geen boekhouding: een factuur blijft
 * in elke status volledig bewerkbaar (klant, regels, bedragen, datums). Elke
 * wijziging komt in de historiek.
 */
export const magInhoudBewerken = (_s: Verzendstatus): boolean => true
/** Geannuleerd of gecrediteerd: telt nergens meer mee als te versturen of te ontvangen. */
export const isAfgesloten = (s: Verzendstatus): boolean => s === 'geannuleerd' || s === 'gecrediteerd'
/** Voor deze overgangen is een reden verplicht (die komt in de historiek). */
export const redenVerplicht = (naar: Verzendstatus): boolean => naar === 'geannuleerd' || naar === 'gecrediteerd'

/** Elke statuswissel is toegestaan (ook terug); enkel "naar dezelfde status" heeft geen zin. */
export function magNaar(van: Verzendstatus, naar: Verzendstatus, _betaaldBedrag = 0): { ok: boolean; reden?: string } {
  if (van === naar) return { ok: false, reden: 'De factuur staat al op deze status.' }
  return { ok: true }
}

/** De drie statussen die de gebruiker kiest (gecrediteerd is een oude variant van geannuleerd). */
export const KIESBARE_STATUSSEN: Verzendstatus[] = ['te_versturen', 'verstuurd', 'geannuleerd']

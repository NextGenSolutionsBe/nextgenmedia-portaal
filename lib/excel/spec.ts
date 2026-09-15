// Het gedeelde model van een Excel-export — GEEN 'server-only', geen imports.
//
// Een dashboard beschrijft zijn export als een "werkmap" (bladen → blokken →
// tabellen/kengetallen) in gewone data. Dat kan zowel in de browser (vanuit
// de cijfers die al op het scherm staan) als op de server (vanuit dezelfde
// pure rekenfuncties). Het schrijven naar een echt .xlsx-bestand gebeurt
// uitsluitend op de server, in lib/excel/xlsx-schrijf.ts.
//
// Formules: een cel kan een formule zijn i.p.v. een waarde. Zo blijft de
// werkmap rekenen wanneer iemand in Excel een bedrag aanpast. In een formule
// mogen deze plaatshouders staan, die de schrijver invult:
//   {R}   het rijnummer van de huidige rij
//   {R1}  het eerste datarijnummer van de tabel
//   {R2}  het laatste datarijnummer van de tabel
// Kolommen zijn gewoon letters (A, B, …): elke tabel begint in kolom A.
// Voor formules naar een ander blad rekent `layoutVan()` de rijnummers uit,
// zodat de opsteller en de schrijver dezelfde posities gebruiken.

export type Stijl =
  | 'tekst' | 'getal' | 'aantal' | 'euro' | 'pct' | 'datum' | 'uren'
  | 'totaal' | 'totaal_euro' | 'totaal_pct' | 'totaal_getal' | 'totaal_aantal' | 'totaal_uren'

export type Basiswaarde = string | number | boolean | null | undefined

/** Een cel: een kale waarde, een datum (YYYY-MM-DD als tekst + stijl 'datum'), of een formule. */
export type Cel =
  | Basiswaarde
  | { f: string; v?: Basiswaarde; stijl?: Stijl }
  | { v: Basiswaarde; stijl?: Stijl }

export type Kolom = {
  kop: string
  stijl?: Stijl
  /** Breedte in tekens; leeg = automatisch op basis van de inhoud. */
  breedte?: number
}

export type TabelBlok = {
  soort: 'tabel'
  titel?: string
  kolommen: Kolom[]
  rijen: Cel[][]
  /** Totaalrij per kolom (formules met {R1}/{R2} zijn hier het handigst). */
  totaal?: Cel[]
  /** Filterknoppen op de koprij (standaard aan). */
  filter?: boolean
  /** Tekst die bij een lege tabel getoond wordt. */
  leeg?: string
}

export type KpiBlok = {
  soort: 'kpis'
  titel?: string
  items: { label: string; waarde: Cel; stijl?: Stijl; toelichting?: string }[]
}

export type TekstBlok = { soort: 'tekst'; titel?: string; regels: string[] }

export type Blok = TabelBlok | KpiBlok | TekstBlok

export type Blad = {
  /** Max 31 tekens, zonder [ ] : * ? / \ — de schrijver kort af en vervangt. */
  naam: string
  titel: string
  toelichting?: string[]
  blokken: Blok[]
}

export type Werkmap = {
  /** Zonder extensie; de schrijver plakt de datum en ".xlsx" erachter. */
  bestandsnaam: string
  titel: string
  /** Actieve filters: worden bovenaan het eerste blad én op elk blad vermeld. */
  filters?: { label: string; waarde: string }[]
  /** Wie/wanneer; de schrijver vult "aangemaakt op" zelf in. */
  bron?: string
  bladen: Blad[]
}

// ── Layout: op welke rijen komt wat? ─────────────────────────────────────────
//
// De opbouw van een blad is vast: titel, toelichting, filters, een lege rij,
// dan de blokken met telkens één lege rij ertussen. Omdat opsteller en
// schrijver dezelfde functie gebruiken, kloppen verwijzingen tussen bladen.

export type BlokLayout = {
  /** Rij van de bloktitel (of van de koprij als er geen titel is). */
  startRij: number
  /** Enkel voor tabellen: de koprij, eerste/laatste datarij en de totaalrij. */
  kopRij?: number
  eersteDataRij?: number
  laatsteDataRij?: number
  totaalRij?: number
  /** Eerste rij ná het blok (inclusief de lege scheidingsrij). */
  volgendeRij: number
}

export function kopRijen(werkmap: Pick<Werkmap, 'filters'>, blad: Pick<Blad, 'toelichting'>): number {
  // Titel + "aangemaakt op" + toelichting + filters + lege rij.
  return 2 + (blad.toelichting?.length ?? 0) + (werkmap.filters?.length ?? 0) + 1
}

export function layoutVan(werkmap: Pick<Werkmap, 'filters'>, blad: Blad): BlokLayout[] {
  const uit: BlokLayout[] = []
  let rij = kopRijen(werkmap, blad) + 1   // 1-gebaseerd: de eerste blokrij
  for (const blok of blad.blokken) {
    const startRij = rij
    if (blok.soort === 'tabel') {
      if (blok.titel) rij++
      const kopRij = rij
      const aantal = blok.rijen.length
      const eersteDataRij = kopRij + 1
      // Een lege tabel houdt één rij vrij voor de "geen gegevens"-melding,
      // zodat SUM-formules in de totaalrij nog steeds een geldig bereik hebben.
      const laatsteDataRij = kopRij + Math.max(1, aantal)
      rij = laatsteDataRij + 1
      const totaalRij = blok.totaal ? rij++ : undefined
      uit.push({ startRij, kopRij, eersteDataRij, laatsteDataRij, totaalRij, volgendeRij: rij + 1 })
      rij += 1
    } else if (blok.soort === 'kpis') {
      if (blok.titel) rij++
      rij += blok.items.length
      uit.push({ startRij, volgendeRij: rij + 1 })
      rij += 1
    } else {
      if (blok.titel) rij++
      rij += blok.regels.length
      uit.push({ startRij, volgendeRij: rij + 1 })
      rij += 1
    }
  }
  return uit
}

/** Kolomindex (0 = A) → kolomletters. */
export function kolomLetter(index: number): string {
  let n = index + 1, s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

/** Bladnaam veilig maken voor Excel én voor gebruik in formules ('Naam'!A1). */
export function veiligeBladnaam(naam: string): string {
  const schoon = naam.replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Blad'
  return schoon.slice(0, 31)
}

/** Verwijzing naar een bereik op een ander blad, met correcte aanhalingstekens. */
export function bladBereik(bladnaam: string, kolom: string, vanRij: number, totRij: number = vanRij): string {
  const naam = veiligeBladnaam(bladnaam).replace(/'/g, "''")
  return `'${naam}'!${kolom}${vanRij}:${kolom}${totRij}`
}

// ── Kleine helpers voor opstellers ───────────────────────────────────────────

export const euro = (v: Basiswaarde): Cel => ({ v: v ?? null, stijl: 'euro' })
export const pct = (v: Basiswaarde): Cel => ({ v: v ?? null, stijl: 'pct' })
export const datum = (v: string | null | undefined): Cel => ({ v: v ? String(v).slice(0, 10) : null, stijl: 'datum' })
export const getal = (v: Basiswaarde): Cel => ({ v: v ?? null, stijl: 'getal' })
export const aantal = (v: Basiswaarde): Cel => ({ v: v ?? null, stijl: 'aantal' })
export const formule = (f: string, v?: Basiswaarde, stijl?: Stijl): Cel => ({ f, v, stijl })
/** SOM over de datarijen van de eigen kolom, voor in een totaalrij. */
export const som = (kolom: string, v?: Basiswaarde, stijl: Stijl = 'totaal_euro'): Cel => ({ f: `SUM(${kolom}{R1}:${kolom}{R2})`, v, stijl })

/** Waarde van een cel (voor wie de gecachte waarde wil lezen). */
export function celWaarde(c: Cel): Basiswaarde {
  if (c === null || c === undefined) return null
  if (typeof c === 'object') return 'f' in c ? (c.v ?? null) : c.v
  return c
}

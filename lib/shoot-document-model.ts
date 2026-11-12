/**
 * Shootdocument — pure logica (geen server-only, testbaar met tsx).
 *
 * De PDF zelf wordt in `lib/shoot-document.ts` getekend; hier staan enkel de
 * hulpfuncties die geen databank of bestandssysteem nodig hebben: tekst in
 * afvinkbare regels splitsen, tekens veilig maken voor de standaardfont en de
 * bestandsnaam opbouwen.
 */

export type ShootDocumentItem = {
  title: string | null
  script: string | null
  media_notes: string | null
  planned_date?: string | null
  content_type?: string | null
  platforms?: string[] | null
  platform?: string | null
}

export type ShootDocumentShoot = {
  datum: string | null
  start: string | null
  einde: string | null
  locatie: string | null
  briefing: string | null
}

/**
 * Vinkvakjes/opsommingstekens die soms al vooraan staan — wij tekenen zelf een
 * vakje, dus die vallen weg. Een streepje enkel als het gevolgd wordt door
 * witruimte (zodat '-5 graden' intact blijft).
 */
const VINKVAKJES = /^(?:[\s☐☑☒□■◻◼▢•]|[-–]\s)+/

/**
 * Splitst een tekst in losse, afvinkbare regels.
 *  1. Handmatige regeleinden blijven altijd behouden.
 *  2. Daarbinnen wordt gesplitst op zinseinden (. ! ? …), eventueel gevolgd
 *     door een sluitend aanhalingsteken of haakje, en dan witruimte.
 *  3. Lege regels vallen weg; de bewoording zelf wordt nooit gewijzigd
 *     (enkel witruimte en een eventueel voorafgaand vinkvakje/streepje).
 */
export function splitsInRegels(tekst: string | null | undefined): string[] {
  const uit: string[] = []
  for (const ruw of String(tekst ?? '').split(/\r?\n/)) {
    const regel = ruw.replace(VINKVAKJES, '').trim()
    if (!regel) continue
    const delen = regel.split(/(?<=[.!?…][)\]"'”’»]*)\s+/)
    for (const d of delen) {
      // Ook een vinkvakje dat midden in de regel vóór een zin stond, valt weg.
      const t = d.replace(VINKVAKJES, '').trim()
      if (t) uit.push(t)
    }
  }
  return uit
}

/**
 * Tekens buiten WinAnsi (emoji, symbolen) verwijderen — de standaardfont van
 * pdf-lib kan ze niet tekenen en zou anders de hele PDF laten mislukken.
 * Slimme aanhalingstekens, gedachtestreepjes, €, … en • zijn wél WinAnsi.
 * Vinkvakjes worden naar leesbare tekst gebracht i.p.v. naar een glyph.
 */
export function veilig(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/[☐□◻▢]/g, '[ ]')
    .replace(/[☑☒■◼]/g, '[x]')
    .replace(/[^\x20-\x7E -ÿ€–—‘’‚“”„…•™]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** ASCII-veilig deel van een bestandsnaam: 'Bakkerij Éclair & Zo' → 'Bakkerij-Eclair-Zo'. */
export function asciiNaamdeel(s: string | null | undefined, terugval: string): string {
  const schoon = String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return schoon || terugval
}

/** `Shootvoorbereiding_<Klant>_<Project>_<YYYY-MM-DD>.pdf` */
export function bestandsnaamShootDocument(klantNaam: string, projectNaam: string, datumIso: string): string {
  const dag = /^\d{4}-\d{2}-\d{2}/.test(datumIso) ? datumIso.slice(0, 10) : new Date().toISOString().slice(0, 10)
  return `Shootvoorbereiding_${asciiNaamdeel(klantNaam, 'Klant')}_${asciiNaamdeel(projectNaam, 'Social-media')}_${dag}.pdf`
}

/** Heeft deze set items überhaupt iets om af te drukken? */
export function heeftInhoud(items: ShootDocumentItem[]): boolean {
  return items.some((it) => splitsInRegels(it.script).length > 0 || splitsInRegels(it.media_notes).length > 0)
}

/** Datum in het Nederlands, bv. 'maandag 12 oktober 2026'. */
export function datumLang(iso: string | null | undefined): string {
  if (!iso) return 'Nog te bepalen'
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
}

/** Korte datum, bv. '12 okt 2026'. */
export function datumKort(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Brussels' })
}

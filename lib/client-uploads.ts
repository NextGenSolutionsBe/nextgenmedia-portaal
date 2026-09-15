/**
 * Klantuploads — gedeelde regels.
 *
 * Los bestand zodat het portaal, de admin én de tests dezelfde grenzen
 * gebruiken. Zou elk van die drie zijn eigen lijstje hanteren, dan accepteert
 * de ene wat de andere weigert en krijg je bestanden die nergens te openen zijn.
 */

export const BUCKET = 'client-uploads'

/**
 * Wat mag erin. Bewust een witte lijst en geen zwarte: bij een zwarte lijst is
 * alles wat je vergeet automatisch toegestaan, en dat is precies de verkeerde
 * kant om je te vergissen. HEIC staat erbij omdat iPhones daar standaard in
 * fotograferen — zonder dat werkt de helft van de uploads niet.
 */
export const TOEGESTAAN: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
}

/** 200 MB. Ruim genoeg voor een telefoonvideo, krap genoeg om te merken dat er
 *  iets misgaat voordat de opslag vol loopt. */
export const MAX_BYTES = 200 * 1024 * 1024

export const STATUSSEN = ['nieuw', 'gezien', 'verwerkt'] as const
export type Status = (typeof STATUSSEN)[number]

export const STATUS_LABELS: Record<Status, string> = {
  nieuw: 'Nieuw',
  gezien: 'Gezien',
  verwerkt: 'Verwerkt',
}

export function mimeToegestaan(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOEGESTAAN, String(mime ?? '').toLowerCase())
}

export const isVideo = (mime: string | null | undefined) =>
  String(mime ?? '').toLowerCase().startsWith('video/')

/** Leesbare bestandsgrootte, bv. "3,4 MB". */
export function leesbareGrootte(bytes: number | null | undefined): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/**
 * Het pad in de bucket.
 *
 * Het client_id staat vooraan, en dat is geen ordeningskeuze maar een
 * beveiligingsmaatregel: bij het bevestigen controleren we dat het pad met het
 * eigen client_id begint. Zo kan een klant nooit een pad meesturen dat naar het
 * materiaal van iemand anders wijst.
 *
 * De oorspronkelijke bestandsnaam gebruiken we NIET in het pad — die kan van
 * alles bevatten (schuine strepen, "..", stuurtekens) en is niet nodig; hij
 * wordt apart in de database bewaard, enkel voor de weergave.
 */
export function bouwPad(clientId: string, mime: string, uniek: string): string {
  const ext = TOEGESTAAN[String(mime ?? '').toLowerCase()] ?? 'bin'
  return `${clientId}/${uniek}.${ext}`
}

/** Hoort dit pad bij deze klant? Zie bouwPad voor het waarom. */
export function padHoortBij(pad: unknown, clientId: string): boolean {
  return typeof pad === 'string' && pad.startsWith(`${clientId}/`) && !pad.includes('..')
}

/** Hoe een map heet die er (nog) niet is. Eén plek, zodat portaal en admin
 *  hetzelfde woord gebruiken. */
export const LOSSE_BESTANDEN = 'Losse bestanden'

export const MAP_NAAM_MAX = 80

/**
 * Mapnaam opschonen en controleren.
 *
 * Geeft de opgeschoonde naam terug, of een uitleg waarom het zo niet kan.
 * Bewust één functie voor beide: zou de controle elders staan dan kan er een
 * naam door die de opschoning daarna alsnog leegmaakt.
 */
export function leesMapNaam(invoer: unknown): { naam: string } | { fout: string } {
  // LET OP: schoon(), niet schooneNaam(). Die laatste valt terug op "bestand"
  // als er niets overblijft — dan zou een lege mapnaam stilletjes een map
  // "bestand" opleveren in plaats van een foutmelding.
  const naam = schoon(invoer).slice(0, MAP_NAAM_MAX).trim()
  if (!naam) return { fout: 'Geef de map een naam.' }
  // Anders staan er straks twee dingen met dezelfde naam in de lijst, waarvan
  // er één geen echte map is.
  if (naam.toLowerCase() === LOSSE_BESTANDEN.toLowerCase()) {
    return { fout: `"${LOSSE_BESTANDEN}" is gereserveerd. Kies een andere naam.` }
  }
  return { naam }
}

/**
 * Tekst van een gebruiker geschikt maken als naam.
 *
 * Schuine strepen worden streepjes — anders leest een downloadnaam als een pad.
 * Stuurtekens gaan eruit, want die kunnen een naam in een HTTP-koptekst laten
 * afbreken. De rest blijft staan: "Foto's gevel.jpg" mag gewoon.
 *
 * Bewust met een codepunt-filter en niet met een reguliere expressie vol
 * stuurtekens: zo'n expressie staat vol onzichtbare bytes in de broncode.
 *
 * Geeft een lege string terug als er niets overblijft. De aanroeper beslist wat
 * dat betekent — een bestand krijgt een terugvalnaam, een map hoort geweigerd
 * te worden.
 */
export function schoon(tekst: unknown): string {
  return String(tekst ?? '')
    .replace(/[\\/]/g, '-')
    .split('')
    .filter((teken) => {
      const c = teken.charCodeAt(0)
      return c >= 32 && c !== 127
    })
    .join('')
    .trim()
}

/** Bestandsnaam voor weergave en download. Blijft er niets over, dan een
 *  terugvalnaam: een bestand zonder naam kan je nergens tonen. */
export function schooneNaam(naam: unknown): string {
  return schoon(naam).slice(0, 200) || 'bestand'
}

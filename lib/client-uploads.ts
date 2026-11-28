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
 * fotograferen. Sinds 10 nov 2026 ook documenten, ontwerpbestanden, zip en
 * audio: logo's, huisstijlgidsen, teksten en presentaties komen ook zo binnen.
 * Geen uitvoerbare bestanden en geen html (dat zou in de browser kunnen lopen).
 */
export const TOEGESTAAN: Record<string, string> = {
  // Foto's en beeld
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/tiff': 'tif',
  'image/svg+xml': 'svg',
  // Video
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
  // Documenten
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/rtf': 'rtf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  // Ontwerpbestanden
  'application/illustrator': 'ai',
  'application/postscript': 'eps',
  'image/vnd.adobe.photoshop': 'psd',
  'application/x-indesign': 'indd',
  // Archief en audio
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
}

/**
 * Extensie → type. Browsers geven het type niet altijd (mee): .ai, .psd, .eps,
 * .indd en soms .heic komen binnen als "" of application/octet-stream, een zip
 * op Windows als application/x-zip-compressed. Dan beslist de extensie.
 */
const EXTENSIE_TYPE: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf', txt: 'text/plain', csv: 'text/csv',
  ai: 'application/illustrator', eps: 'application/postscript', psd: 'image/vnd.adobe.photoshop', indd: 'application/x-indesign',
  zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
}

/** Andere schrijfwijzen van hetzelfde type. */
const ALIAS: Record<string, string> = {
  'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/x-png': 'image/png',
  'image/heic-sequence': 'image/heic', 'image/heif-sequence': 'image/heif',
  'application/x-zip-compressed': 'application/zip', 'application/x-zip': 'application/zip', 'multipart/x-zip': 'application/zip',
  'application/x-photoshop': 'image/vnd.adobe.photoshop', 'image/x-photoshop': 'image/vnd.adobe.photoshop', 'image/psd': 'image/vnd.adobe.photoshop',
  'application/x-illustrator': 'application/illustrator', 'application/eps': 'application/postscript', 'image/x-eps': 'application/postscript',
  'application/x-pdf': 'application/pdf', 'text/rtf': 'application/rtf', 'application/csv': 'text/csv',
  'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/x-m4a': 'audio/mp4', 'audio/mp3': 'audio/mpeg',
}

const extensieVan = (naam: unknown) => (String(naam ?? '').match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toLowerCase()

/**
 * Welk type is dit bestand voor ons? Eerst wat de browser zegt (met de andere
 * schrijfwijzen), anders de extensie. Een .ai-bestand dat als
 * application/postscript of application/pdf binnenkomt, blijft een .ai.
 * Niet toegestaan = null.
 */
export function typeVanBestand(naam: unknown, mime: unknown): string | null {
  const m = String(mime ?? '').toLowerCase().split(';')[0].trim()
  const ext = extensieVan(naam)
  const viaExt = EXTENSIE_TYPE[ext] ?? null
  // Ontwerpbestanden: de extensie is betrouwbaarder dan het type (ai = pdf/postscript in veel browsers).
  if (viaExt && ['ai', 'eps', 'psd', 'indd'].includes(ext)) return viaExt
  const t = ALIAS[m] ?? m
  if (t && t !== 'application/octet-stream' && Object.prototype.hasOwnProperty.call(TOEGESTAAN, t)) return t
  return viaExt
}

/** Voor het bestandsvenster: enkel de toegelaten extensies kiezen. */
export const ACCEPT = Object.keys(EXTENSIE_TYPE).map((e) => `.${e}`).join(',')

/** Leesbaar lijstje voor onder de uploadknop. */
export const SOORTEN_TEKST = "foto's, video's, pdf, Word, Excel, PowerPoint, ontwerpbestanden (ai, eps, psd, svg, indd), zip en audio"

/** Hoe tonen we een upload: foto die elke browser toont, video, pdf, of enkel een bestandsicoon. */
export function weergaveVan(mime: string | null | undefined): 'foto' | 'video' | 'pdf' | 'bestand' {
  const m = String(mime ?? '').toLowerCase()
  if (/^image\/(jpeg|png|webp|gif|avif|svg\+xml)$/.test(m)) return 'foto'
  if (m.startsWith('video/')) return 'video'
  if (m === 'application/pdf') return 'pdf'
  return 'bestand'
}

/** "PDF", "DOCX", "AI": het formaat als klein label. */
export function formaatVan(mime: string | null | undefined): string {
  return (TOEGESTAAN[String(mime ?? '').toLowerCase()] ?? 'bestand').toUpperCase()
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

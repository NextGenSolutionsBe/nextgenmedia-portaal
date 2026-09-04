// Schoonmaak van geïmporteerde leaddata. Pure module — geen server-imports,
// zodat dit los testbaar is én in de browser kan draaien voor het voorbeeld.
//
// WAAROM DIT BESTAAT. De vaste leadlijsten bevatten vervuiling: in de
// telefoon-, e-mail- en websitekolommen duiken af en toe kale getallen op
// ("34", "51") — restanten van het samenvoegen van bronbestanden. Een setter
// die "34" als telefoonnummer voorgeschoteld krijgt, verliest vertrouwen in
// het hele scherm. Beter een leeg veld dan een fout veld: leeg zie je meteen,
// fout ontdek je pas midden in een gesprek.

export type SchoonVerslag = {
  /** Aantal veldwaarden dat als onbruikbaar is leeggemaakt. */
  opgeschoond: number
  /** Per veld hoeveel er sneuvelde, bv. { 'contact.email': 3 }. */
  perVeld: Record<string, number>
}

/**
 * Telefoonnummer: minstens 8 cijfers (Belgische nummers hebben er 9 of 10;
 * 8 laat buitenlandse randgevallen door). "34" is er geen.
 *
 * HERSTELT OOK DE LEIDENDE NUL. Excel behandelt een kolom met nummers als
 * getallen en gooit de voorloopnul weg: "0479641277" wordt "479641277" en
 * "09/329.08.78" wordt "93290878". Zo'n nummer verbindt niet als je erop klikt.
 * Een Belgisch nummer zonder landcode dat met 1–9 begint en 8 of 9 cijfers
 * telt, hoort er één voor te krijgen.
 *
 * Nummers mét landcode (+32, 0032) of die al met 0 beginnen laten we met rust,
 * en buitenlandse nummers van andere lengtes ook — daar zouden we het alleen
 * maar erger maken.
 */
export function schoonTelefoon(v: string): string {
  const s = v.trim()
  if (!s) return ''
  const cijfers = s.replace(/\D/g, '')
  if (cijfers.length < 8) return ''
  const heeftLandcode = /^\+/.test(s) || /^00/.test(cijfers)
  if (!heeftLandcode && /^[1-9]/.test(cijfers) && (cijfers.length === 8 || cijfers.length === 9)) {
    // De opmaak van de bron is hier al weg (Excel gaf een kaal getal terug),
    // dus we geven het nummer terug als aaneengesloten cijfers mét de nul.
    return `0${cijfers}`
  }
  return s
}

/**
 * E-mail: iets@iets.iets — meer eisen we niet, minder ook niet.
 *
 * Lijsten dragen geregeld TWEE adressen in één cel ("info@x.be; jan@x.be").
 * De hele cel afkeuren zou allebei de geldige adressen weggooien; we nemen
 * het eerste dat klopt. Kale getallen ("33") halen nog steeds niets.
 */
export function schoonEmail(v: string): string {
  const s = v.trim()
  if (!s) return ''
  const geldig = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (geldig.test(s)) return s
  for (const deel of s.split(/[\s;,/|]+/)) {
    if (geldig.test(deel)) return deel
  }
  return ''
}

/** Website: moet op een domein lijken. Kale getallen en e-mailadressen niet. */
export function schoonWebsite(v: string): string {
  const s = v.trim()
  if (!s || s.includes('@')) return ''
  const zonderSchema = s.replace(/^https?:\/\//i, '')
  // Een domein heeft een punt en minstens één letter.
  return /\./.test(zonderSchema) && /[a-z]/i.test(zonderSchema) ? s : ''
}

/** Vrije tekst (naam, functie, sector…): moet minstens één letter bevatten.
 *  Daarmee sneuvelen de kale indexcijfers, maar "3M" en "4Front" blijven. */
export function schoonTekst(v: string): string {
  const s = v.trim()
  return /[a-zà-ÿ]/i.test(s) ? s : ''
}

/**
 * "10–19" of "20-49" → 10 resp. 20 (de ondergrens), voor de numerieke kolom.
 * Let op de en-dash (–): dat is wat Excel-exporten gebruiken, geen koppelteken.
 * Eén los getal ("35") telt ook. Onbruikbaar → null.
 */
export function werkklasseNaarAantal(v: string): number | null {
  const m = /(\d+)/.exec(v)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export type RuweRij = {
  company: Record<string, string>
  contact: Record<string, string>
}

/** Welke schoonmaak hoort bij welk veld. Wat hier niet staat, blijft zoals het is. */
const REGELS: Record<string, (v: string) => string> = {
  // Ook de bedrijfsnaam: een kaal getal als naam zou een echte lead worden,
  // en die belt iemand dan op. Sneuvelt de naam, dan wordt de rij overgeslagen
  // en gerapporteerd — precies wat er met zo'n rij hoort te gebeuren.
  'company.name': schoonTekst,
  'company.phone': schoonTelefoon,
  'company.email': schoonEmail,
  'company.website': schoonWebsite,
  'company.sector': schoonTekst,
  'company.city': schoonTekst,
  'company.region': schoonTekst,
  'company.activiteit': schoonTekst,
  'contact.name': schoonTekst,
  'contact.role': schoonTekst,
  'contact.email': schoonEmail,
  'contact.phone': schoonTelefoon,
  'contact.mobile': schoonTelefoon,
}

/**
 * Alle rijen schoonmaken. Muteert niets; geeft nieuwe rijen plus een verslag
 * van wat er sneuvelde, zodat de import dat kan tonen in plaats van het stil
 * te laten gebeuren.
 */
export function schoonRijen(rijen: RuweRij[]): { rijen: RuweRij[]; verslag: SchoonVerslag } {
  const perVeld: Record<string, number> = {}
  let opgeschoond = 0

  const uit = rijen.map((r) => {
    const company: Record<string, string> = { ...r.company }
    const contact: Record<string, string> = { ...r.contact }
    for (const [sleutel, regel] of Object.entries(REGELS)) {
      const [groep, veld] = sleutel.split('.')
      const bak = groep === 'company' ? company : contact
      const oud = bak[veld]
      if (oud === undefined || oud === '') continue
      const nieuw = regel(oud)
      if (nieuw !== oud) {
        if (nieuw === '') {
          opgeschoond++
          perVeld[sleutel] = (perVeld[sleutel] ?? 0) + 1
          delete bak[veld]
        } else {
          bak[veld] = nieuw
        }
      }
    }
    return { company, contact }
  })

  return { rijen: uit, verslag: { opgeschoond, perVeld } }
}

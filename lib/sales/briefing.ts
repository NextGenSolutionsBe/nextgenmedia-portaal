/**
 * De omschrijving die in het Google-agenda-item belandt.
 *
 * De closer opent 's ochtends zijn agenda en moet dan alles weten: waar hij
 * moet zijn, wie hij spreekt, welk nummer hij belt als hij vastzit in het
 * verkeer, en wat de setter aan de telefoon gehoord heeft. Hij mag daarvoor
 * niet de app in hoeven.
 *
 * Bewust platte tekst met vaste kopjes: Google Agenda toont dit in een klein
 * venster op een telefoon, en opmaak overleeft dat niet.
 *
 * Los van de rest zodat het te testen is: een omschrijving die halverwege
 * afbreekt of een leeg kopje toont merk je anders pas als de closer voor een
 * dichte deur staat.
 */

export type BriefingInput = {
  bedrijf?: string | null
  contact?: string | null
  telefoon?: string | null
  email?: string | null
  adres?: string | null
  merk?: string | null
  setter?: string | null
  /** Wat de setter aan de telefoon gehoord heeft. */
  briefing?: string | null
  /** Extra opmerking die ook voor de prospect bedoeld is. */
  klantNotitie?: string | null
  meetUrl?: string | null
}

const schoon = (v: string | null | undefined): string => (v ?? '').trim()

export function bouwAgendaOmschrijving(i: BriefingInput): string {
  const blokken: string[] = []

  const wie = [
    schoon(i.contact) && `Contact: ${schoon(i.contact)}`,
    schoon(i.telefoon) && `Telefoon: ${schoon(i.telefoon)}`,
    schoon(i.email) && `E-mail: ${schoon(i.email)}`,
  ].filter(Boolean) as string[]
  if (wie.length) blokken.push(wie.join('\n'))

  // Het adres staat óók in het location-veld van Google, maar niet elke
  // weergave toont dat. Hier herhalen kost niets en scheelt zoeken.
  if (schoon(i.adres)) blokken.push(`Adres:\n${schoon(i.adres)}`)

  const context = [
    schoon(i.merk) && `Voor: ${schoon(i.merk)}`,
    schoon(i.setter) && `Ingeboekt door: ${schoon(i.setter)}`,
  ].filter(Boolean) as string[]
  if (context.length) blokken.push(context.join('\n'))

  if (schoon(i.briefing)) blokken.push(`Briefing van de setter:\n${schoon(i.briefing)}`)
  if (schoon(i.klantNotitie)) blokken.push(`Afgesproken met de prospect:\n${schoon(i.klantNotitie)}`)
  if (schoon(i.meetUrl)) blokken.push(`Online: ${schoon(i.meetUrl)}`)

  return blokken.join('\n\n')
}

/** Titel van het agenda-item. Kort genoeg om op een telefoon leesbaar te zijn. */
export function bouwAgendaTitel(i: BriefingInput): string {
  const bedrijf = schoon(i.bedrijf) || 'Prospect'
  const merk = schoon(i.merk)
  return merk ? `${bedrijf} — ${merk}` : `Afspraak — ${bedrijf}`
}

/**
 * De omschrijving voor een agenda-item MET genodigde.
 *
 * Alles hierboven (bouwAgendaOmschrijving) is een interne briefing — maar
 * zodra er een prospect als genodigde op het event staat, leest die de
 * volledige tekst mee in zijn uitnodiging. "Briefing van de setter" en
 * "Ingeboekt door" horen niet bij een klant in de mailbox te vallen.
 *
 * Dit is daarom de versie die de prospect mag zien: voor welk merk de
 * afspraak is, waar het doorgaat, wat er afgesproken is, en de Meet-link.
 * De volledige briefing blijft bestaan waar hij hoort: in de ClickUp-taak en
 * in de interne melding naar het merkadres.
 */
export function bouwKlantOmschrijving(i: BriefingInput): string {
  const blokken: string[] = []
  if (schoon(i.merk)) blokken.push(`Afspraak met ${schoon(i.merk)}`)
  if (schoon(i.adres)) blokken.push(`Adres:\n${schoon(i.adres)}`)
  if (schoon(i.klantNotitie)) blokken.push(schoon(i.klantNotitie))
  if (schoon(i.meetUrl)) blokken.push(`Online deelnemen: ${schoon(i.meetUrl)}`)
  return blokken.join('\n\n')
}

/**
 * Leesbaar moment van een afspraak in de tijdzone van de agenda, bv.
 * "24/09/2026 om 16:00". Bewust zonder Intl-eigenaardigheden (komma's,
 * vaste spaties) zodat dezelfde tekst ook vanuit SQL te maken is.
 */
export function afspraakMoment(wanneer: string | number | Date, timeZone = 'Europe/Brussels'): string {
  const d = new Date(wanneer)
  const delen = new Intl.DateTimeFormat('nl-BE', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const v = (t: string) => delen.find((x) => x.type === t)?.value ?? ''
  return `${v('day')}/${v('month')}/${v('year')} om ${v('hour')}:${v('minute')}`
}

/**
 * De notitie die bij het boeken op de tijdlijn van de lead komt.
 *
 * De briefing stond tot nu enkel op de afspraak zelf (en in het agenda-item,
 * de ClickUp-taak en de interne mail). In de app zag je daar niets van terug:
 * de tijdlijn toonde "niets genoteerd" terwijl de setter net een halve pagina
 * had ingetikt. Niets ingetikt → null, dan komt er geen lege regel bij.
 */
export function afspraakNotitie(i: { startMs: number; briefing?: string | null; klantNotitie?: string | null; timeZone?: string }): string | null {
  const briefing = schoon(i.briefing), klant = schoon(i.klantNotitie)
  if (!briefing && !klant) return null
  const kop = `Briefing bij de afspraak van ${afspraakMoment(i.startMs, i.timeZone)}:`
  const delen = [briefing ? `${kop}\n${briefing}` : kop]
  if (klant) delen.push(`Afgesproken met de prospect: ${klant}`)
  return delen.join('\n\n')
}

// Meeting Inplanner — mail aan de deelnemers. Enkel een voorstel: de mens past
// ontvangers, onderwerp en tekst aan en klikt zelf op Versturen (MailComposer).
// Puur, zonder server-afhankelijkheden, zodat het ook in tests draait.

import { datumKort, datumLang, uur, tijdzoneLabel, duurMinuten, STANDAARD_TIJDZONE, type Persoon } from '@/lib/meetings/model'

export const INFO_ADRES = 'info@nextgenmedia.be'
/** Staat er nog in de tekst zolang er geen briefing is: de server weigert dan te versturen. */
export const BRIEFING_PLAATSHOUDER = '{{korte briefing: waarover gaat de meeting?}}'

export type MeetingVoorMail = {
  titel: string; starts_at: string; ends_at: string; tijdzone?: string | null; beschrijving: string | null
  meet_url: string | null; vorm?: string | null; locatie?: string | null; met_meet?: boolean | null
  organisator_naam: string | null; organisator_email: string | null
  klant_naam: string; klant_ontvangers: Persoon[]; deelnemers: Persoon[]
}

const naamLijst = (namen: string[]): string => (namen.length <= 1 ? namen.join('') : `${namen.slice(0, -1).join(', ')} en ${namen[namen.length - 1]}`)

export const routeLink = (adres: string): string => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adres)}`

/** Onderwerp, tekst, knop en ontvangers met de gegevens die in de meeting staan. Niets verzonnen. */
export function meetingMailVoorstel(m: MeetingVoorMail): { aan: string[]; onderwerp: string; tekst: string; ctaTekst: string | null; ctaLink: string | null } {
  const tz = m.tijdzone || STANDAARD_TIJDZONE
  const iedereen = [...m.klant_ontvangers, ...m.deelnemers]
  const namen = iedereen.map((p) => p.naam?.split(/\s+/)[0]).filter((n): n is string => !!n)
  const opLocatie = m.vorm === 'locatie' && !!m.locatie
  const meet = m.meet_url && (!opLocatie || m.met_meet) ? m.meet_url : null

  const waar = opLocatie
    ? [`Waar: ${m.locatie}`, meet ? `Liever online? Neem deel via Google Meet: ${meet}` : null]
    : [meet ? `Waar: online via Google Meet\n${meet}` : 'Waar: online via Google Meet (de link staat in de agenda-uitnodiging)']
  const organisator = m.organisator_naam
    ? `Organisator: ${m.organisator_naam}${m.organisator_email ? ` (${m.organisator_email})` : ''}`
    : null

  const tekst = [
    `Beste ${namen.length ? naamLijst(namen) : m.klant_naam},`,
    `Hierbij de praktische info voor onze meeting "${m.titel}".`,
    [`Wanneer: ${datumLang(m.starts_at, tz)} om ${uur(m.starts_at, tz)} (${tijdzoneLabel(tz)}), ${duurMinuten(m.starts_at, m.ends_at)} minuten`, ...waar, organisator]
      .filter(Boolean).join('\n'),
    `Waarover gaat het?\n${m.beschrijving?.trim() || BRIEFING_PLAATSHOUDER}`,
    `Tot dan,\n${m.organisator_naam ? `${m.organisator_naam}\n` : ''}NextGenMedia`,
  ].join('\n\n')

  return {
    aan: iedereen.map((p) => p.email),
    onderwerp: `Meeting op ${datumKort(m.starts_at, tz)} om ${uur(m.starts_at, tz)}: ${m.titel}`,
    tekst,
    ctaTekst: opLocatie ? 'Route in Google Maps' : meet ? 'Deelnemen via Google Meet' : null,
    ctaLink: opLocatie ? routeLink(m.locatie as string) : meet,
  }
}

/** Het e-mailadres uit "Naam <adres>" (of het adres zelf), in kleine letters. */
export function adresUit(van: string): string {
  const m = van.match(/<([^>]+)>/)
  return (m ? m[1] : van).trim().toLowerCase()
}

/** Ontvangers uit een vrij veld (komma, puntkomma of nieuwe regel). */
export function splitsAdressen(v: unknown): string[] {
  const lijst = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[,;\n]/)
  const gezien = new Set<string>()
  const uit: string[] = []
  for (const x of lijst) {
    const a = x.trim().toLowerCase()
    if (!a || gezien.has(a)) continue
    gezien.add(a)
    uit.push(a)
  }
  return uit
}

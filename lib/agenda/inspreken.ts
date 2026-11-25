import { naamSleutel, plusDagen } from '@/lib/agenda/model'

/**
 * Een taak inspreken: de AI leest wat je zei ("titel meeting X, beschrijving …,
 * om vijf uur moet het af zijn, Bram en Marco erop") en geeft een voorstel.
 * Hier enkel het nakijken: niets wat niet klopt komt in het formulier, en er
 * wordt niets bewaard tot iemand op Toevoegen klikt.
 */

export type InspreekVoorstel = {
  titel: string
  beschrijving: string | null
  soort: 'taak' | 'meeting'
  /** Wanneer je eraan werkt of wanneer de afspraak is. */
  dag: string | null
  van: string | null
  tot: string | null
  /** Tegen wanneer het af moet. */
  deadline_dag: string | null
  deadline_uur: string | null
  toegewezen: string[]
  /** Namen die de AI hoorde maar die we niet kennen. */
  nietGevonden: string[]
  lijst_id: string | null
  urgent: boolean
  opmerking: string | null
}

export type InspreekContext = {
  vandaag: string
  personen: { id: string; naam: string; actief: boolean; metAccount: boolean }[]
  lijsten: { id: string; label: string }[]
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/
const UUR = /^([01]\d|2[0-3]):[0-5]\d$/
const tekst = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+\n/g, '\n').trim().slice(0, max) : null)
const datum = (v: unknown, c: InspreekContext): string | null => {
  if (typeof v !== 'string' || !DATUM.test(v) || !Number.isFinite(Date.parse(`${v}T12:00:00Z`))) return null
  // Een datum ver in het verleden of meer dan een jaar vooruit is een misverstand.
  if (v < plusDagen(c.vandaag, -1) || v > plusDagen(c.vandaag, 400)) return null
  return v
}
const uur = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const m = v.trim().replace(/[u.h]/i, ':').match(/^(\d{1,2}):?(\d{2})?$/)
  if (!m) return null
  const t = `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`
  return UUR.test(t) ? t : null
}

/** Een naam die de AI hoorde ("Bram", "marco castermans") → de persoon. Een voornaam die twee keer voorkomt: wie een account heeft. */
export function zoekPersoon(naam: string, personen: InspreekContext['personen']): string | null {
  const k = naamSleutel(naam)
  if (!k) return null
  const actief = personen.filter((p) => p.actief)
  const volledig = actief.filter((p) => naamSleutel(p.naam) === k)
  if (volledig.length === 1) return volledig[0].id
  const voornaam = actief.filter((p) => naamSleutel(p.naam.split(' ')[0]) === k)
  if (voornaam.length === 1) return voornaam[0].id
  const metAccount = voornaam.filter((p) => p.metAccount)
  return metAccount.length === 1 ? metAccount[0].id : null
}

/** Het antwoord van de AI nakijken. */
export function leesInspreekVoorstel(r: unknown, c: InspreekContext): InspreekVoorstel | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  const titel = tekst(o.titel, 200)
  if (!titel) return null
  const soort = o.soort === 'meeting' ? 'meeting' : 'taak'
  const dag = datum(o.datum, c)
  let van = dag ? uur(o.van) : null
  let tot = dag && van ? uur(o.tot) : null
  if (van && tot && tot <= van) tot = null
  // Een afspraak zonder einde duurt een uur.
  if (soort === 'meeting' && van && !tot) {
    const [h, m] = van.split(':').map(Number)
    tot = h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  if (!dag) van = null
  const deadlineUur = uur(o.deadline_uur)
  // Een uur zonder dag = vandaag (of de dag van de taak).
  const deadlineDag = datum(o.deadline_datum, c) ?? (deadlineUur ? dag ?? c.vandaag : null)
  const namen = Array.isArray(o.personen) ? o.personen.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 10) : []
  const toegewezen: string[] = []
  const nietGevonden: string[] = []
  for (const n of namen) {
    const id = zoekPersoon(n, c.personen)
    if (id) { if (!toegewezen.includes(id)) toegewezen.push(id) } else nietGevonden.push(n.trim())
  }
  const idx = Number(o.lijst)
  const lijst = Number.isInteger(idx) && idx >= 1 && idx <= c.lijsten.length ? c.lijsten[idx - 1].id : null
  return {
    titel, beschrijving: tekst(o.beschrijving, 5000), soort,
    dag, van, tot,
    deadline_dag: deadlineDag, deadline_uur: deadlineDag ? deadlineUur ?? '17:00' : null,
    toegewezen, nietGevonden, lijst_id: lijst, urgent: o.urgent === true, opmerking: tekst(o.onduidelijk, 300),
  }
}

/** De vraag aan de AI. De lijsten genummerd, zodat het antwoord een nummer is en niets anders. */
export function inspreekPrompt(zin: string, c: InspreekContext, ikNaam: string): string {
  const dag = new Date(`${c.vandaag}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const mensen = c.personen.filter((p) => p.actief).map((p) => p.naam).join(', ')
  const lijsten = c.lijsten.map((l, i) => `${i + 1}. ${l.label}`).join('\n')
  return `Iemand van ons team (${ikNaam}) sprak een taak of afspraak in voor de agenda. Vandaag is het ${dag} (${c.vandaag}), Belgische tijd.

Wat er ingesproken werd:
"""
${zin.slice(0, 4000)}
"""

Teamleden: ${mensen}

Mappen en lijsten (klanten en projecten):
${lijsten || '(geen)'}

Geef UITSLUITEND geldige JSON:
{"titel": "korte titel, max 80 tekens, zoals iemand ze zelf zou typen", "beschrijving": "wat er verder gezegd werd (details, wat erin moet), als gewone tekst met lijstjes '- ' waar dat past, of null", "soort": "taak of meeting", "datum": "JJJJ-MM-DD waarop het gepland is of de afspraak doorgaat, of null", "van": "HH:MM of null", "tot": "HH:MM of null", "deadline_datum": "JJJJ-MM-DD of null", "deadline_uur": "HH:MM of null", "personen": ["voornamen of namen van wie de taak doet, zoals ze in de lijst staan"], "lijst": nummer uit de lijst hierboven of null, "urgent": true of false, "onduidelijk": "één korte zin als iets niet duidelijk was, anders null"}

Regels:
- "titel is …", "beschrijving is …": neem dat letterlijk over (netjes geschreven).
- "tegen", "moet af zijn om", "deadline", "ten laatste", "voor vijf uur" = deadline (niet datum/van). Een uur zonder dag = vandaag. "vrijdag" = de eerstvolgende vrijdag.
- Een afspraak, meeting of call op een uur = soort "meeting" met datum en van (en tot als die genoemd werd). Anders soort "taak".
- "ik", "mij", "voor mij" = ${ikNaam}. Niemand genoemd = lege lijst.
- Kies een lijst enkel als de klant of het project duidelijk genoemd werd; twijfel = null.
- Verzin niets: geen uren, datums of namen die niet gezegd werden.`
}

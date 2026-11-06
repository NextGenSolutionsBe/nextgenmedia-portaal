// Planningkleur in de contentkalender (vraag van ERA nobis) — pure regel, getest in tests/planning-kleur.test.ts.
//
// Naast de gewone statuskleuren kan de kalender kleuren op planning:
//   oranje = geplaatst   → als gepubliceerd gemarkeerd, of ingepland en het moment is voorbij
//   groen  = ingepland   → status "Ingepland" (in Meta/Metricool ingepland), moment nog niet voorbij
//   wit    = nog niets   → staat in de kalender, maar is nog niet ingepland
// De status zelf verandert niet; dit is enkel een andere kijk.

export type Planningkleur = 'geplaatst' | 'ingepland' | 'niet_ingepland'

export const PLANNING_STIJL: Record<Planningkleur, { badge: string; dot: string; label: string }> = {
  geplaatst: { badge: 'bg-orange-200 text-orange-950 border-orange-400', dot: 'bg-orange-500', label: 'Geplaatst' },
  ingepland: { badge: 'bg-green-200 text-green-950 border-green-500', dot: 'bg-green-600', label: 'Ingepland (Meta)' },
  niet_ingepland: { badge: 'bg-white text-gray-700 border-gray-300', dot: 'bg-white border border-gray-400', label: 'Nog niet ingepland' },
}

/**
 * @param nu  huidig moment in Brussel: { dag: 'JJJJ-MM-DD', tijd: 'UU:MM' }
 */
export function planningkleur(item: { status: string; planned_date: string; planned_time?: string | null }, nu: { dag: string; tijd: string }): Planningkleur {
  if (item.status === 'published') return 'geplaatst'
  if (item.status !== 'scheduled') return 'niet_ingepland'
  const dag = String(item.planned_date ?? '').slice(0, 10)
  if (!dag) return 'ingepland'
  if (dag < nu.dag) return 'geplaatst'
  // Vandaag: met tijdstip pas geplaatst als dat moment voorbij is; zonder tijdstip blijft het ingepland tot morgen.
  if (dag === nu.dag && item.planned_time && item.planned_time.slice(0, 5) <= nu.tijd) return 'geplaatst'
  return 'ingepland'
}

/** Het huidige moment in Brussel. */
export function nuInBrussel(d = new Date()): { dag: string; tijd: string } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? '00'
  return { dag: `${g('year')}-${g('month')}-${g('day')}`, tijd: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` }
}

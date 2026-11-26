// Dag afsluiten: alles wat van jouw dag (of eerder) nog open staat, met per taak
// gedaan, naar de volgende werkdag of een andere dag. Enkel regels, geen databank.
import { dag, uur, zoneNaarIso, plusDagen, plaatsVan, enkelDeadline, vandaag, type Item } from './model'

const TZ = 'Europe/Brussels'
const weekdag = (d: string) => ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
const dagenTussen = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
const schuif = (iso: string | null, n: number) => (iso ? zoneNaarIso(plusDagen(dag(iso, TZ), n), uur(iso, TZ)) : null)

/** De werkdag na deze dag: na vrijdag (en in het weekend) is dat maandag. */
export function volgendeWerkdag(d: string): string {
  let x = plusDagen(d, 1)
  while (weekdag(x) > 5) x = plusDagen(x, 1)
  return x
}

export type NaarDag = { start_op: string | null; eind_op: string | null; heel_dag: boolean; deadline_op: string | null }

/**
 * Een item naar een andere dag. Uren blijven. Een taak over meerdere dagen wordt
 * een taak van die ene dag. Een deadline die vóór de nieuwe dag valt, schuift mee
 * naar die dag (zelfde uur); een latere deadline blijft staan.
 */
export function naarDag(i: Pick<Item, 'start_op' | 'eind_op' | 'heel_dag' | 'deadline_op'>, doel: string): NaarDag | null {
  const p = plaatsVan(i)
  if (!p) return null
  const dl = i.deadline_op && dag(i.deadline_op, TZ) < doel ? zoneNaarIso(doel, uur(i.deadline_op, TZ)) : i.deadline_op
  if (enkelDeadline(i)) {
    const n = dagenTussen(dag(i.deadline_op!, TZ), doel)
    return { start_op: null, eind_op: schuif(i.eind_op, n), heel_dag: false, deadline_op: schuif(i.deadline_op, n) }
  }
  if (p.soort === 'rooster') { const n = dagenTussen(p.dag, doel); return { start_op: schuif(i.start_op, n), eind_op: schuif(i.eind_op, n), heel_dag: false, deadline_op: dl } }
  if (p.van === p.tot) { const n = dagenTussen(p.tot, doel); return { start_op: schuif(i.start_op, n), eind_op: schuif(i.eind_op, n), heel_dag: i.heel_dag, deadline_op: dl } }
  return { start_op: null, eind_op: zoneNaarIso(doel, i.eind_op ? uur(i.eind_op, TZ) : '00:00'), heel_dag: true, deadline_op: dl }
}

/** De laatste dag waarop een item staat. */
export function laatsteDag(i: Pick<Item, 'start_op' | 'eind_op' | 'heel_dag' | 'deadline_op'>): string | null {
  const p = plaatsVan(i)
  return p ? (p.soort === 'rooster' ? p.dag : p.tot) : null
}

/** Is dit item van jou: enkel als je er zelf op staat (assignee). Wat je maakte zonder er zelf op te staan, telt niet. */
export const vanMij = (i: Pick<Item, 'toegewezen'>, ik: string) => i.toegewezen.includes(ik)

/** Hoe ver terug we open taken meenemen. */
export const DAGEN_TERUG = 30

/**
 * Wat er bij het afsluiten van `d` op tafel komt:
 * - taken waar jij op staat (assignee) die nog open staan en op `d` of eerder (tot 30 dagen terug) eindigen, oudste eerst;
 * - meetings op `d` waar jij op staat (om af te vinken en er meteen taken uit te halen).
 * Wat over meerdere dagen loopt en pas na `d` eindigt, hoort er niet bij.
 */
export function afTeSluiten(items: Item[], opts: { ik: string; dag: string }): { taken: Item[]; meetings: Item[] } {
  const van = plusDagen(opts.dag, -DAGEN_TERUG)
  const taken: Item[] = [], meetings: Item[] = []
  for (const i of items) {
    // Een shoot staat in de Shoot planner, niet om hier af te sluiten.
    if (i.bron === 'shoot' || !vanMij(i, opts.ik)) continue
    const laatste = laatsteDag(i)
    if (!laatste) continue
    const isMeeting = i.bron === 'meeting' || i.soort === 'meeting'
    if (isMeeting) {
      const p = plaatsVan(i)
      const eerste = p ? (p.soort === 'rooster' ? p.dag : p.van) : null
      if (eerste && eerste <= opts.dag && laatste >= opts.dag) meetings.push(i)
      continue
    }
    if (i.status === 'klaar') continue
    if (laatste <= opts.dag && laatste >= van) taken.push(i)
  }
  const sleutel = (i: Item) => `${laatsteDag(i)}|${i.start_op ?? i.deadline_op ?? i.eind_op ?? ''}`
  taken.sort((a, b) => sleutel(a).localeCompare(sleutel(b)) || a.titel.localeCompare(b.titel))
  meetings.sort((a, b) => (a.start_op ?? '').localeCompare(b.start_op ?? ''))
  return { taken, meetings }
}

/** "vandaag", "gisteren", "3 dagen geleden" voor een dag tegenover vandaag. */
export function hoeLangOpen(d: string, nu: Date = new Date()): string {
  const n = dagenTussen(d, vandaag(nu))
  if (n <= 0) return 'vandaag'
  if (n === 1) return 'gisteren'
  return `${n} dagen geleden`
}

/** Een notitie bij het afsluiten onderaan de beschrijving, met de datum ervoor. */
export function notitieErbij(beschrijving: string | null, notitie: string, d: string): string {
  const n = notitie.trim()
  if (!n) return beschrijving ?? ''
  const datum = new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const oud = (beschrijving ?? '').trimEnd()
  return `${oud ? `${oud}\n\n` : ''}**Dag afgesloten ${datum}:** ${n}`
}

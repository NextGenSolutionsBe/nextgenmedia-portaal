/**
 * Agenda-abonnement (iCal) per persoon of team (verbeterplan fase 3). Pure opbouw van het
 * agendabestand, getest in tests/agenda-team.test.ts. Enkel wat de persoon in de app mag zien;
 * zonder beschrijving (die kan gevoelig zijn): titel, tijd, plaats en een link naar de app.
 */
import { dag, plusDagen, TZ, type Item } from './model'

const ics = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const tijd = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const datum = (d: string) => d.replace(/-/g, '')
/** Lange regels vouwen (RFC 5545: hoogstens 75 tekens per regel). */
function vouw(r: string): string {
  if (r.length <= 74) return r
  const delen: string[] = []
  let rest = r
  delen.push(rest.slice(0, 74)); rest = rest.slice(74)
  while (rest.length > 73) { delen.push(rest.slice(0, 73)); rest = rest.slice(73) }
  if (rest) delen.push(rest)
  return delen.join('\r\n ')
}

export function icalFeed(items: Item[], o: { naam: string; appUrl: string; nu?: Date }): string {
  const stempel = tijd((o.nu ?? new Date()).toISOString())
  const regels = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NextGen Agency//Agenda//NL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${ics(o.naam)}`, 'X-PUBLISHED-TTL:PT30M', 'REFRESH-INTERVAL;VALUE=DURATION:PT30M']
  for (const i of items) {
    if (i.status === 'klaar') continue
    const s = i.start_op ?? i.deadline_op, e = i.eind_op ?? i.deadline_op
    if (!s || !e) continue
    regels.push('BEGIN:VEVENT', `UID:${i.id.replace(/[^A-Za-z0-9:-]/g, '')}@agenda.nextgenagency`, `DTSTAMP:${stempel}`)
    if (i.heel_dag || (!i.start_op && i.deadline_op && !i.eind_op)) {
      const van = dag(s, TZ), tot = dag(e, TZ)
      regels.push(`DTSTART;VALUE=DATE:${datum(van)}`, `DTEND;VALUE=DATE:${datum(plusDagen(tot >= van ? tot : van, 1))}`)
    } else {
      const eind = Date.parse(e) > Date.parse(s) ? e : new Date(Date.parse(s) + 30 * 60_000).toISOString()
      regels.push(`DTSTART:${tijd(s)}`, `DTEND:${tijd(eind)}`)
    }
    regels.push(`SUMMARY:${ics(i.titel)}`)
    if (i.locatie) regels.push(`LOCATION:${ics(i.locatie)}`)
    const link = i.bron === 'ag' ? `${o.appUrl}/admin/agenda?item=${i.id}` : `${o.appUrl}/admin/agenda`
    regels.push(`URL:${link}`, `DESCRIPTION:${ics(i.meet_url ? `Meet: ${i.meet_url}\nIn de app: ${link}` : `In de app: ${link}`)}`, 'TRANSP:OPAQUE', 'END:VEVENT')
  }
  regels.push('END:VCALENDAR')
  return regels.map(vouw).join('\r\n') + '\r\n'
}

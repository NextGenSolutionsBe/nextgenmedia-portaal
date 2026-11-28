// Beltijd — pure module (client én server, getest in tests/sales-statistieken.test.ts).
//
// "Gelogde beltijd" is de tijd dat iemand aan het bellen was: een sessie die je
// start en stopt (of achteraf handmatig invoert), los van de individuele
// gesprekken. NIET hetzelfde als de "totale gespreksduur", die de som is van de
// duur die bij elk geregistreerd telefoongesprek werd ingevuld. De twee worden
// nooit opgeteld: ze meten iets anders en staan apart op het scherm.
//
// TELREGELS
//  · Een sessie telt in de periode waarin ze STARTTE.
//  · Een lopende sessie (einde_op leeg) telt tot nu.
//  · Zacht verwijderde sessies tellen niet.
//  · Negatieve of kapotte duur telt als 0.

export type BeltijdSessie = {
  id: string
  medewerker_id: string
  medewerker_email?: string | null
  start_op: string
  einde_op: string | null
  duur_seconden: number | null
  notitie?: string | null
  verwijderd_op?: string | null
  created_at?: string
}

/** Langer dan een werkdag handmatig invoeren is vrijwel zeker een typfout. */
export const MAX_HANDMATIG_MINUTEN = 12 * 60

/** Duur van één sessie in seconden op moment `nuMs`. */
export function sessieSeconden(s: BeltijdSessie, nuMs: number): number {
  if (s.verwijderd_op) return 0
  const start = new Date(s.start_op).getTime()
  if (!s.einde_op) {
    if (!Number.isFinite(start)) return 0
    return Math.max(0, Math.round((nuMs - start) / 1000))
  }
  if (typeof s.duur_seconden === 'number' && Number.isFinite(s.duur_seconden)) return Math.max(0, Math.round(s.duur_seconden))
  const einde = new Date(s.einde_op).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(einde)) return 0
  return Math.max(0, Math.round((einde - start) / 1000))
}

export type BeltijdFilter = { van?: Date | string; tot?: Date | string; medewerkerId?: string; nu?: number }

const ms = (d: Date | string | undefined): number | null => {
  if (d === undefined) return null
  const t = (d instanceof Date ? d : new Date(d)).getTime()
  return Number.isFinite(t) ? t : null
}

/** De sessies die in het filter vallen (niet verwijderd, start in [van, tot)). */
export function sessiesIn(sessies: BeltijdSessie[], f: BeltijdFilter = {}): BeltijdSessie[] {
  const van = ms(f.van), tot = ms(f.tot)
  return sessies.filter((s) => {
    if (s.verwijderd_op) return false
    if (f.medewerkerId && s.medewerker_id !== f.medewerkerId) return false
    const t = new Date(s.start_op).getTime()
    if (!Number.isFinite(t)) return false
    if (van !== null && t < van) return false
    if (tot !== null && t >= tot) return false
    return true
  })
}

/** Som van de gelogde beltijd in seconden. */
export function beltijdSeconden(sessies: BeltijdSessie[], f: BeltijdFilter = {}): number {
  const nu = f.nu ?? Date.now()
  return sessiesIn(sessies, f).reduce((t, s) => t + sessieSeconden(s, nu), 0)
}

/** Gelogde beltijd per medewerker (auth-id → seconden). */
export function beltijdPerMedewerker(sessies: BeltijdSessie[], f: BeltijdFilter = {}): Map<string, number> {
  const nu = f.nu ?? Date.now()
  const uit = new Map<string, number>()
  for (const s of sessiesIn(sessies, f)) uit.set(s.medewerker_id, (uit.get(s.medewerker_id) ?? 0) + sessieSeconden(s, nu))
  return uit
}

/** De lopende sessie van een medewerker, of null. */
export function lopendeSessie(sessies: BeltijdSessie[], medewerkerId: string): BeltijdSessie | null {
  return sessies.find((s) => !s.verwijderd_op && !s.einde_op && s.medewerker_id === medewerkerId) ?? null
}

/** Seconden → "2 u 05 min" / "12 min" / "—" (leesbaarder dan 2:05:00 voor een dagtotaal). */
export function toonUren(seconden: number | null | undefined): string {
  if (seconden === null || seconden === undefined || !Number.isFinite(seconden) || seconden < 0) return '—'
  const min = Math.round(seconden / 60)
  const u = Math.floor(min / 60)
  const m = min % 60
  if (u === 0) return `${m} min`
  return `${u} u ${String(m).padStart(2, '0')} min`
}

/** Seconden → "1:02:05" voor een lopende timer. */
export function toonTimer(seconden: number): string {
  const s = Math.max(0, Math.floor(seconden))
  const u = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return `${u}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

const DELEN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Brussels', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

/** Verschil Brussel − UTC in minuten op moment `t`. */
function brusselOffsetMin(t: number): number {
  const p = Object.fromEntries(DELEN.formatToParts(new Date(t)).map((x) => [x.type, x.value]))
  const alsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second))
  return Math.round((alsUtc - t) / 60000)
}

/** "2026-09-22" + "09:30" in Brusselse tijd → het UTC-moment. Null bij onzin. */
export function brusselNaarUtc(datum: string, tijd = '09:00'): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum)
  const u = /^(\d{1,2}):(\d{2})$/.exec(tijd)
  if (!d || !u) return null
  const [j, m, dag, h, min] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(u[1]), Number(u[2])]
  if (m < 1 || m > 12 || dag < 1 || dag > 31 || h > 23 || min > 59) return null
  const gok = Date.UTC(j, m - 1, dag, h, min)
  let t = gok - brusselOffsetMin(gok) * 60000
  // Eén correctie volstaat rond de zomertijdwissel.
  t = gok - brusselOffsetMin(t) * 60000
  return new Date(t)
}

/** Maandag 00:00 (Brussel) van de week waarin `nu` valt, en de maandag erna. */
export function dezeWeek(nu = new Date()): { van: Date; tot: Date } {
  const p = Object.fromEntries(DELEN.formatToParts(nu).map((x) => [x.type, x.value]))
  const vandaag = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), 12))
  const naarMaandag = (vandaag.getUTCDay() + 6) % 7
  vandaag.setUTCDate(vandaag.getUTCDate() - naarMaandag)
  const maandag = vandaag.toISOString().slice(0, 10)
  const volgende = new Date(vandaag); volgende.setUTCDate(volgende.getUTCDate() + 7)
  return { van: brusselNaarUtc(maandag, '00:00') as Date, tot: brusselNaarUtc(volgende.toISOString().slice(0, 10), '00:00') as Date }
}

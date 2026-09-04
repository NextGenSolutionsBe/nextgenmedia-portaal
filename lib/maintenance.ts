// Onderhoudspakketten (jaarlijks). Pure datumlogica — geen server-only imports,
// zodat dit zowel in servercomponenten als in de UI gebruikt kan worden.

export type MaintenanceClient = {
  id: string
  company_name: string
  maintenance_included?: boolean | null
  maintenance_start_date?: string | null   // 'YYYY-MM-DD'
  maintenance_months?: number | null       // standaard 12
  maintenance_reminder_sent_for?: string | null
}

export type MaintenanceStatus = {
  active: boolean
  startDate: string | null
  endDate: string | null          // 'YYYY-MM-DD'
  daysLeft: number | null         // negatief = verlopen
  expired: boolean
  /** Binnen de herinneringsperiode (≤30 dagen te gaan) en nog niet verlopen. */
  expiringSoon: boolean
  label: string                   // korte, leesbare status
}

export const REMINDER_DAYS = 30

/** Datum-only parse (UTC middernacht) zodat tijdzones nooit een dag verschuiven. */
function parseDate(d: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Einddatum = startdatum + N maanden. Gebruikt kalendermaanden; als de dag niet
 * bestaat in de doelmaand (31 jan + 1 maand) valt hij terug op de laatste dag
 * van die maand i.p.v. door te rollen naar de volgende.
 */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const day = date.getUTCDate()
  const target = new Date(Date.UTC(y, m + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target
}

/** Volledige onderhoudsstatus van één klant op een gegeven moment. */
export function maintenanceStatus(c: MaintenanceClient, now = new Date()): MaintenanceStatus {
  const off: MaintenanceStatus = {
    active: false, startDate: null, endDate: null, daysLeft: null,
    expired: false, expiringSoon: false, label: 'Geen onderhoud',
  }
  if (!c.maintenance_included) return off

  const start = c.maintenance_start_date ? parseDate(c.maintenance_start_date) : null
  if (!start) {
    return { ...off, active: true, label: 'Onderhoud — startdatum ontbreekt' }
  }

  const months = Number(c.maintenance_months) > 0 ? Number(c.maintenance_months) : 12
  const end = addMonths(start, months)

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const daysLeft = Math.round((end.getTime() - today.getTime()) / 86400000)
  const expired = daysLeft < 0
  const expiringSoon = !expired && daysLeft <= REMINDER_DAYS

  const label = expired
    ? `Verlopen op ${formatNL(end)}`
    : daysLeft === 0
      ? 'Loopt vandaag af'
      : `Nog ${daysLeft} ${daysLeft === 1 ? 'dag' : 'dagen'} · tot ${formatNL(end)}`

  return {
    active: true,
    startDate: toISODate(start),
    endDate: toISODate(end),
    daysLeft, expired, expiringSoon, label,
  }
}

export function formatNL(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

/**
 * Moet er NU een herinneringsmail uit voor deze klant?
 * Ja als: onderhoud actief, ≤30 dagen te gaan (of net verlopen) én er is voor
 * díé einddatum nog niet gemaild (maintenance_reminder_sent_for).
 */
export function needsReminder(c: MaintenanceClient, now = new Date()): boolean {
  const s = maintenanceStatus(c, now)
  if (!s.active || !s.endDate) return false
  if (s.daysLeft === null || s.daysLeft > REMINDER_DAYS) return false
  // Ook net-verlopen pakketten mogen één keer een seintje geven (tot 7 dagen na).
  if (s.daysLeft < -7) return false
  return c.maintenance_reminder_sent_for !== s.endDate
}

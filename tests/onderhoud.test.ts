import assert from 'node:assert/strict'
import { maintenanceStatus, resterendTekst, verstreken, onderhoudOpvolgen } from '../lib/maintenance'

const nu = new Date('2026-11-02T10:00:00Z')
const k = (id: string, start: string | null, maanden = 12, aan = true) => ({ id, company_name: id, maintenance_included: aan, maintenance_start_date: start, maintenance_months: maanden })

// Resterende tijd.
const s1 = maintenanceStatus(k('a', '2026-06-01'), nu) // tot 2027-06-01
assert.equal(s1.endDate, '2027-06-01')
assert.equal(resterendTekst(s1, nu), 'nog 6 maanden')
const s2 = maintenanceStatus(k('b', '2025-12-01'), nu) // tot 2026-12-01: 29 dagen
assert.equal(resterendTekst(s2, nu), 'nog 29 dagen')
assert.equal(s2.expiringSoon, true)
const s3 = maintenanceStatus(k('c', '2025-10-30'), nu) // tot 2026-10-30: 3 dagen verlopen
assert.equal(resterendTekst(s3, nu), '3 dagen verlopen')
const s4 = maintenanceStatus(k('d', '2025-11-02'), nu)
assert.equal(resterendTekst(s4, nu), 'Loopt vandaag af')
assert.equal(resterendTekst(maintenanceStatus(k('e', null), nu), nu), 'Startdatum ontbreekt')
assert.equal(resterendTekst(maintenanceStatus(k('f', '2026-01-01', 12, false), nu), nu), 'Geen onderhoud')
// Precies 1 maand + een paar dagen, boven 60 dagen: in maanden.
const s5 = maintenanceStatus(k('g', '2026-01-15', 12), nu) // tot 2027-01-15: 74 dagen
assert.equal(resterendTekst(s5, nu), 'nog 2 maanden')

// Voortgang.
assert.equal(verstreken(maintenanceStatus(k('e', null), nu), nu), null)
const v = verstreken(s1, nu) as number
assert.ok(v > 0.4 && v < 0.5, `verstreken ${v}`)
assert.equal(verstreken(s3, nu), 1)

// Opvolgen: zonder startdatum eerst, dan verlopen, dan binnenkort af; lopende niet.
const lijst = onderhoudOpvolgen([k('lopend', '2026-06-01'), k('binnenkort', '2025-12-01'), k('verlopen', '2025-10-30'), k('geen-start', null), k('uit', '2025-01-01', 12, false)], nu)
assert.deepEqual(lijst.map((x) => x.klant.id), ['geen-start', 'verlopen', 'binnenkort'])

console.log('onderhoud: ok')

import assert from 'node:assert/strict'
import { volgendeStap } from '../lib/opleveringen'

const nu = new Date('2026-11-02T12:00:00Z')
const v = (nummer: number, o: { gedeeld?: string | null; tot?: string | null; finaal?: boolean; bestanden?: number } = {}) => ({
  nummer, is_finaal: o.finaal ?? false, gepubliceerd_op: o.gedeeld ?? null, verloopt_op: o.tot ?? null, verwijderd_op: null, bestanden_aantal: o.bestanden ?? 1,
})
const r = { over: 2 }

assert.equal(volgendeStap({ status: 'concept', versies: [], revisies: r }, nu).tekst, 'Maak een eerste versie en laad de bestanden op')
assert.equal(volgendeStap({ status: 'concept', versies: [v(1, { bestanden: 0 })], revisies: r }, nu).tekst, 'Laad de bestanden van eerste versie op')
assert.equal(volgendeStap({ status: 'concept', versies: [v(1)], revisies: r }, nu).tekst, 'Deel eerste versie met de klant')

// Wacht op de klant: resterende tijd, dringend onder 24 uur, verlopen.
const w = volgendeStap({ status: 'wacht_op_klant', versies: [v(1, { gedeeld: '2026-11-01T12:00:00Z', tot: '2026-11-04T12:00:00Z' })], revisies: r }, nu)
assert.equal(w.tekst, 'Wacht op de klant · nog 2 dagen')
assert.equal(w.dringend, false)
assert.equal(volgendeStap({ status: 'wacht_op_klant', versies: [v(1, { gedeeld: '2026-10-30T12:00:00Z', tot: '2026-11-02T20:00:00Z' })], revisies: r }, nu).dringend, true)
const verlopen = volgendeStap({ status: 'wacht_op_klant', versies: [v(1, { gedeeld: '2026-10-25T12:00:00Z', tot: '2026-10-28T12:00:00Z' })], revisies: r }, nu)
assert.match(verlopen.tekst, /Verlopen zonder reactie/)
assert.equal(verlopen.dringend, true)

// Revisie gevraagd op versie 1 → revisieronde 1 opladen; concept erna → delen.
const rv = volgendeStap({ status: 'revisie_gevraagd', versies: [v(1, { gedeeld: '2026-11-01T12:00:00Z' })], revisies: { over: 1 } }, nu)
assert.equal(rv.tekst, 'Verwerk de feedback en laad revisieronde 1 op')
assert.equal(rv.dringend, true)
assert.equal(volgendeStap({ status: 'revisie_gevraagd', versies: [v(1, { gedeeld: '2026-11-01T12:00:00Z' }), v(2)], revisies: { over: 1 } }, nu).tekst, 'Deel revisieronde 1 met de klant')

assert.equal(volgendeStap({ status: 'goedgekeurd', versies: [v(2, { gedeeld: '2026-11-01T12:00:00Z' })], revisies: r }, nu).tekst, 'Goedgekeurd: laad de finale versie op')
const f = volgendeStap({ status: 'finaal', versies: [v(3, { gedeeld: '2026-11-02T10:00:00Z', tot: '2026-11-05T10:00:00Z', finaal: true })], revisies: r }, nu)
assert.equal(f.klaar, true)
assert.match(f.tekst, /^Klaar\. De klant kan nog downloaden/)

console.log('oplevering-stap: ok')

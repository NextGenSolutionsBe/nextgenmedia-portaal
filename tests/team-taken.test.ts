import assert from 'node:assert/strict'
import { deadlineTekst, taakIsAf, teamTaakOmschrijving, teamTaakMarker, valideerLeadTaak } from '../lib/sales/lead-taken'

assert.deepEqual(deadlineTekst('2026-11-04', '2026-11-04'), { tekst: 'vandaag', telaat: false, vandaag: true })
assert.equal(deadlineTekst('2026-11-05', '2026-11-04').tekst, 'morgen')
assert.equal(deadlineTekst('2026-11-10', '2026-11-04').tekst, 'over 6 dagen')
assert.deepEqual(deadlineTekst('2026-11-02', '2026-11-04'), { tekst: '2 dagen te laat', telaat: true, vandaag: false })
assert.equal(deadlineTekst('2026-11-03', '2026-11-04').tekst, '1 dag te laat')
assert.equal(deadlineTekst(null, '2026-11-04').tekst, 'geen deadline')

assert.equal(taakIsAf({ afgerond_op: null, clickup_status_type: 'open' }), false)
assert.equal(taakIsAf({ afgerond_op: '2026-11-04T10:00:00Z' }), true)
assert.equal(taakIsAf({ clickup_status_type: 'closed' }), true)
assert.equal(taakIsAf({ clickup_status_type: 'done' }), true)
assert.equal(taakIsAf({ clickup_status_type: 'weg' }), true)

const o = teamTaakOmschrijving({ link: 'https://app.nextgenmedia.be/admin', klant: 'Apex Fuel', notitie: 'Zie mail', door: 'bram@nextgenmedia.be', marker: teamTaakMarker('abc') })
assert.match(o.tekst, /Klant: Apex Fuel/)
assert.match(o.tekst, /Ref: ngm-teamtaak:abc/)
assert.match(o.markdown, /\[Command Center\]\(https:\/\/app\.nextgenmedia\.be\/admin\)/)

// Zelfde validatie als bij leads en projecten: merk verplicht (NGM of NGS).
assert.equal(valideerLeadTaak({ omschrijving: 'Iets doen', deadline: '2026-11-05', assignee_id: 5, merk: 'nextgensolutions' }, '2026-11-04').ok, true)
assert.equal(valideerLeadTaak({ omschrijving: 'Iets doen', deadline: '2026-11-05', assignee_id: 5, merk: 'x' }, '2026-11-04').ok, false)
console.log('team-taken: ok')

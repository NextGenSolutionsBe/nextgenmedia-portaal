// Taken bij een opdracht (opdrachtenbord) en de verantwoordelijke in beide
// richtingen gelijk met ClickUp. Echte code (lib/sales/lead-taken*.ts,
// lib/clickup.ts) tegen een nagebootste ClickUp.
//
//   npx tsx tests/opdracht-taken.test.ts

import { tabellen, nepDb, clickup } from './hulp-meetings-nep'
import assert from 'node:assert/strict'
import { opdrachtLink, opdrachtTaakOmschrijving, kiesClickupLid, deadlineMs } from '../lib/sales/lead-taken'
import {
  maakOpdrachtTaak, opdrachtTaken, opdrachtTaakOpnieuw, opdrachtTaakVerantwoordelijke, opdrachtStandaard, leadTaakOpties,
  maakLeadTaak, leadTaken, leadTaakVerantwoordelijke, LeadTaakFout, type OpdrachtTaakRij,
} from '../lib/sales/lead-taken-server'

let n = 0
const test = async (naam: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log(`  ✓ ${naam}`) }
const db = nepDb as never
process.env.NEXT_PUBLIC_SITE_URL = 'https://app.nextgenmedia.be'

const OPDRACHT = 'c0000000-0000-4000-8000-000000000001'
const KLANT = 'd0000000-0000-4000-8000-000000000001'
const LEAD = 'b0000000-0000-4000-8000-000000000009'
tabellen.opdrachten = [{ id: OPDRACHT, titel: 'Aftermovie zomerfeest', client_id: KLANT, klant_vrij: null, verantwoordelijke: 'Marco' }]
tabellen.clients = [{ id: KLANT, company_name: 'Verheyen nv', contact_name: 'Jan Verheyen' }]
tabellen.opdracht_taken = []
tabellen.sales_leads = [{ id: LEAD, assigned_to: null, sales_companies: { name: 'Bakkerij Peeters' }, sales_contacts: { name: 'Ann' } }]
tabellen.sales_lead_taken = []
tabellen.sales_pipelines.push(
  { id: 'p-ngm', key: 'nextgenmedia', name: 'NextGenMedia', clickup_list_id: 'L-NGM' },
  { id: 'p-ngs', key: 'nextgensolutions', name: 'NextGenSolutions', clickup_list_id: 'L-NGS' },
)
const overDagen = (d: number) => new Date(Date.now() + d * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const door = { userId: null, email: 'bram@nextgenmedia.be' }
const BRAM = 200511713, MARCO = 106693123
const invoer = (extra: Record<string, unknown> = {}) => ({ aanvraag_sleutel: crypto.randomUUID(), omschrijving: 'Ruwe montage afwerken', deadline: overDagen(2), notitie: 'Muziek uit de briefing gebruiken.', assignee_id: MARCO, merk: 'nextgenmedia', ...extra })

async function main() {
  console.log('\nOpdrachten — taken in ClickUp met de verantwoordelijke\n')

  await test('1. Verantwoordelijke → ClickUp-lid: op e-mail, op (voor)naam, op begin van het e-mailadres; twijfel = niemand', () => {
    const leden = [{ id: 1, naam: 'Bram Reinquin', email: 'bram@nextgenmedia.be' }, { id: 2, naam: 'Marco', email: 'castermansmarco2504@gmail.com' }, { id: 3, naam: 'Chiara Walmagh', email: 'chiara@nextgenmedia.be' }]
    assert.equal(kiesClickupLid(leden, { email: 'BRAM@nextgenmedia.be' }), 1)
    assert.equal(kiesClickupLid(leden, { naam: 'Bram' }), 1)
    assert.equal(kiesClickupLid(leden, { naam: 'marco castermans' }), 2)
    assert.equal(kiesClickupLid(leden, { naam: 'Chiara' }), 3)
    assert.equal(kiesClickupLid(leden, { naam: 'Senne' }), null)
    assert.equal(kiesClickupLid([...leden, { id: 4, naam: 'Bram Peeters', email: 'bram.peeters@x.be' }], { naam: 'Bram' }), null, 'twee Brams: de mens kiest')
  })

  await test('2. Omschrijving in ClickUp: bedrijf en titel met een klikbare link naar de kaart', () => {
    const link = opdrachtLink('https://app.nextgenmedia.be/', OPDRACHT)
    assert.equal(link, `https://app.nextgenmedia.be/admin/opdrachten?opdracht=${OPDRACHT}`)
    const o = opdrachtTaakOmschrijving({ link, bedrijf: 'Verheyen nv', titel: 'Aftermovie', contact: null, notitie: null, door: null, marker: 'ngm-opdrachttaak:x' })
    assert.ok(o.markdown.includes(`[Verheyen nv – Aftermovie](${link})`))
    assert.ok(o.tekst.includes('Ref: ngm-opdrachttaak:x'))
  })

  await test('3. Venster: de verantwoordelijke van de opdracht staat al geselecteerd (niet wie ingelogd is)', async () => {
    const o = await leadTaakOpties(db, 'bram@nextgenmedia.be', await opdrachtStandaard(db, OPDRACHT))
    assert.equal(o.ik, BRAM)
    assert.equal(o.standaard, MARCO)
    const zonder = await leadTaakOpties(db, 'bram@nextgenmedia.be', { naam: 'Iemand anders' })
    assert.equal(zonder.standaard, BRAM, 'geen match: wie het venster open heeft')
  })

  let taak: OpdrachtTaakRij
  await test('4. Taak bij een opdracht: gewone ClickUp-taak, toegewezen aan de verantwoordelijke, link naar de kaart', async () => {
    const voor = clickup.aangemaakt
    ;({ taak } = await maakOpdrachtTaak(db, OPDRACHT, invoer(), door))
    assert.equal(clickup.aangemaakt, voor + 1)
    assert.equal(taak.sync_status, 'ok')
    assert.equal(taak.opdracht_id, OPDRACHT)
    const cu = clickup.taken.get(taak.clickup_task_id!)!
    assert.equal(cu.list, 'L-NGM')
    assert.equal(cu.name, 'Ruwe montage afwerken (Verheyen nv)')
    assert.deepEqual(cu.assignees, [MARCO])
    assert.equal(cu.due_date, deadlineMs(overDagen(2)))
    assert.equal(cu.due_date_time, false)
    assert.equal(cu.start_date, undefined, 'geen agenda-item')
    assert.ok(String(cu.description).includes(`/admin/opdrachten?opdracht=${OPDRACHT}`))
    assert.ok(String(cu.description).includes('ngm-opdrachttaak:'))
    assert.equal(tabellen.sales_lead_taken.length, 0, 'niet bij de leadtaken')
    const nog = await maakOpdrachtTaak(db, OPDRACHT, { ...invoer(), aanvraag_sleutel: taak.aanvraag_sleutel }, door)
    assert.equal(nog.herhaald, true)
    assert.equal(clickup.aangemaakt, voor + 1, 'dubbele klik: geen tweede taak')
  })

  await test('5. Verantwoordelijke wijzigen in de app: ook in ClickUp (oude eraf, nieuwe erop)', async () => {
    const t = await opdrachtTaakVerantwoordelijke(db, OPDRACHT, taak.id, BRAM)
    assert.equal(t.clickup_assignee_id, BRAM)
    assert.equal(t.clickup_assignee_naam, 'Bram')
    assert.deepEqual(clickup.taken.get(taak.clickup_task_id!)!.assignees, [BRAM])
    await assert.rejects(opdrachtTaakVerantwoordelijke(db, OPDRACHT, taak.id, 999), (e: unknown) => e instanceof LeadTaakFout && /bestaat niet/.test(e.publiek))
    assert.deepEqual(clickup.taken.get(taak.clickup_task_id!)!.assignees, [BRAM], 'onbekend lid: niets gewijzigd')
  })

  await test('6. Iemand anders op de taak gezet in ClickUp: de app toont dat bij het volgende openen', async () => {
    clickup.taken.get(taak.clickup_task_id!)!.assignees = [MARCO]
    const { taken } = await opdrachtTaken(db, OPDRACHT)
    const t = taken.find((x) => x.id === taak.id)!
    assert.equal(t.clickup_assignee_id, MARCO)
    assert.equal(tabellen.opdracht_taken.find((r) => r.id === taak.id)!.clickup_assignee_id, MARCO, 'ook bewaard')
  })

  await test('7. Ook bij een lead: verantwoordelijke wijzigen gaat naar ClickUp', async () => {
    const { taak: lt } = await maakLeadTaak(db, LEAD, { ...invoer(), omschrijving: 'Terugbellen' }, door)
    assert.deepEqual(clickup.taken.get(lt.clickup_task_id!)!.assignees, [MARCO])
    const t = await leadTaakVerantwoordelijke(db, LEAD, lt.id, BRAM)
    assert.equal(t.clickup_assignee_naam, 'Bram')
    assert.deepEqual(clickup.taken.get(lt.clickup_task_id!)!.assignees, [BRAM])
    assert.equal((await leadTaken(db, LEAD)).taken[0].clickup_assignee_id, BRAM)
  })

  await test('8. Andere opdracht ziet deze taken niet en kan ze niet wijzigen', async () => {
    const ander = 'c0000000-0000-4000-8000-000000000002'
    assert.equal((await opdrachtTaken(db, ander)).taken.length, 0)
    await assert.rejects(opdrachtTaakVerantwoordelijke(db, ander, taak.id, BRAM), (e: unknown) => e instanceof LeadTaakFout && e.status === 404)
    await assert.rejects(opdrachtTaakOpnieuw(db, ander, taak.id), (e: unknown) => e instanceof LeadTaakFout && e.status === 404)
    await assert.rejects(maakOpdrachtTaak(db, ander, invoer(), door), (e: unknown) => e instanceof LeadTaakFout && e.status === 404)
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })

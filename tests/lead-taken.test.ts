// Pipeline — taken bij een lead: een gewone ClickUp-taak in de lijst van
// NextGen Media of NextGen Solutions, met een link naar de lead. Echte code
// (lib/sales/lead-taken*.ts, lib/clickup.ts) tegen een nagebootste ClickUp.
//
//   npx tsx tests/lead-taken.test.ts

import { tabellen, nepDb, clickup } from './hulp-meetings-nep'
import assert from 'node:assert/strict'
import { valideerLeadTaak, leadLink, leadTaakNaam, leadTaakOmschrijving, deadlineMs, statusToon } from '../lib/sales/lead-taken'
import { maakLeadTaak, leadTaakOpnieuw, leadTaken, leadTaakOpties, LeadTaakFout, type LeadTaakRij } from '../lib/sales/lead-taken-server'
import { isClickupMeeting } from '../lib/meetings/kalender'

let n = 0
const test = async (naam: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log(`  ✓ ${naam}`) }
const db = nepDb as never
process.env.NEXT_PUBLIC_SITE_URL = 'https://app.nextgenmedia.be'

const LEAD = 'b0000000-0000-4000-8000-000000000001'
tabellen.sales_leads = [{ id: LEAD, sales_companies: { name: 'Bakkerij Peeters' }, sales_contacts: { name: 'Ann Peeters' } }]
tabellen.sales_lead_taken = []
tabellen.sales_pipelines.push(
  { id: 'p-ngm', key: 'nextgenmedia', name: 'NextGenMedia', clickup_list_id: 'L-NGM' },
  { id: 'p-ngs', key: 'nextgensolutions', name: 'NextGenSolutions', clickup_list_id: 'L-NGS' },
)
const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const overDagen = (d: number) => new Date(Date.now() + d * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const door = { userId: null, email: 'bram@nextgenmedia.be' }
const invoer = (extra: Record<string, unknown> = {}) => ({ aanvraag_sleutel: crypto.randomUUID(), omschrijving: 'Offerte opmaken voor de website', deadline: overDagen(3), notitie: 'Ze willen vooral een webshop.\nBudget rond 5000 euro.', assignee_id: 106693123, merk: 'nextgensolutions', ...extra })

async function main() {
  console.log('\nPipeline — taken bij een lead\n')

  await test('1. Omschrijving, deadline (niet in het verleden), lid en lijst zijn verplicht; notitie optioneel', () => {
    assert.equal(valideerLeadTaak({}, vandaag).ok, false)
    assert.match((valideerLeadTaak({ omschrijving: 'X y', deadline: '2020-01-01', assignee_id: 1, merk: 'nextgenmedia' }, vandaag) as { fout: string }).fout, /verleden/)
    assert.match((valideerLeadTaak({ omschrijving: 'Bellen', deadline: vandaag, merk: 'nextgenmedia' }, vandaag) as { fout: string }).fout, /toegewezen/)
    assert.match((valideerLeadTaak({ omschrijving: 'Bellen', deadline: vandaag, assignee_id: 5, merk: 'ander' }, vandaag) as { fout: string }).fout, /NextGen Media of NextGen Solutions/)
    const v = valideerLeadTaak({ omschrijving: '  Bellen   terug ', deadline: vandaag, assignee_id: '5', merk: 'nextgenmedia' }, vandaag)
    assert.deepEqual(v, { ok: true, waarde: { omschrijving: 'Bellen terug', deadline: vandaag, notitie: null, assigneeId: 5, merk: 'nextgenmedia' } })
  })

  await test('2. Omschrijving in ClickUp: klikbare link naar de lead, contact, notitie en referentie', () => {
    const link = leadLink('https://app.nextgenmedia.be/', LEAD)
    assert.equal(link, `https://app.nextgenmedia.be/admin/sales/pipeline?lead=${LEAD}`)
    const o = leadTaakOmschrijving({ link, bedrijf: 'Bakkerij [Peeters]', contact: 'Ann', notitie: 'Let op *dit*', door: 'bram@nextgenmedia.be', marker: 'ngm-leadtaak:x' })
    assert.match(o.tekst, new RegExp(`^Lead in de pipeline: ${link.replace(/[?.]/g, '\\$&')}$`, 'm'))
    assert.ok(o.markdown.includes(`[Bakkerij \\[Peeters\\]](${link})`))
    assert.ok(o.markdown.includes('Let op \\*dit\\*'))
    assert.ok(o.tekst.includes('Ref: ngm-leadtaak:x'))
    assert.equal(leadTaakNaam('Offerte opmaken', 'Bakkerij Peeters'), 'Offerte opmaken (Bakkerij Peeters)')
    assert.equal(leadTaakNaam('Bakkerij Peeters terugbellen', 'Bakkerij Peeters'), 'Bakkerij Peeters terugbellen')
  })

  await test('3. Keuzes: ClickUp-leden, beide lijsten, en wie ingelogd is staat al geselecteerd', async () => {
    const o = await leadTaakOpties(db, 'Bram@NextGenMedia.be')
    assert.deepEqual(o.leden.map((l) => l.naam), ['Bram', 'Marco'])
    assert.deepEqual(o.lijsten.map((l) => [l.merk, l.ok]), [['nextgenmedia', true], ['nextgensolutions', true]])
    assert.equal(o.ik, 200511713)
  })

  let eerste: LeadTaakRij
  await test('4. Taak aanmaken: gewone taak in de NextGen Solutions-lijst, toegewezen, deadline zonder uur, link naar de lead', async () => {
    const voor = clickup.aangemaakt
    const { taak } = await maakLeadTaak(db, LEAD, invoer(), door)
    eerste = taak
    assert.equal(clickup.aangemaakt, voor + 1)
    assert.equal(taak.sync_status, 'ok')
    const cu = clickup.taken.get(taak.clickup_task_id!)!
    assert.equal(cu.list, 'L-NGS')
    assert.equal(cu.name, 'Offerte opmaken voor de website (Bakkerij Peeters)')
    assert.deepEqual(cu.assignees, [106693123])
    assert.equal(cu.due_date, deadlineMs(overDagen(3)))
    assert.equal(cu.due_date_time, false)
    assert.equal(cu.start_date, undefined, 'geen starttijd: geen agenda-item')
    assert.ok(String(cu.description).includes(`https://app.nextgenmedia.be/admin/sales/pipeline?lead=${LEAD}`))
    assert.ok(String(cu.markdown_content).includes(`(https://app.nextgenmedia.be/admin/sales/pipeline?lead=${LEAD})`))
    assert.ok(String(cu.description).includes('Budget rond 5000 euro.'))
    assert.equal(taak.clickup_url, `https://app.clickup.com/t/${taak.clickup_task_id}`)
    assert.equal(taak.clickup_status, 'open')
    assert.equal(taak.clickup_assignee_naam, 'Marco')
    assert.equal(isClickupMeeting({ id: cu.id, naam: cu.name, startMs: null, dueMs: cu.due_date, startHeeftUur: null, dueHeeftUur: false }), false)
  })

  await test('5. Dubbele klik: zelfde aanvraag geeft dezelfde taak, geen tweede in ClickUp', async () => {
    const voor = clickup.aangemaakt
    const r = await maakLeadTaak(db, LEAD, { ...invoer(), aanvraag_sleutel: eerste.aanvraag_sleutel }, door)
    assert.equal(r.herhaald, true)
    assert.equal(r.taak.id, eerste.id)
    assert.equal(clickup.aangemaakt, voor)
  })

  await test('6. Onbekend ClickUp-lid: geweigerd, niets aangemaakt', async () => {
    const voor = clickup.aangemaakt, rijen = tabellen.sales_lead_taken.length
    await assert.rejects(maakLeadTaak(db, LEAD, invoer({ assignee_id: 999 }), door), (e: unknown) => e instanceof LeadTaakFout && /bestaat niet/.test(e.publiek))
    assert.equal(clickup.aangemaakt, voor)
    assert.equal(tabellen.sales_lead_taken.length, rijen)
  })

  await test('7. Antwoord van ClickUp verloren: taak gemarkeerd, opnieuw proberen vindt dezelfde taak terug (geen dubbel)', async () => {
    clickup.verliesAntwoord = true
    const voor = clickup.aangemaakt
    const { taak } = await maakLeadTaak(db, LEAD, invoer({ merk: 'nextgenmedia', omschrijving: 'Terugbellen na de demo' }), door)
    assert.equal(taak.sync_status, 'fout')
    assert.equal(clickup.aangemaakt, voor + 1, 'de taak kwam wel aan in ClickUp')
    const x = await leadTaakOpnieuw(db, LEAD, taak.id)
    assert.equal(x.sync_status, 'ok')
    assert.equal(clickup.aangemaakt, voor + 1, 'teruggevonden, niet opnieuw aangemaakt')
    assert.equal(clickup.taken.get(x.clickup_task_id!)!.list, 'L-NGM')
  })

  await test('8. Geen lijst ingesteld voor een merk: duidelijke fout, na instellen één keer aangemaakt', async () => {
    const ngs = tabellen.sales_pipelines.find((p) => p.key === 'nextgensolutions')!
    ngs.clickup_list_id = null
    const voor = clickup.aangemaakt
    const { taak } = await maakLeadTaak(db, LEAD, invoer({ omschrijving: 'Contract nalezen' }), door)
    assert.equal(taak.sync_status, 'fout')
    assert.match(taak.sync_fout ?? '', /nog geen ClickUp-lijst/)
    assert.equal(clickup.aangemaakt, voor)
    ngs.clickup_list_id = 'L-NGS'
    const x = await leadTaakOpnieuw(db, LEAD, taak.id)
    assert.equal(x.sync_status, 'ok')
    assert.equal(clickup.aangemaakt, voor + 1)
  })

  await test('9. Leadfiche toont de status zoals ClickUp ze nu heeft (afgerond, verwijderd)', async () => {
    clickup.taken.get(eerste.clickup_task_id!)!.status = 'complete'
    let { taken, statusFout } = await leadTaken(db, LEAD)
    assert.equal(statusFout, null)
    const t = taken.find((x) => x.id === eerste.id)!
    assert.equal(t.clickup_status, 'complete')
    assert.deepEqual(statusToon(t), { label: 'complete', toon: 'ok' })
    clickup.taken.delete(eerste.clickup_task_id!)
    ;({ taken } = await leadTaken(db, LEAD))
    assert.equal(statusToon(taken.find((x) => x.id === eerste.id)!).label, 'Verwijderd in ClickUp')
    assert.equal(taken.length, 3)
  })

  await test('10. Andere lead ziet deze taken niet; opnieuw proberen op een andere lead kan niet', async () => {
    const ander = 'b0000000-0000-4000-8000-000000000002'
    assert.equal((await leadTaken(db, ander)).taken.length, 0)
    await assert.rejects(leadTaakOpnieuw(db, ander, eerste.id), (e: unknown) => e instanceof LeadTaakFout && e.status === 404)
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })

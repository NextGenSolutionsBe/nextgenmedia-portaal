// Aanvragen — diensten en consultancy vanuit het klantportaal. Echte code
// (lib/aanvragen/*, lib/clickup.ts) tegen een nagebootste databank, opslag en
// ClickUp (tests/hulp-meetings-nep.ts).
//
//   npx tsx tests/aanvragen.test.ts

import { tabellen, nepDb, clickup, resend } from './hulp-meetings-nep'
import assert from 'node:assert/strict'
import {
  DIENSTEN, CONSULTANCY, valideerAanvraag, relevanteExperts, vindType, clickupNaam, clickupOmschrijving, VORM_MET_ADRES, STATUS, type ExpertBron,
} from '../lib/aanvragen/model'
import { padVanKlant, bouwPad } from '../lib/aanvragen/bestanden'
import { NAKIJKEN, wisOngevraagdeVervaldatum } from '../lib/clickup'
import { deadlineMs } from '../lib/sales/lead-taken'
import {
  maakAanvraag, expertsVoor, aanvragenVanKlant, aanvraagVanKlant, klantBeslistOfferte, klantTrektIn, teamActie, teamDetail, AanvraagFout, CLICKUP_LIJST, type AanvraagRij,
} from '../lib/aanvragen/server'

let n = 0
const test = async (naam: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log(`  ✓ ${naam}`) }
const db = nepDb as never
process.env.NEXT_PUBLIC_SITE_URL = 'https://app.nextgenmedia.be'
NAKIJKEN.wachtMs = 0

const KLANT = 'c0000000-0000-4000-8000-0000000000a1'
const ANDER = 'c0000000-0000-4000-8000-0000000000b2'
tabellen.clients = [{ id: KLANT, company_name: 'Bakkerij Peeters' }, { id: ANDER, company_name: 'Garage Janssens' }]
const p = (id: string, voornaam: string, achternaam: string, expertises: string[], extra: Record<string, unknown> = {}) =>
  ({ id, voornaam, achternaam, actief: true, expert_zichtbaar: true, expertises, expert_rollen: [], functie: null, profielfoto_pad: null, ...extra })
const BRAM = 'e0000000-0000-4000-8000-000000000001', MARCO = 'e0000000-0000-4000-8000-000000000002', PJ = 'e0000000-0000-4000-8000-000000000003'
const SENNE = 'e0000000-0000-4000-8000-000000000004', CHIARA = 'e0000000-0000-4000-8000-000000000005', STUDENT = 'e0000000-0000-4000-8000-000000000006'
tabellen.personeel = [
  p(BRAM, 'Bram', 'Reinquin', ['marketing', 'foto_video', 'sales', 'branding', 'seo', 'meta_ads'], { profielfoto_pad: 'fotos/bram.jpg', expert_rollen: ['Zaakvoerder'], clickup_user_id: 200511713 }),
  p(MARCO, 'Marco', 'Castermans', ['ai', 'websites', 'seo', 'google_ads'], { email: 'marco@nextgenmedia.be' }),
  p(PJ, 'Pieter-Jan', 'Vanstraelen', ['campagnes', 'performance']),
  p(SENNE, 'Senne', 'Wellens', ['grafisch']),
  p(CHIARA, 'Chiara', 'Walmagh', ['social', 'branding'], { clickup_user_id: 200511716 }),
  p(STUDENT, 'Alida', 'Daans', ['foto_video'], { expert_zichtbaar: false }),
]
tabellen.klant_aanvragen = []
tabellen.klant_aanvraag_bestanden = []
const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const overDagen = (d: number) => new Date(Date.now() + d * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const door = { userId: 'u1', email: 'ann@peeters.be', naam: 'Ann Peeters' }
const shoot = (extra: Record<string, unknown> = {}) => ({
  aanvraag_sleutel: crypto.randomUUID(), soort: 'dienst', type: 'content_shoot', wat: 'Het team aan het werk en de nieuwe taarten.',
  briefing: 'Warme, natuurlijke stijl.', antwoorden: { soort: ['Reels', 'Foto’s'] }, periode_van: overDagen(7), periode_tot: overDagen(21),
  voorkeursdagen: ['di', 'do', 'xx'], tijdstippen: ['voormiddag'], locatie: 'Kerkstraat 12, 3500 Hasselt', deadline: overDagen(30), expert_id: CHIARA, ...extra,
})

async function main() {
  console.log('\nAanvragen — diensten en consultancy\n')

  await test('1. Catalogus: de 12 diensten en 14 consultancyopties zoals afgesproken', () => {
    assert.deepEqual(DIENSTEN.map((d) => d.label), ['Social media management', 'Foto- en videografie', 'Content shoot', 'Grafisch ontwerp', 'Branding en rebranding', 'Websiteontwerp en -ontwikkeling', 'SEO', 'SEA en advertentiebeheer', 'E-mailmarketing', 'AI-automatisaties', 'Strategie en marketingadvies', 'Overige'])
    assert.deepEqual(CONSULTANCY.map((d) => d.label), ['Strategische marketingconsultancy', 'AI-workshop', 'AI- en automatisatiescan', 'Performance marketing scan', 'Meta Ads- of Google Ads-scan', 'Workflow- en efficiëntiescan', 'Sales operations scan', 'Leadgeneratie- en salesfunnelanalyse', 'CRM- en opvolgingsprocesadvies', 'Website- en conversiescan', 'SEO-scan', 'Social media- en contentstrategie', 'Klantreis- en positioneringsadvies', 'Overige consultancy'])
  })

  await test('2. Validatie: wat-vraag, verplichte velden per dienst, opties en webadres', () => {
    assert.equal(valideerAanvraag({ soort: 'dienst', type: 'seo', wat: 'Beter gevonden worden', periode_van: vandaag }, vandaag).ok, false, 'SEO vraagt de website')
    const seo = { soort: 'dienst', type: 'seo', wat: 'Beter gevonden worden', antwoorden: { website: 'peeters.be', doelen: ['Meer leads', 'Iets anders'], regio: 'Limburg' } }
    assert.match((valideerAanvraag(seo, vandaag) as { fout: string }).fout, /gewenste datum/, 'zonder datum geen aanvraag')
    assert.match((valideerAanvraag({ ...seo, periode_van: overDagen(-1) }, vandaag) as { fout: string }).fout, /verleden/)
    const ok = valideerAanvraag({ ...seo, periode_van: vandaag }, vandaag)
    assert.ok(ok.ok)
    if (ok.ok) { assert.equal(ok.waarde.antwoorden.website, 'https://peeters.be'); assert.deepEqual(ok.waarde.antwoorden.doelen, ['Meer leads']); assert.equal(ok.waarde.locatie, null) }
    assert.equal(valideerAanvraag({ soort: 'dienst', type: 'grafisch', wat: 'Een flyer graag', antwoorden: { huisstijl: 'Misschien' } }, vandaag).ok, false)
    assert.equal(valideerAanvraag({ soort: 'dienst', type: 'onbekend', wat: 'x x x x x' }, vandaag).ok, false)
    assert.equal(valideerAanvraag({ soort: 'dienst', type: 'grafisch', wat: 'kort' }, vandaag).ok, false)
  })

  await test('3. Timing en locatie: geen verleden, logische periode; locatie verplicht bij een shoot, adres bij consultancy op kantoor', () => {
    assert.match((valideerAanvraag({ ...shoot(), deadline: '2020-01-01' }, vandaag) as { fout: string }).fout, /verleden/)
    assert.match((valideerAanvraag({ ...shoot(), periode_van: overDagen(10), periode_tot: overDagen(5) }, vandaag) as { fout: string }).fout, /vóór het begin/)
    assert.match((valideerAanvraag({ ...shoot(), locatie: '' }, vandaag) as { fout: string }).fout, /locatie/)
    const v = valideerAanvraag(shoot(), vandaag)
    assert.ok(v.ok && v.waarde.locatie === 'Kerkstraat 12, 3500 Hasselt' && v.waarde.voorkeursdagen.join() === 'di,do')
    const basis = { soort: 'consultancy', type: 'seo_scan', wat: 'We staan nergens in Google.', periode_van: overDagen(3), antwoorden: { onderwerp: 'Vindbaarheid', website: 'https://peeters.be' } }
    assert.match((valideerAanvraag(basis, vandaag) as { fout: string }).fout, /Waar/)
    assert.equal(valideerAanvraag({ ...basis, antwoorden: { ...basis.antwoorden, vorm: 'Online' }, locatie: 'genegeerd' }, vandaag).ok, true)
    assert.match((valideerAanvraag({ ...basis, antwoorden: { ...basis.antwoorden, vorm: VORM_MET_ADRES } }, vandaag) as { fout: string }).fout, /adres/)
    assert.match((valideerAanvraag({ soort: 'consultancy', type: 'ai_scan', wat: 'Veel handwerk', periode_van: overDagen(3), antwoorden: { vorm: 'Online' } }, vandaag) as { fout: string }).fout, /Onderwerp/)
  })

  await test('4. Relevante experts: enkel zichtbare en actieve teamleden met een passende expertise', () => {
    const lijst = tabellen.personeel as unknown as ExpertBron[]
    const namen = (soort: 'dienst' | 'consultancy', key: string) => relevanteExperts(lijst, vindType(soort, key)!).map((e) => e.voornaam)
    assert.deepEqual(namen('dienst', 'content_shoot'), ['Bram', 'Chiara'], 'student Alida staat niet als expert aan')
    assert.deepEqual(namen('dienst', 'grafisch'), ['Senne'])
    assert.deepEqual(namen('dienst', 'sea').sort(), ['Bram', 'Marco', 'Pieter-Jan'])
    assert.deepEqual(namen('consultancy', 'ai_workshop'), ['Marco'])
    assert.deepEqual(namen('consultancy', 'seo_scan').sort(), ['Bram', 'Marco'])
    assert.equal(namen('dienst', 'overige').length, 5, 'Overige: iedereen die als expert aan staat')
    const r = relevanteExperts(lijst, vindType('dienst', 'branding')!)
    assert.deepEqual(r.find((e) => e.voornaam === 'Bram')!.relevant, ['branding'], 'enkel de expertises die passen')
  })

  await test('5. Kies jouw expert: naam, foto, rollen en passende expertises; uitgezet of inactief verdwijnt meteen', async () => {
    // Instelling "enkel specialisten" (Instellingen → Team in de klantapp).
    tabellen.app_settings = [{ key: 'team_klantapp', value: { diensten_iedereen: false } }]
    let e = await expertsVoor(db, 'dienst', 'content_shoot')
    assert.deepEqual(e.map((x) => x.naam), ['Bram Reinquin', 'Chiara Walmagh'])
    assert.equal(e[0].foto_url, 'https://opslag.test/personeel/fotos/bram.jpg')
    assert.deepEqual(e[0].rollen, ['Zaakvoerder'])
    assert.deepEqual(e[0].expertises, ['Foto- en videografie'])
    tabellen.personeel.find((x) => x.id === CHIARA)!.expert_zichtbaar = false
    e = await expertsVoor(db, 'dienst', 'content_shoot')
    assert.deepEqual(e.map((x) => x.naam), ['Bram Reinquin'])
    tabellen.personeel.find((x) => x.id === CHIARA)!.expert_zichtbaar = true
  })

  await test('5b. Standaard bij diensten: iedereen die zichtbaar staat, specialisten eerst; consultancy blijft op expertise', async () => {
    tabellen.app_settings = []
    const e = await expertsVoor(db, 'dienst', 'content_shoot')
    assert.equal(e.length, 5, 'Bram, Chiara, Marco, Pieter-Jan en Senne')
    assert.deepEqual(e.slice(0, 2).map((x) => x.naam), ['Bram Reinquin', 'Chiara Walmagh'], 'specialisten bovenaan')
    assert.ok(e[0].specialist && e[1].specialist && !e[4].specialist)
    assert.deepEqual((await expertsVoor(db, 'consultancy', 'ai_workshop')).map((x) => x.naam), ['Marco Castermans'])
  })

  await test('6. ClickUp-taaknaam en omschrijving: altijd herkenbaar als aanvraag, nooit als opdracht', () => {
    assert.equal(clickupNaam('dienst', 'Bakkerij Peeters', 'Content shoot'), 'Dienstenaanvraag – Bakkerij Peeters – Content shoot')
    assert.equal(clickupNaam('consultancy', 'Bakkerij Peeters', 'SEO-scan'), 'Consultancy aanvraag – Bakkerij Peeters – SEO-scan')
    const o = clickupOmschrijving({
      id: 'x', soort: 'consultancy', type: 'seo_scan', type_label: 'SEO-scan', klant: 'Bakkerij Peeters', wat: 'We staan nergens.', briefing: null, aandachtspunten: null,
      antwoorden: { onderwerp: 'Vindbaarheid', vorm: 'Online' }, periode_van: null, periode_tot: null, voorkeursdagen: ['ma'], tijdstippen: [], locatie: null, deadline: null,
      expert_naam: null, ingediend_door: 'Ann', bestanden: [],
    }, 'https://app.nextgenmedia.be/admin/aanvragen?aanvraag=x')
    assert.match(o, /^AANVRAAG – nog geen bevestigde opdracht of boeking/)
    assert.match(o, /Consultancy: duur en eventuele offerte bepalen wij\./)
    assert.doesNotMatch(o, /€|per uur|tarief/i, 'geen uurtarief in de ClickUp-taak')
    assert.match(o, /Expertvoorkeur: Geen voorkeur – stel zelf een expert voor \(voorkeur, nog niet bevestigd\)/)
    assert.match(o, /Onderwerp: Vindbaarheid/)
    assert.match(o, /Voorkeursdagen: Ma/)
    assert.match(o, /Aanvraag in de app: https:\/\/app\.nextgenmedia\.be\/admin\/aanvragen\?aanvraag=x/)
  })

  let eerste: AanvraagRij
  await test('7. Indienen: ClickUp-taak in "Aanvragen" op de gewenste datum, toegewezen aan de gekozen expert, en een mail naar info@', async () => {
    const pad = bouwPad(KLANT, 'application/pdf', crypto.randomUUID())
    const voor = clickup.aangemaakt
    const { aanvraag } = await maakAanvraag(db, KLANT, { ...shoot(), bestanden: [{ pad, bestandsnaam: 'moodboard.pdf', mimetype: 'application/pdf', grootte: 12000 }] }, door)
    eerste = aanvraag
    assert.equal(aanvraag.status, 'ontvangen')
    assert.equal(aanvraag.expert_naam, 'Chiara Walmagh')
    assert.equal(aanvraag.clickup_status, 'ok')
    assert.equal(clickup.aangemaakt, voor + 1)
    const lijst = clickup.lijsten.find((l) => l.name === CLICKUP_LIJST)
    assert.ok(lijst, 'de lijst "Aanvragen" werd aangemaakt')
    const taak = clickup.taken.get(aanvraag.clickup_task_id!)!
    assert.equal(taak.list, lijst!.id)
    assert.equal(taak.name, 'Dienstenaanvraag – Bakkerij Peeters – Content shoot')
    assert.equal(taak.due_date, deadlineMs(overDagen(7)), 'op de gewenste datum van de klant')
    assert.equal(taak.due_date_time, false, 'enkel een dag, geen uur')
    assert.deepEqual(taak.assignees, [200511716], 'toegewezen aan de gekozen expert (Chiara)')
    assert.equal(aanvraag.team_mail_status, 'ok')
    const mail = resend.verstuurd.at(-1)!
    assert.deepEqual([mail.to].flat(), ['info@nextgenmedia.be'])
    assert.equal(mail.subject, 'Nieuwe dienstenaanvraag – Bakkerij Peeters – Content shoot')
    assert.match(String(mail.text), /Gewenste periode: .+ tot /)
    assert.match(String(mail.text), /ClickUp-taak: https:\/\/app\.clickup\.com\/t\//)
    assert.match(String(mail.html), /admin\/aanvragen\?aanvraag=/)
    assert.match(String(taak.description), /AANVRAAG – nog geen bevestigde opdracht/)
    assert.match(String(taak.description), /Locatie: Kerkstraat 12, 3500 Hasselt/)
    assert.match(String(taak.description), /moodboard\.pdf/)
    assert.equal(tabellen.klant_aanvraag_bestanden.filter((b) => b.aanvraag_id === aanvraag.id).length, 1)
  })

  await test('8. Dubbele klik: zelfde aanvraag, geen tweede taak; tweede aanvraag hergebruikt de lijst', async () => {
    const voor = clickup.aangemaakt, lijsten = clickup.lijsten.length, mails = resend.verstuurd.length
    const r = await maakAanvraag(db, KLANT, { ...shoot(), aanvraag_sleutel: eerste.aanvraag_sleutel }, door)
    assert.equal(r.herhaald, true)
    assert.equal(clickup.aangemaakt, voor)
    assert.equal(resend.verstuurd.length, mails, 'geen tweede mail')
    const c = await maakAanvraag(db, KLANT, { aanvraag_sleutel: crypto.randomUUID(), soort: 'consultancy', type: 'seo_scan', wat: 'We staan nergens in Google.', periode_van: vandaag, antwoorden: { onderwerp: 'Vindbaarheid', website: 'https://peeters.be', vorm: 'Online' }, expert_id: MARCO }, door)
    assert.deepEqual(clickup.taken.get(c.aanvraag.clickup_task_id!)!.assignees, [106693123], 'Marco teruggevonden op e-mailadres')
    assert.equal(clickup.taken.get(c.aanvraag.clickup_task_id!)!.due_date, deadlineMs(vandaag), 'vandaag gekozen = taak vandaag')
    assert.equal(resend.verstuurd.at(-1)!.subject, 'Nieuwe consultancy aanvraag – Bakkerij Peeters – SEO-scan')
    assert.equal(clickup.lijsten.length, lijsten)
    assert.ok([...clickup.taken.values()].some((t) => t.name === 'Consultancy aanvraag – Bakkerij Peeters – SEO-scan'))
  })

  await test('9. Geweigerd: bestand van een andere klant, of een expert die niet past of uitstaat', async () => {
    const vreemd = bouwPad(ANDER, 'image/png', crypto.randomUUID())
    assert.equal(padVanKlant(vreemd, KLANT), false)
    await assert.rejects(maakAanvraag(db, KLANT, { ...shoot(), bestanden: [{ pad: vreemd, bestandsnaam: 'x.png', mimetype: 'image/png', grootte: 1 }] }, door), (e: unknown) => e instanceof AanvraagFout && /hoort niet/.test(e.publiek))
    // Met "enkel specialisten" past Senne (grafisch) niet bij een shoot; standaard staat iedereen open.
    tabellen.app_settings = [{ key: 'team_klantapp', value: { diensten_iedereen: false } }]
    await assert.rejects(maakAanvraag(db, KLANT, shoot({ expert_id: SENNE }), door), (e: unknown) => e instanceof AanvraagFout && /niet \(meer\) beschikbaar/.test(e.publiek))
    tabellen.app_settings = []
    // Wie niet als expert zichtbaar staat, is nooit te kiezen.
    await assert.rejects(maakAanvraag(db, KLANT, shoot({ expert_id: STUDENT }), door), (e: unknown) => e instanceof AanvraagFout)
  })

  await test('10. Mijn aanvragen: enkel de eigen klant, zonder interne velden', async () => {
    await teamActie(db, eerste, { actie: 'notitie', tekst: 'Intern: Arthur vragen' }, 'Bram')
    const lijst = await aanvragenVanKlant(db, KLANT, 'dienst')
    assert.equal(lijst.length, 1)
    assert.equal(lijst[0].status_label, 'Aanvraag ontvangen')
    const tekst = JSON.stringify(lijst)
    assert.equal(/interne_notitie|Arthur|clickup|scope/.test(tekst), false)
    assert.equal((await aanvragenVanKlant(db, ANDER, 'dienst')).length, 0)
    assert.equal(await aanvraagVanKlant(db, ANDER, eerste.id), null)
  })

  await test('11. Team: scope binnen contract, aanvaarden, intern inplannen; ClickUp krijgt een reactie bij elke stap', async () => {
    let a = await teamActie(db, eerste, { actie: 'status', status: 'in_behandeling' }, 'Bram')
    a = await teamActie(db, a, { actie: 'scope', scope: 'binnen', notitie: '1 ad-hoc shoot per maand in het contract' }, 'Bram')
    await assert.rejects(teamActie(db, a, { actie: 'planning', datum: overDagen(10) }, 'Bram'), (e: unknown) => e instanceof AanvraagFout && /pas in nadat ze aanvaard/.test(e.publiek))
    a = await teamActie(db, a, { actie: 'status', status: 'aanvaard' }, 'Bram')
    a = await teamActie(db, a, { actie: 'toewijzen', personeel_id: BRAM }, 'Bram')
    assert.deepEqual(clickup.taken.get(a.clickup_task_id!)!.assignees, [200511713], 'ClickUp volgt de toewijzing')
    a = await teamActie(db, a, { actie: 'toewijzen', personeel_id: null }, 'Bram')
    assert.deepEqual(clickup.taken.get(a.clickup_task_id!)!.assignees, [200511716], 'zonder toewijzing terug op de gekozen expert')
    a = await teamActie(db, a, { actie: 'toewijzen', personeel_id: CHIARA }, 'Bram')
    a = await teamActie(db, a, { actie: 'planning', datum: overDagen(10), notitie: 'Shoot met Arthur' }, 'Bram')
    assert.equal(a.status, 'ingepland')
    assert.equal(a.scope, 'binnen')
    assert.equal(a.toegewezen_naam, 'Chiara Walmagh')
    const reacties = clickup.reacties.filter((r) => r.taak === a.clickup_task_id).map((r) => r.tekst)
    assert.ok(reacties.some((r) => /Scope: binnen het bestaande contract/.test(r)))
    assert.ok(reacties.some((r) => /Intern ingepland op/.test(r)))
    const d = await teamDetail(db, a.id)
    assert.equal(d!.bestanden[0].url?.startsWith('https://opslag.test/aanvragen/'), true)
    assert.equal(d!.aanvraag.klant, 'Bakkerij Peeters')
  })

  await test('12. Buiten scope met offerte: klant opent en aanvaardt; daarna inplannen', async () => {
    const { aanvraag } = await maakAanvraag(db, KLANT, shoot({ type: 'website', wat: 'Een nieuwe website met webshop', antwoorden: { soort: 'Webshop' }, locatie: null, expert_id: MARCO }), door)
    await assert.rejects(teamActie(db, aanvraag, { actie: 'offerte', url: 'http://onveilig.be' }, 'Marco'), (e: unknown) => e instanceof AanvraagFout && /https/.test(e.publiek))
    let a = await teamActie(db, aanvraag, { actie: 'offerte', titel: 'Offerte webshop', pad: `offertes/${aanvraag.id}/${crypto.randomUUID()}.pdf`, bestandsnaam: 'offerte.pdf', notitie: 'Inclusief 3 maanden support' }, 'Marco')
    assert.equal(a.status, 'offerte')
    assert.equal(a.scope, 'buiten')
    assert.equal(a.offerte_status, 'open')
    const zicht = (await aanvragenVanKlant(db, KLANT, 'dienst')).find((x) => x.id === a.id)!
    assert.equal(zicht.status_label, 'Offerte klaar voor jou')
    assert.equal(zicht.offerte?.heeft_bestand, true)
    a = await klantBeslistOfferte(db, a, 'aanvaard', null, 'Ann Peeters')
    assert.equal(a.status, 'aanvaard')
    assert.equal(a.offerte_beslist_door, 'Ann Peeters')
    await assert.rejects(klantBeslistOfferte(db, a, 'geweigerd', null, 'Ann'), (e: unknown) => e instanceof AanvraagFout && e.status === 409)
    a = await teamActie(db, a, { actie: 'planning', datum: overDagen(20) }, 'Marco')
    assert.equal(a.status, 'ingepland')
  })

  await test('13. Offerte geweigerd: terug bij ons; afwijzen sluit de ClickUp-taak met een reden voor de klant', async () => {
    const { aanvraag } = await maakAanvraag(db, KLANT, shoot({ type: 'grafisch', wat: 'Een flyer voor de opendeurdag', antwoorden: {}, locatie: null, expert_id: null }), door)
    assert.equal(clickup.taken.get(aanvraag.clickup_task_id!)!.assignees, undefined, 'geen voorkeur = nog niemand toegewezen')
    let a = await teamActie(db, aanvraag, { actie: 'offerte', url: 'https://docs.example/offerte' }, 'Bram')
    a = await klantBeslistOfferte(db, a, 'geweigerd', 'Te duur', 'Ann')
    assert.equal(a.status, 'in_behandeling')
    assert.equal(a.offerte_reden, 'Te duur')
    a = await teamActie(db, a, { actie: 'status', status: 'afgewezen', reden_klant: 'We kunnen dit niet goedkoper.' }, 'Bram')
    assert.equal(clickup.taken.get(a.clickup_task_id!)!.status, 'complete', 'taak gesloten')
    const zicht = (await aanvragenVanKlant(db, KLANT, 'dienst')).find((x) => x.id === a.id)!
    assert.equal(zicht.status_label, STATUS.afgewezen.klant)
    assert.equal(zicht.reden_klant, 'We kunnen dit niet goedkoper.')
  })

  await test('14. Intrekken door de klant: enkel zolang wij nog niets beslisten', async () => {
    const { aanvraag } = await maakAanvraag(db, KLANT, shoot({ type: 'social_media', wat: 'Maandelijks 8 posts', antwoorden: {}, locatie: null, expert_id: null }), door)
    const a = await klantTrektIn(db, aanvraag, 'Ann')
    assert.equal(a.status, 'ingetrokken')
    assert.equal(clickup.taken.get(a.clickup_task_id!)!.status, 'complete')
    await assert.rejects(klantTrektIn(db, eerste, 'Ann'), (e: unknown) => e instanceof AanvraagFout && e.status === 409)
    await assert.rejects(teamActie(db, a, { actie: 'status', status: 'aanvaard' }, 'Bram'), (e: unknown) => e instanceof AanvraagFout)
  })

  await test('15. ClickUp onderweg kwijt: aanvraag blijft, "opnieuw" vindt de taak terug zonder dubbel', async () => {
    clickup.verliesAntwoord = true
    const voor = clickup.aangemaakt
    const { aanvraag } = await maakAanvraag(db, KLANT, shoot({ type: 'email', wat: 'Een maandelijkse nieuwsbrief', antwoorden: {}, locatie: null, expert_id: null }), door)
    assert.equal(aanvraag.clickup_status, 'fout')
    assert.equal(clickup.aangemaakt, voor + 1)
    const x = await teamActie(db, aanvraag, { actie: 'clickup_opnieuw' }, 'Bram')
    assert.equal(x.clickup_status, 'ok')
    assert.equal(clickup.aangemaakt, voor + 1)
  })

  await test('16. ClickUp-automatisering met een vaste datum: de gewenste datum blijft; zonder datum wist de app ze', async () => {
    clickup.automatischeVervaldatum = '1753236000000'
    const { aanvraag } = await maakAanvraag(db, KLANT, shoot({ type: 'branding', wat: 'Een nieuw logo en huisstijl', antwoorden: {}, locatie: null, expert_id: null }), door)
    clickup.automatischeVervaldatum = null
    assert.equal(clickup.taken.get(aanvraag.clickup_task_id!)!.due_date, deadlineMs(overDagen(7)))
    clickup.taken.set('cu-oud', { id: 'cu-oud', list: 'L-1', name: 'oud', status: 'open', due_date: '1753236000000' })
    assert.equal(await wisOngevraagdeVervaldatum('cu-oud'), true)
    assert.equal(clickup.taken.get('cu-oud')!.due_date, null)
  })

  await test('17. Mail naar info@ lukt niet: de aanvraag staat er wel, met de fout erbij voor het team', async () => {
    resend.weiger = 'The nextgenmedia.be domain is not verified'
    const { aanvraag } = await maakAanvraag(db, KLANT, shoot({ type: 'ai', wat: 'Offertes automatisch opmaken', antwoorden: {}, locatie: null, expert_id: null }), door)
    assert.equal(aanvraag.status, 'ontvangen')
    assert.equal(aanvraag.clickup_status, 'ok')
    assert.equal(aanvraag.team_mail_status, 'fout')
    assert.match(String(aanvraag.team_mail_fout), /not verified/)
  })

  await test('18. In de API rondt ClickUp af na het antwoord; een ClickUp-fout laat een actie niet mislukken', async () => {
    const { aanvraag } = await maakAanvraag(db, KLANT, shoot({ type: 'branding', wat: 'Een nieuwe huisstijl', antwoorden: {}, locatie: null, expert_id: null }), door)
    const achtergrond: Promise<unknown>[] = []
    const voor = clickup.reacties.length
    let x = await teamActie(db, aanvraag, { actie: 'status', status: 'in_behandeling' }, 'Bram', { achtergrond: (p) => { achtergrond.push(p) } })
    assert.equal(x.status, 'in_behandeling')
    assert.equal(achtergrond.length, 1, 'ClickUp loopt op de achtergrond')
    await Promise.all(achtergrond)
    assert.equal(clickup.reacties.length, voor + 1)
    // ClickUp onbereikbaar: de status staat er toch.
    const echteFetch = globalThis.fetch
    globalThis.fetch = (async (u: RequestInfo | URL, i?: RequestInit) => { if (String(u).includes('/comment')) throw new TypeError('fetch failed'); return echteFetch(u, i) }) as typeof fetch
    try { x = await teamActie(db, x, { actie: 'status', status: 'aanvaard' }, 'Bram') } finally { globalThis.fetch = echteFetch }
    assert.equal(x.status, 'aanvaard')
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })

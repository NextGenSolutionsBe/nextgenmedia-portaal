import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import type { Actie } from '@/lib/instellingen/model'
import { controleerItem, isUuid, isKleur, vandaag, enkelBedrijfPerKlant, type Item } from '@/lib/agenda/model'
import { inspreekPrompt, leesInspreekVoorstel, type InspreekContext } from '@/lib/agenda/inspreken'
import { mijnDeadlines } from '@/lib/agenda/deadlines-server'
import { reeksenInBereik, laadBeschikbaarheid } from '@/lib/agenda/team-server'
import type { Bezet } from '@/lib/agenda/team'
import { MAX_VERPLAATS } from '@/lib/agenda/dag-afsluiten'
import { schoonDocJson, vulDocAan, BEELD_PAD, BEELD_TYPES, MAX_BEELD, type DocNode } from '@/lib/agenda/doc-opmaak'
import {
  kijkerVan, laadZicht, boomVoor, metToegewezen, meetingsInBereik, shootsInBereik, metMeetingStatus, itemsInBereik, itemZichtbaar, docZichtbaar, laadPersonen, laadLabels, alleRijen,
  ITEM_VELDEN, type Kijker, type Zicht, type RuwItem,
} from '@/lib/agenda/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Agenda (zie lib/agenda/server.ts voor wie wat ziet).
 * GET  ?boom=1                    boom, personen, labels, klanten, instellingen
 *      ?van=&tot=                 items en meetings in een periode
 *      ?container=lijst|map|space&id=  alle items van een lijst, map of space
 *      ?container=alles                open taken uit alles wat je ziet (All tasks)
 *      ?item=<id>                 één item met beschrijving en subtaken
 *      ?klaar=1[&persoon=][&na=]  afgevinkte items, laatst afgevinkt eerst
 *      ?doc=<id> | ?prullenbak=1 | ?mail=1 | ?zoek=<tekst>
 * POST { actie, ... }             zie onderaan
 */

type Admin = ReturnType<typeof createAdminSupabaseClient>
type Ctx = { admin: Admin; k: Kijker; persoon: NonNullable<Awaited<ReturnType<typeof magIk>>> }

async function toegang(actie: Actie): Promise<Ctx | NextResponse> {
  const persoon = await magIk('agenda', actie)
  if (!persoon) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const admin = createAdminSupabaseClient()
  const k = await kijkerVan(admin, persoon)
  if (!k) return NextResponse.json({ error: 'Je account is nog niet gekend in de agenda.' }, { status: 403 })
  return { admin, k, persoon }
}
const fout = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })
const nu = () => new Date().toISOString()
const isIso = (v: string | null): v is string => !!v && Number.isFinite(Date.parse(v))

async function magMeetings(): Promise<boolean> {
  return !!(await magIk('meetings', 'bekijken')) || !!(await magIk('sales', 'bekijken'))
}

/** Personen op e-mail en op account (voor wie op een shoot staat of ze maakte). */
async function personenKaart(admin: Admin): Promise<{ email: Map<string, string>; gebruiker: Map<string, string> }> {
  const { data } = await admin.from('ag_personen').select('id, email, user_id')
  const r = (data ?? []) as { id: string; email: string | null; user_id: string | null }[]
  return { email: new Map(r.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p.id])), gebruiker: new Map(r.filter((p) => p.user_id).map((p) => [p.user_id!, p.id])) }
}

async function emailNaarPersoon(admin: Admin): Promise<Map<string, string>> {
  const { data } = await admin.from('ag_personen').select('id, email').not('email', 'is', null)
  return new Map(((data ?? []) as { id: string; email: string }[]).map((p) => [p.email.toLowerCase(), p.id]))
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const c = await toegang('bekijken')
  if (c instanceof NextResponse) return c
  const { admin, k } = c
  const q = req.nextUrl.searchParams
  try {
    if (q.get('boom')) return NextResponse.json(await boom(c))
    if (q.get('van') || q.get('tot')) return NextResponse.json(await bereik(admin, k, q.get('van'), q.get('tot'), q.get('team') === '1'))
    if (q.get('container')) return NextResponse.json(await container(admin, k, q.get('container')!, q.get('id')))
    if (q.get('item')) return NextResponse.json(await eenItem(admin, k, q.get('item')!))
    if (q.get('klaar')) return NextResponse.json(await afgevinkt(admin, k, q.get('persoon'), q.get('na'), q.get('q')))
    if (q.get('doc')) return NextResponse.json(await eenDoc(admin, k, q.get('doc')!))
    if (q.get('bijlage')) return await bijlageOpenen(admin, k, q.get('bijlage')!)
    if (q.get('docbeeld')) return await docBeeldOpenen(admin, k, q.get('docbeeld')!)
    if (q.get('prullenbak')) return NextResponse.json(await prullenbak(admin, k))
    if (q.get('mail')) return NextResponse.json(await mailVoorstellen(admin, k))
    if (q.get('zoek') !== null) return NextResponse.json(await zoek(admin, k, q.get('zoek') ?? ''))
    if (q.get('deadlines')) return NextResponse.json({ deadlines: await mijnDeadlines(admin, k.userId) })
    return fout('Onbekende vraag')
  } catch (e) {
    return fout(e instanceof Error ? e.message : 'Er ging iets mis', 500)
  }
}

async function boom(c: Ctx) {
  const { admin, k } = c
  const z = await laadZicht(admin, k)
  // Bij welk bedrijf een klant klant is (kleur en filter op bedrijf, verbeterplan E39): tegelijk met de rest.
  const bedrijfRijen = Promise.all((['opdrachten', 'contracts', 'offertes'] as const).map((t) =>
    admin.from(t).select('client_id, bedrijf').not('client_id', 'is', null).in('bedrijf', ['nextgenmedia', 'nextgensolutions']).limit(5000)))
  const [b, personen, labels, klanten, kleuren, delen, bronnen, mail, rechten, rollen, bd] = await Promise.all([
    boomVoor(admin, z),
    laadPersonen(admin),
    laadLabels(admin),
    admin.from('clients').select('id, company_name, archived_at').order('company_name').limit(3000),
    admin.from('ag_klant_kleuren').select('client_id, kleur'),
    admin.from('ag_delen').select('eigenaar_id, kijker_id').or(`eigenaar_id.eq.${k.persoonId},kijker_id.eq.${k.persoonId}`),
    admin.from('ag_clickup_bronnen').select('id, sleutel, persoon_id, clickup_naam, actief, fase, volledig_op, laatste_sync_op, bezig_sinds, tellers, fout'),
    k.isAdmin ? admin.from('ag_mail_voorstellen').select('id', { count: 'exact', head: true }).eq('status', 'voorstel') : Promise.resolve({ count: 0 }),
    Promise.all((['toevoegen', 'aanpassen', 'verwijderen', 'instellingen'] as Actie[]).map(async (a) => [a, !!(await magIk('agenda', a))] as const)),
    admin.from('user_roles').select('user_id').eq('role', 'admin'),
    bedrijfRijen,
  ])
  const klantBedrijf = enkelBedrijfPerKlant(bd.flatMap((r) => (r.data ?? []) as { client_id: string | null; bedrijf: string | null }[]))
  const admins = new Set(((rollen.data ?? []) as { user_id: string }[]).map((r) => r.user_id))
  return {
    ik: k.persoonId, isAdmin: k.isAdmin, ...b, personen, labels,
    zaakvoerders: personen.filter((p) => p.user_id && admins.has(p.user_id)).map((p) => p.id),
    klanten: ((klanten.data ?? []) as { id: string; company_name: string | null; archived_at: string | null }[]).map((x) => ({ id: x.id, naam: x.company_name ?? 'Klant', gearchiveerd: !!x.archived_at })),
    klantKleuren: Object.fromEntries(((kleuren.data ?? []) as { client_id: string; kleur: string }[]).map((x) => [x.client_id, x.kleur])),
    klantBedrijf,
    deelIkMet: ((delen.data ?? []) as { eigenaar_id: string; kijker_id: string }[]).filter((d) => d.eigenaar_id === k.persoonId).map((d) => d.kijker_id),
    zieIkVan: ((delen.data ?? []) as { eigenaar_id: string; kijker_id: string }[]).filter((d) => d.kijker_id === k.persoonId).map((d) => d.eigenaar_id),
    // Nooit een token naar het scherm: enkel wie, welke fase en hoe ver.
    clickup: ((bronnen.data ?? []) as { id: string; sleutel: string; persoon_id: string | null; clickup_naam: string | null; actief: boolean; fase: string; volledig_op: string | null; laatste_sync_op: string | null; bezig_sinds: string | null; tellers: Record<string, number>; fout: string | null }[])
      .map((x) => ({ ...x, eigen: x.persoon_id === k.persoonId, gedeeld: x.sleutel === 'gedeeld' })),
    mailVoorstellen: mail.count ?? 0,
    meetings: await magMeetings(),
    shoots: !!(await magIk('shoots', 'toevoegen')),
    rechten: Object.fromEntries(rechten),
  }
}

async function bereik(admin: Admin, k: Kijker, van: string | null, tot: string | null, team = false) {
  if (!isIso(van) || !isIso(tot) || Date.parse(tot) <= Date.parse(van) || Date.parse(tot) - Date.parse(van) > 70 * 86_400_000) throw new Error('Ongeldige periode')
  const [z, ruw, mt, shoots, beschikbaarheid] = await Promise.all([
    laadZicht(admin, k),
    itemsInBereik(admin, van, tot),
    magMeetings().then(async (ja) => (ja ? meetingsInBereik(admin, van, tot, await emailNaarPersoon(admin)) : { items: [] as Item[], clickupIds: new Set<string>(), perClickup: new Map<string, string>() })),
    // Shoots uit de Shoot planner (enkel met recht op de Shoot planner).
    magIk('shoots', 'bekijken').then(async (ja) => { if (!ja) return [] as Item[]; const p = await personenKaart(admin); return shootsInBereik(admin, van, tot, p.email, p.gebruiker) }).catch(() => [] as Item[]),
    team ? laadBeschikbaarheid(admin) : Promise.resolve(null),
  ])
  // Een meeting uit de Meeting Inplanner staat ook in ClickUp: één keer tonen, die van de Meeting Inplanner
  // (af als het dubbel in ClickUp af is).
  // Teamweergave: wat je niet mag zien maar tijd inneemt, als "Bezet" (zonder titel).
  const bezet: Bezet[] | undefined = team ? [] : undefined
  const [items, reeksen] = await Promise.all([
    metToegewezen(admin, ruw.filter((r) => !r.clickup_id || !mt.clickupIds.has(r.clickup_id)), z, { subtaken: true, bezet }),
    // Vaste blokken en herhalende afspraken of taken (enkel de keren in deze periode).
    reeksenInBereik(admin, z, van, tot, bezet).catch(() => [] as Item[]),
  ])
  const meetings = metMeetingStatus(mt.items, ruw.filter((r) => r.clickup_id && mt.clickupIds.has(r.clickup_id)), mt.perClickup)
  return { items: [...items, ...meetings, ...shoots, ...reeksen], ...(team ? { bezet, beschikbaarheid } : {}) }
}

async function container(admin: Admin, k: Kijker, soort: string, id: string | null) {
  // All tasks: elke open taak (zonder subtaken) uit alles wat je ziet. Afgevinkte niet: dat zijn er
  // duizenden en die staan in Completed. Wie je ziet, beslist itemZichtbaar zoals overal.
  if (soort === 'alles') {
    const z = await laadZicht(admin, k)
    const ruw = await alleRijen<RuwItem>((a, b) => admin.from('ag_items').select(ITEM_VELDEN).is('verwijderd_op', null).is('parent_id', null).neq('status', 'klaar').not('lijst_id', 'is', null).order('id').range(a, b), 5000)
    return { items: await metToegewezen(admin, ruw, z, { subtaken: true }) }
  }
  if (!isUuid(id) || !['lijst', 'map', 'space'].includes(soort)) throw new Error('Ongeldige lijst')
  const z = await laadZicht(admin, k)
  let lijsten: string[] = []
  if (soort === 'lijst') lijsten = z.zichtbaar.lijsten.has(id) ? [id] : []
  if (soort === 'map') {
    const onder = new Set([id])
    for (let i = 0; i < 5; i++) for (const m of z.mappen) if (m.parent_id && onder.has(m.parent_id)) onder.add(m.id)
    lijsten = z.lijsten.filter((l) => l.map_id && onder.has(l.map_id) && z.zichtbaar.lijsten.has(l.id)).map((l) => l.id)
  }
  if (soort === 'space') lijsten = z.lijsten.filter((l) => l.space_id === id && z.zichtbaar.lijsten.has(l.id)).map((l) => l.id)
  if (!lijsten.length) return { items: [] }
  const ruw: RuwItem[] = []
  for (let i = 0; i < lijsten.length; i += 100) {
    ruw.push(...await alleRijen<RuwItem>((a, b) => admin.from('ag_items').select(ITEM_VELDEN).is('verwijderd_op', null).in('lijst_id', lijsten.slice(i, i + 100)).order('id').range(a, b)))
  }
  return { items: await metToegewezen(admin, ruw, z, { subtaken: true }) }
}

async function eenItem(admin: Admin, k: Kijker, id: string) {
  if (!isUuid(id)) throw new Error('Onbekend item')
  // Alles wat niet van elkaar afhangt tegelijk: zicht, de taak, subtaken, bijlagen en docs.
  // Wat je niet mag zien, wordt daarna weggefilterd (bijlagen en docs enkel als je de taak ziet).
  const haalItem = async () => {
    const { data, error } = await admin.from('ag_items').select(`${ITEM_VELDEN}, beschrijving, beschrijving_json, velden, gemaakt_door, created_at, in_app_gewijzigd_op`).eq('id', id).maybeSingle()
    if (error && /beschrijving_json/.test(error.message)) return (await admin.from('ag_items').select(`${ITEM_VELDEN}, beschrijving, velden, gemaakt_door, created_at, in_app_gewijzigd_op`).eq('id', id).maybeSingle()).data
    return data
  }
  const [z, data, { data: subs }, { data: bijlagen }, { data: docs }] = await Promise.all([
    laadZicht(admin, k),
    haalItem(),
    admin.from('ag_items').select(ITEM_VELDEN).eq('parent_id', id).is('verwijderd_op', null).order('created_at').limit(300),
    admin.from('ag_bijlagen').select('id, naam, type, grootte, geupload_door, created_at').eq('item_id', id).is('verwijderd_op', null).order('created_at'),
    admin.from('ag_docs').select('id, titel, updated_at, bijgewerkt_door').eq('item_id', id).is('verwijderd_op', null).order('created_at'),
  ])
  if (!data) throw new Error('Dit item bestaat niet meer.')
  const ouderId = (data as unknown as { parent_id?: string | null }).parent_id ?? null
  const [[item], subtaken, ouders] = await Promise.all([
    metToegewezen(admin, [data as unknown as RuwItem], z, { subtaken: true }),
    metToegewezen(admin, (subs ?? []) as unknown as RuwItem[], z),
    ouderId
      ? admin.from('ag_items').select(ITEM_VELDEN).eq('id', ouderId).maybeSingle().then(({ data: o }) => (o ? metToegewezen(admin, [o as unknown as RuwItem], z) : []))
      : Promise.resolve([] as Item[]),
  ])
  if (!item) throw new Error('Je kan dit item niet zien.')
  const ouder = ouders[0] ? { id: ouders[0].id, titel: ouders[0].titel } : null
  const extra = data as unknown as { gemaakt_door: string | null; created_at: string }
  const opmaak = (data as unknown as { beschrijving_json?: DocNode | null }).beschrijving_json ?? null
  return { item, beschrijving_json: opmaak, subtaken, ouder, gemaakt_door: extra.gemaakt_door, gemaakt_op: extra.created_at, bijlagen: bijlagen ?? [], docs: docs ?? [] }
}

async function afgevinkt(admin: Admin, k: Kijker, persoon: string | null, na: string | null, zoek: string | null) {
  const t = (zoek ?? '').trim().replace(/[%_,()"\\]/g, ' ').slice(0, 80)
  const z = await laadZicht(admin, k)
  const uit: Item[] = []
  let cursor = isIso(na) ? new Date(na).toISOString() : null
  // Per 400 tot er 150 zichtbare zijn (de meeste mag je zien, dus meestal één ronde).
  for (let ronde = 0; ronde < 6 && uit.length < 150; ronde++) {
    let q = admin.from('ag_items').select(ITEM_VELDEN).is('verwijderd_op', null).eq('status', 'klaar').not('afgerond_op', 'is', null).order('afgerond_op', { ascending: false }).limit(400)
    if (cursor) q = q.lt('afgerond_op', cursor)
    if (t.length >= 2) q = q.ilike('titel', `%${t}%`)
    const { data } = await q
    const rijen = (data ?? []) as unknown as RuwItem[]
    if (!rijen.length) break
    let items = await metToegewezen(admin, rijen, z)
    if (isUuid(persoon)) items = items.filter((i) => i.toegewezen.includes(persoon))
    uit.push(...items)
    cursor = rijen[rijen.length - 1].afgerond_op
    if (rijen.length < 400) { cursor = null; break }
  }
  return { items: uit.slice(0, 150), volgende: uit.length >= 150 ? uit[149].afgerond_op : cursor }
}

async function eenDoc(admin: Admin, k: Kijker, id: string) {
  if (!isUuid(id)) throw new Error('Onbekend document')
  const z = await laadZicht(admin, k)
  const { data } = await admin.from('ag_docs').select('id, titel, inhoud, inhoud_json, space_id, map_id, lijst_id, item_id, prive, eigenaar_id, kijkers, clickup_parent_id, bijgewerkt_door, updated_at, created_at, verwijderd_op').eq('id', id).maybeSingle()
  if (!data || !docZichtbaar(data as never, z)) throw new Error('Dit document bestaat niet of je kan het niet zien.')
  return { doc: data }
}

/** Een afbeelding in een document: enkel voor wie het document ziet, via een link van een uur. */
async function docBeeldOpenen(admin: Admin, k: Kijker, pad: string) {
  const m = pad.match(BEELD_PAD)
  if (!m) return fout('Onbekende afbeelding', 404)
  const { data: d } = await admin.from('ag_docs').select('id, space_id, map_id, lijst_id, prive, eigenaar_id, kijkers, clickup_parent_id').eq('id', m[1]).maybeSingle()
  const z = await laadZicht(admin, k)
  if (!d || !docZichtbaar(d as never, z)) return fout('Geen toegang', 403)
  const { data, error } = await admin.storage.from(BIJLAGE_BUCKET).createSignedUrl(`docs/${pad}`, 3600)
  if (error || !data?.signedUrl) return fout('De afbeelding kon niet geladen worden.', 404)
  const r = NextResponse.redirect(data.signedUrl)
  r.headers.set('Cache-Control', 'private, max-age=3000')
  return r
}

/** Een bijlage bekijken of downloaden: een kortlevende link, enkel voor wie de taak ziet. */
async function bijlageOpenen(admin: Admin, k: Kijker, id: string) {
  if (!isUuid(id)) return fout('Onbekende bijlage')
  const { data: b } = await admin.from('ag_bijlagen').select('id, item_id, pad, naam').eq('id', id).is('verwijderd_op', null).maybeSingle()
  if (!b) return fout('Deze bijlage bestaat niet meer.', 404)
  const z = await laadZicht(admin, k)
  await zichtbaarItem(admin, z, b.item_id)
  const { data, error } = await admin.storage.from(BIJLAGE_BUCKET).createSignedUrl(b.pad, 120, { download: false })
  if (error || !data?.signedUrl) return fout('De bijlage kon niet geopend worden.', 500)
  return NextResponse.redirect(data.signedUrl)
}

async function prullenbak(admin: Admin, k: Kijker) {
  const z = await laadZicht(admin, k, { metVerwijderd: true })
  type MetV = { id: string; naam: string; verwijderd_op: string | null; verwijderd_door: string | null }
  const weg = <T extends MetV>(l: T[], zicht: Set<string>) => l.filter((x) => x.verwijderd_op && zicht.has(x.id)).map((x) => ({ id: x.id, naam: x.naam, verwijderd_op: x.verwijderd_op, verwijderd_door: x.verwijderd_door }))
  const spaces = weg(z.spaces as unknown as MetV[], z.zichtbaar.spaces)
  const mappen = weg(z.mappen as unknown as MetV[], z.zichtbaar.mappen)
  const lijsten = weg(z.lijsten as unknown as MetV[], z.zichtbaar.lijsten)
  const [{ data: it }, { data: dc }] = await Promise.all([
    admin.from('ag_items').select(`${ITEM_VELDEN}, verwijderd_op, verwijderd_door`).not('verwijderd_op', 'is', null).order('verwijderd_op', { ascending: false }).limit(500),
    admin.from('ag_docs').select('id, titel, space_id, map_id, lijst_id, prive, eigenaar_id, kijkers, clickup_parent_id, verwijderd_op, verwijderd_door').not('verwijderd_op', 'is', null).order('verwijderd_op', { ascending: false }).limit(300),
  ])
  const ruw = (it ?? []) as unknown as (RuwItem & { verwijderd_door: string | null })[]
  const zichtbaar = await metToegewezen(admin, ruw, z)
  const per = new Map(ruw.map((r) => [r.id, r]))
  return {
    spaces, mappen, lijsten,
    items: zichtbaar.map((i) => ({ id: i.id, titel: i.titel, soort: i.soort, lijst_id: i.lijst_id, verwijderd_op: per.get(i.id)?.verwijderd_op ?? null, verwijderd_door: per.get(i.id)?.verwijderd_door ?? null })),
    docs: ((dc ?? []) as { id: string; titel: string; space_id: string | null; map_id: string | null; lijst_id: string | null; prive: boolean; eigenaar_id: string | null; clickup_parent_id: string | null; verwijderd_op: string; verwijderd_door: string | null }[])
      .filter((d) => docZichtbaar(d, z)).map((d) => ({ id: d.id, titel: d.titel, verwijderd_op: d.verwijderd_op, verwijderd_door: d.verwijderd_door })),
  }
}

async function mailVoorstellen(admin: Admin, k: Kijker) {
  if (!k.isAdmin) return { voorstellen: [] }
  const { data } = await admin.from('ag_mail_voorstellen')
    .select('id, mailbox, van, van_naam, onderwerp, ontvangen_op, titel, start_op, eind_op, locatie, meet_url, platform, deelnemers, organisator, beschrijving, bron, status, item_id, geannuleerd, vervangt_item_id, beslist_door, beslist_op')
    .or(`status.eq.voorstel,beslist_op.gte."${new Date(Date.now() - 14 * 86_400_000).toISOString()}"`)
    .order('start_op', { ascending: true }).limit(200)
  return { voorstellen: data ?? [] }
}

async function zoek(admin: Admin, k: Kijker, tekst: string) {
  const t = tekst.trim().replace(/[%_,()"\\]/g, ' ').slice(0, 80)
  if (t.length < 2) return { items: [] }
  const z = await laadZicht(admin, k)
  const { data } = await admin.from('ag_items').select(ITEM_VELDEN).is('verwijderd_op', null).ilike('titel', `%${t}%`).order('eind_op', { ascending: false, nullsFirst: false }).limit(120)
  return { items: (await metToegewezen(admin, (data ?? []) as unknown as RuwItem[], z)).slice(0, 50) }
}

// ── POST ────────────────────────────────────────────────────────────────────

const ACTIE_RECHT: Record<string, Actie> = {
  'item.nieuw': 'toevoegen', 'item.wijzig': 'aanpassen', 'item.verplaats': 'aanpassen', 'item.verwijder': 'verwijderen', 'item.herstel': 'verwijderen',
  'container.nieuw': 'toevoegen', 'container.wijzig': 'aanpassen', 'container.verwijder': 'verwijderen', 'container.herstel': 'verwijderen',
  'doc.nieuw': 'toevoegen', 'doc.wijzig': 'aanpassen', 'doc.beeld': 'aanpassen', 'doc.verwijder': 'verwijderen', 'doc.herstel': 'verwijderen',
  'label.bewaar': 'instellingen', 'label.verwijder': 'instellingen', 'klantkleur': 'instellingen',
  'delen': 'bekijken', 'clickup.koppel': 'bekijken', 'clickup.ontkoppel': 'bekijken', 'clickup.nu': 'bekijken',
  'mail.plan': 'toevoegen', 'mail.negeer': 'bekijken', 'mail.terug': 'bekijken',
  'bijlage.upload': 'aanpassen', 'bijlage.bewaar': 'aanpassen', 'bijlage.verwijder': 'aanpassen',
  'inspreek.lees': 'toevoegen',
  'meeting.klaar': 'aanpassen',
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const actie = String(b.actie ?? '')
  const recht = ACTIE_RECHT[actie]
  if (!recht) return fout('Onbekende actie')
  const c = await toegang(recht)
  if (c instanceof NextResponse) return c
  try {
    if (actie.startsWith('item.')) return NextResponse.json(await itemActie(c, actie, b))
    if (actie.startsWith('container.')) return NextResponse.json(await containerActie(c, actie, b))
    if (actie.startsWith('doc.')) return NextResponse.json(await docActie(c, actie, b))
    if (actie.startsWith('label.') || actie === 'klantkleur') return NextResponse.json(await instellingActie(c, actie, b))
    if (actie === 'delen') return NextResponse.json(await delen(c, b))
    if (actie.startsWith('clickup.')) return NextResponse.json(await clickupActie(c, actie, b))
    if (actie.startsWith('mail.')) return NextResponse.json(await mailActie(c, actie, b))
    if (actie.startsWith('bijlage.')) return NextResponse.json(await bijlageActie(c, actie, b))
    if (actie === 'inspreek.lees') return NextResponse.json(await inspreekLees(c, b))
    if (actie === 'meeting.klaar') return NextResponse.json(await meetingKlaar(c, b))
    return fout('Onbekende actie')
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Er ging iets mis'
    return fout(m, m.startsWith('Conflict:') ? 409 : 400)
  }
}

async function zichtbaarItem(admin: Admin, z: Zicht, id: unknown, metVerwijderd = false): Promise<RuwItem> {
  if (!isUuid(id)) throw new Error('Onbekend item')
  let q = admin.from('ag_items').select(`${ITEM_VELDEN}, verwijderd_op`).eq('id', id)
  if (!metVerwijderd) q = q.is('verwijderd_op', null)
  const { data } = await q.maybeSingle()
  if (!data) throw new Error('Dit item bestaat niet meer.')
  const r = data as unknown as RuwItem
  const { data: tw } = await admin.from('ag_toegewezen').select('persoon_id').eq('item_id', id)
  if (!itemZichtbaar(r, ((tw ?? []) as { persoon_id: string }[]).map((x) => x.persoon_id), z)) throw new Error('Je kan dit item niet zien.')
  return r
}

async function zetToegewezen(admin: Admin, itemId: string, personen: string[]) {
  const { data: geldig } = personen.length ? await admin.from('ag_personen').select('id').in('id', personen) : { data: [] }
  const ids = ((geldig ?? []) as { id: string }[]).map((p) => p.id)
  await admin.from('ag_toegewezen').delete().eq('item_id', itemId)
  if (ids.length) await admin.from('ag_toegewezen').insert(ids.map((p) => ({ item_id: itemId, persoon_id: p })))
}

async function itemActie(c: Ctx, actie: string, b: Record<string, unknown>) {
  const { admin, k } = c
  const z = await laadZicht(admin, k)
  // Meerdere items in één keer naar een andere dag (Naar vandaag en Ongedaan maken).
  // Enkel de datums; wat je niet ziet of niet meer bestaat, slaat de server over.
  if (actie === 'item.verplaats') {
    const lijst = Array.isArray(b.wijzigingen) ? (b.wijzigingen as Record<string, unknown>[]).filter((w) => w && isUuid(w.id)) : []
    if (!lijst.length) throw new Error('Niets om te verplaatsen.')
    if (lijst.length > MAX_VERPLAATS) throw new Error(`Hoogstens ${MAX_VERPLAATS} taken tegelijk.`)
    const ids = [...new Set(lijst.map((w) => w.id as string))]
    const [{ data: rijen }, { data: tw }] = await Promise.all([
      admin.from('ag_items').select(ITEM_VELDEN).in('id', ids).is('verwijderd_op', null),
      admin.from('ag_toegewezen').select('item_id, persoon_id').in('item_id', ids),
    ])
    const wie = new Map<string, string[]>()
    for (const t of (tw ?? []) as { item_id: string; persoon_id: string }[]) wie.set(t.item_id, [...(wie.get(t.item_id) ?? []), t.persoon_id])
    const mag = new Set(((rijen ?? []) as unknown as RuwItem[]).filter((r) => itemZichtbaar(r, wie.get(r.id) ?? [], z)).map((r) => r.id))
    const updates: { id: string; velden: Record<string, unknown> }[] = []
    for (const w of lijst) {
      if (!mag.has(w.id as string)) continue
      const datums = Object.fromEntries((['start_op', 'eind_op', 'heel_dag', 'deadline_op'] as const).filter((x) => x in w).map((x) => [x, w[x]]))
      const { velden, fout: f } = controleerItem(datums, false)
      if (f) throw new Error(f)
      updates.push({ id: w.id as string, velden })
    }
    let verplaatst = 0
    for (let n = 0; n < updates.length; n += 10) {
      const res = await Promise.all(updates.slice(n, n + 10).map((u) => admin.from('ag_items').update({ ...u.velden, in_app_gewijzigd_op: nu(), updated_at: nu() }).eq('id', u.id)))
      verplaatst += res.filter((r) => !r.error).length
    }
    return { ok: true, verplaatst, overgeslagen: lijst.length - verplaatst }
  }
  if (actie === 'item.nieuw' || actie === 'item.wijzig') {
    const nieuw = actie === 'item.nieuw'
    const { velden, toegewezen, fout: f } = controleerItem(b, nieuw)
    if (f) throw new Error(f)
    if (typeof velden.lijst_id === 'string' && !z.zichtbaar.lijsten.has(velden.lijst_id)) throw new Error('Die lijst bestaat niet of je kan ze niet zien.')
    if (typeof velden.parent_id === 'string') await zichtbaarItem(admin, z, velden.parent_id)
    if ('status' in velden) {
      velden.afgerond_op = velden.status === 'klaar' ? nu() : null
      velden.afgerond_door = velden.status === 'klaar' ? k.naam : null
    }
    if (nieuw) {
      const rij = {
        ...velden, eigenaar_id: k.persoonId, gemaakt_door: k.naam, in_app_gewijzigd_op: nu(),
        heel_dag: velden.heel_dag ?? false, labels: velden.labels ?? [],
      }
      let { data, error } = await admin.from('ag_items').insert(rij).select('id').single()
      // Vóór de migratie: zonder de opmaak (de tekst staat er wel).
      if (error && /beschrijving_json/.test(error.message)) { delete (rij as Record<string, unknown>).beschrijving_json; ({ data, error } = await admin.from('ag_items').insert(rij).select('id').single()) }
      if (error || !data) throw new Error(error?.message ?? 'Bewaren mislukt')
      await zetToegewezen(admin, data.id, toegewezen ?? [k.persoonId])
      return { ok: true, id: data.id }
    }
    const bestaand = await zichtbaarItem(admin, z, b.id)
    // Wie het tegelijk aanpaste, wint niet stil: met `versie` (updated_at zoals gezien) controleren we.
    if (typeof b.versie === 'string' && bestaand.updated_at && Date.parse(b.versie) !== Date.parse(bestaand.updated_at)) throw new Error('Conflict: iemand anders paste dit item intussen aan. Herlaad en probeer opnieuw.')
    if ('status' in velden && velden.status === bestaand.status) { delete velden.afgerond_op; delete velden.afgerond_door }
    // Tekst aangepast buiten de editor (bv. een notitie bij Dag afsluiten): kwam er enkel iets
    // onderaan bij, dan komt dat ook onder de opmaak; anders geldt de nieuwe tekst.
    if ('beschrijving' in velden && !('beschrijving_json' in velden)) {
      const { data: oud, error: e0 } = await admin.from('ag_items').select('beschrijving, beschrijving_json').eq('id', bestaand.id).maybeSingle()
      const r = oud as { beschrijving: string | null; beschrijving_json: DocNode | null } | null
      if (!e0 && r?.beschrijving_json) velden.beschrijving_json = vulDocAan(r.beschrijving_json, r.beschrijving, velden.beschrijving as string | null)
    }
    const wijziging = { ...velden, in_app_gewijzigd_op: nu(), updated_at: nu() }
    let { data: upd, error } = await admin.from('ag_items').update(wijziging).eq('id', bestaand.id).select('updated_at').single()
    if (error && /beschrijving_json/.test(error.message)) { delete (wijziging as Record<string, unknown>).beschrijving_json; ({ data: upd, error } = await admin.from('ag_items').update(wijziging).eq('id', bestaand.id).select('updated_at').single()) }
    if (error) throw new Error(error.message)
    if (toegewezen) await zetToegewezen(admin, bestaand.id, toegewezen)
    return { ok: true, id: bestaand.id, versie: upd?.updated_at ?? null }
  }
  if (actie === 'item.verwijder') {
    const r = await zichtbaarItem(admin, z, b.id)
    await admin.from('ag_items').update({ verwijderd_op: nu(), verwijderd_door: k.naam, in_app_gewijzigd_op: nu() }).eq('id', r.id)
    return { ok: true }
  }
  if (actie === 'item.herstel') {
    const r = await zichtbaarItem(admin, z, b.id, true)
    await admin.from('ag_items').update({ verwijderd_op: null, verwijderd_door: null, in_app_gewijzigd_op: nu() }).eq('id', r.id)
    return { ok: true }
  }
  throw new Error('Onbekende actie')
}

const TABEL = { space: 'ag_spaces', map: 'ag_mappen', lijst: 'ag_lijsten' } as const
type Soort = keyof typeof TABEL

async function containerActie(c: Ctx, actie: string, b: Record<string, unknown>) {
  const { admin, k } = c
  const soort = String(b.soort ?? '') as Soort
  if (!(soort in TABEL)) throw new Error('Onbekende soort')
  const z = await laadZicht(admin, k, { metVerwijderd: actie === 'container.herstel' })
  const zicht = soort === 'space' ? z.zichtbaar.spaces : soort === 'map' ? z.zichtbaar.mappen : z.zichtbaar.lijsten
  const naam = typeof b.naam === 'string' ? b.naam.trim().slice(0, 200) : ''
  const zetPrive = async (id: string, prive: boolean, extra: string[] = []) => {
    await admin.from('ag_leden').delete().eq('soort', soort).eq('doel_id', id)
    if (prive) {
      const ids = [...new Set([k.persoonId, ...extra.filter(isUuid)])].slice(0, 30)
      const { data: geldig } = await admin.from('ag_personen').select('id').in('id', ids)
      await admin.from('ag_leden').insert(((geldig ?? []) as { id: string }[]).map((p) => ({ soort, doel_id: id, persoon_id: p.id })))
    }
    await admin.from(TABEL[soort]).update({ prive }).eq('id', id)
  }
  const verantwoordelijke = soort === 'space' && 'verantwoordelijke_id' in b ? (isUuid(b.verantwoordelijke_id) ? b.verantwoordelijke_id : null) : undefined
  const leden = Array.isArray(b.leden) ? (b.leden as unknown[]).filter(isUuid) : []
  if (actie === 'container.nieuw') {
    if (!naam) throw new Error('Geef een naam.')
    const rij: Record<string, unknown> = { naam, kleur: isKleur(b.kleur) ? b.kleur : null, volgorde: Date.now() / 1e10 + 1000, ...(verantwoordelijke !== undefined ? { verantwoordelijke_id: verantwoordelijke } : {}) }
    if (soort !== 'space') {
      if (!isUuid(b.space_id) || !z.zichtbaar.spaces.has(b.space_id)) throw new Error('Kies een space.')
      rij.space_id = b.space_id
      if (soort === 'map' && isUuid(b.parent_id)) { if (!z.zichtbaar.mappen.has(b.parent_id)) throw new Error('Onbekende map.'); rij.parent_id = b.parent_id }
      if (soort === 'lijst' && isUuid(b.map_id)) { if (!z.zichtbaar.mappen.has(b.map_id)) throw new Error('Onbekende map.'); rij.map_id = b.map_id }
      if (isUuid(b.client_id)) rij.client_id = b.client_id
    }
    const { data, error } = await admin.from(TABEL[soort]).insert(rij).select('id').single()
    if (error || !data) throw new Error(error?.message ?? 'Bewaren mislukt')
    // Privé: ik, de verantwoordelijke en wie erbij gekozen werd.
    if (b.prive === true) await zetPrive(data.id, true, [...leden, ...(verantwoordelijke ? [verantwoordelijke] : [])])
    return { ok: true, id: data.id }
  }
  if (!isUuid(b.id) || !zicht.has(b.id)) throw new Error('Die bestaat niet of je kan ze niet zien.')
  const id = b.id
  if (actie === 'container.wijzig') {
    const upd: Record<string, unknown> = { updated_at: nu() }
    if ('naam' in b) { if (!naam) throw new Error('Geef een naam.'); upd.naam = naam }
    if ('kleur' in b) upd.kleur = isKleur(b.kleur) ? b.kleur : null
    if ('client_id' in b && soort !== 'space') upd.client_id = isUuid(b.client_id) ? b.client_id : null
    // Bedrijf van een map (en alles eronder): NextGenMedia, NextGenSolutions, algemeen of leeg = vanzelf.
    if ('bedrijf' in b && soort === 'map') upd.bedrijf = ['nextgenmedia', 'nextgensolutions', 'algemeen'].includes(String(b.bedrijf)) ? String(b.bedrijf) : null
    if (verantwoordelijke !== undefined) upd.verantwoordelijke_id = verantwoordelijke
    // Verplaatsen (slepen in de boom). De ClickUp-import zet het daarna niet terug (`plaats_vast`).
    if (soort === 'lijst' && ('map_id' in b || 'space_id' in b)) {
      if (isUuid(b.map_id)) {
        const m = z.mappen.find((x) => x.id === b.map_id)
        if (!m || !z.zichtbaar.mappen.has(m.id)) throw new Error('Onbekende map.')
        upd.map_id = m.id; upd.space_id = m.space_id
      } else if (isUuid(b.space_id)) {
        if (!z.zichtbaar.spaces.has(b.space_id)) throw new Error('Onbekende space.')
        upd.map_id = null; upd.space_id = b.space_id
      }
      upd.plaats_vast = true
    }
    if (soort === 'map' && ('parent_id' in b || 'space_id' in b)) {
      const onder = new Set([id])
      for (let i = 0; i < 6; i++) for (const m of z.mappen) if (m.parent_id && onder.has(m.parent_id)) onder.add(m.id)
      let spaceId: string
      if (isUuid(b.parent_id)) {
        if (onder.has(b.parent_id)) throw new Error('Een map kan niet in zichzelf of in een eigen submap.')
        const ouder = z.mappen.find((x) => x.id === b.parent_id)
        if (!ouder || !z.zichtbaar.mappen.has(ouder.id)) throw new Error('Onbekende map.')
        upd.parent_id = ouder.id; spaceId = ouder.space_id
      } else {
        if (!isUuid(b.space_id) || !z.zichtbaar.spaces.has(b.space_id)) throw new Error('Onbekende space.')
        upd.parent_id = null; spaceId = b.space_id
      }
      upd.space_id = spaceId; upd.plaats_vast = true
      // Alles eronder volgt naar de nieuwe space.
      const sub = [...onder].filter((x) => x !== id)
      if (sub.length) await admin.from('ag_mappen').update({ space_id: spaceId, plaats_vast: true }).in('id', sub)
      await admin.from('ag_lijsten').update({ space_id: spaceId, plaats_vast: true }).in('map_id', [...onder])
    }
    const { error: fw } = await admin.from(TABEL[soort]).update(upd).eq('id', id)
    if (fw) throw new Error(fw.message)
    if ('prive' in b) {
      await zetPrive(id, b.prive === true, leden)
      // In de app privé (of niet meer) gezet: de ClickUp-import laat dat voortaan staan.
      await admin.from(TABEL[soort]).update({ leden_vast: true }).eq('id', id)
    }
    return { ok: true }
  }
  if (actie === 'container.verwijder') {
    await admin.from(TABEL[soort]).update({ verwijderd_op: nu(), verwijderd_door: k.naam }).eq('id', id)
    return { ok: true }
  }
  if (actie === 'container.herstel') {
    await admin.from(TABEL[soort]).update({ verwijderd_op: null, verwijderd_door: null }).eq('id', id)
    // De bovenliggende map en space mee terug, anders blijft het onzichtbaar.
    const lijst = soort === 'lijst' ? z.lijsten.find((l) => l.id === id) : null
    const map = soort === 'map' ? z.mappen.find((m) => m.id === id) : lijst?.map_id ? z.mappen.find((m) => m.id === lijst.map_id) : null
    const ouders: string[] = []
    for (let m = map, i = 0; m && i < 6; m = m.parent_id ? z.mappen.find((x) => x.id === m!.parent_id) : undefined, i++) ouders.push(m.id)
    if (ouders.length) await admin.from('ag_mappen').update({ verwijderd_op: null, verwijderd_door: null }).in('id', ouders)
    const spaceId = lijst?.space_id ?? map?.space_id
    if (spaceId) await admin.from('ag_spaces').update({ verwijderd_op: null, verwijderd_door: null }).eq('id', spaceId)
    return { ok: true }
  }
  throw new Error('Onbekende actie')
}

async function docActie(c: Ctx, actie: string, b: Record<string, unknown>) {
  const { admin, k } = c
  const z = await laadZicht(admin, k)
  if (actie === 'doc.nieuw') {
    const titel = typeof b.titel === 'string' && b.titel.trim() ? b.titel.trim().slice(0, 300) : 'Nieuw document'
    const rij: Record<string, unknown> = { titel, inhoud: typeof b.inhoud === 'string' ? b.inhoud.slice(0, 500_000) : '', eigenaar_id: k.persoonId, bijgewerkt_door: k.naam, prive: b.prive === true, in_app_gewijzigd_op: nu() }
    if (isUuid(b.item_id)) {
      // Een doc bij een taak: zelfde lijst als de taak, dus dezelfde mensen zien het.
      const it = await zichtbaarItem(admin, z, b.item_id)
      rij.item_id = it.id
      rij.lijst_id = it.lijst_id
      rij.prive = it.prive
    } else if (isUuid(b.lijst_id)) { if (!z.zichtbaar.lijsten.has(b.lijst_id)) throw new Error('Onbekende lijst.'); rij.lijst_id = b.lijst_id }
    else if (isUuid(b.map_id)) { if (!z.zichtbaar.mappen.has(b.map_id)) throw new Error('Onbekende map.'); rij.map_id = b.map_id }
    else if (isUuid(b.space_id)) { if (!z.zichtbaar.spaces.has(b.space_id)) throw new Error('Onbekende space.'); rij.space_id = b.space_id }
    const { data, error } = await admin.from('ag_docs').insert(rij).select('id, updated_at').single()
    if (error || !data) throw new Error(error?.message ?? 'Bewaren mislukt')
    return { ok: true, id: data.id, versie: data.updated_at }
  }
  if (!isUuid(b.id)) throw new Error('Onbekend document')
  const { data: d } = await admin.from('ag_docs').select('id, space_id, map_id, lijst_id, prive, eigenaar_id, kijkers, clickup_parent_id, updated_at, verwijderd_op').eq('id', b.id).maybeSingle()
  if (!d || !docZichtbaar(d as never, z)) throw new Error('Dit document bestaat niet of je kan het niet zien.')
  if (actie === 'doc.wijzig') {
    if (typeof b.versie === 'string' && Date.parse(b.versie) !== Date.parse(d.updated_at)) throw new Error('Conflict: iemand anders paste dit document intussen aan. Herlaad om de laatste versie te zien.')
    const upd: Record<string, unknown> = { updated_at: nu(), in_app_gewijzigd_op: nu(), bijgewerkt_door: k.naam }
    if (typeof b.titel === 'string') upd.titel = b.titel.trim().slice(0, 300) || 'Naamloos document'
    if (typeof b.inhoud === 'string') upd.inhoud = b.inhoud.slice(0, 500_000)
    // Verplaatsen naar een space, map of lijst (slepen in de boom).
    if (b.naar && typeof b.naar === 'object') {
      const naar = b.naar as Record<string, unknown>
      const { data: metItem } = await admin.from('ag_docs').select('item_id').eq('id', d.id).maybeSingle()
      if (metItem?.item_id) throw new Error('Dit document hoort bij een taak. Open de taak om het te beheren.')
      if (isUuid(naar.lijst_id)) { if (!z.zichtbaar.lijsten.has(naar.lijst_id)) throw new Error('Onbekende lijst.'); Object.assign(upd, { lijst_id: naar.lijst_id, map_id: null, space_id: null }) }
      else if (isUuid(naar.map_id)) { if (!z.zichtbaar.mappen.has(naar.map_id)) throw new Error('Onbekende map.'); Object.assign(upd, { lijst_id: null, map_id: naar.map_id, space_id: null }) }
      else if (isUuid(naar.space_id)) { if (!z.zichtbaar.spaces.has(naar.space_id)) throw new Error('Onbekende space.'); Object.assign(upd, { lijst_id: null, map_id: null, space_id: naar.space_id }) }
      else throw new Error('Waarheen?')
    }
    // De opmaak (koppen, lijsten, tabellen, afbeeldingen …): nagekeken, links en afbeeldingen enkel veilige adressen.
    if ('inhoud_json' in b) {
      const json = b.inhoud_json === null ? null : schoonDocJson(b.inhoud_json, d.id)
      if (b.inhoud_json !== null && !json) throw new Error('Deze opmaak kan niet bewaard worden.')
      upd.inhoud_json = json
    }
    // Privé maken en kiezen wie het mag zien. Wie het privé maakt, blijft het zelf altijd zien.
    if ('prive' in b || 'kijkers' in b) {
      const prive = 'prive' in b ? b.prive === true : d.prive
      upd.prive = prive
      let eigenaar = d.eigenaar_id as string | null
      if (prive && !eigenaar) { eigenaar = k.persoonId; upd.eigenaar_id = eigenaar }
      let kijkers = 'kijkers' in b && Array.isArray(b.kijkers) ? [...new Set((b.kijkers as unknown[]).filter(isUuid))].slice(0, 50) : ((d.kijkers ?? []) as string[])
      if (prive && eigenaar !== k.persoonId && !kijkers.includes(k.persoonId)) kijkers = [...kijkers, k.persoonId]
      if (kijkers.length) {
        const { data: geldig } = await admin.from('ag_personen').select('id').in('id', kijkers)
        kijkers = ((geldig ?? []) as { id: string }[]).map((x) => x.id)
      }
      upd.kijkers = kijkers.filter((x) => x !== eigenaar)
    }
    const { data, error } = await admin.from('ag_docs').update(upd).eq('id', d.id).select('updated_at').single()
    if (error) throw new Error(error.message)
    return { ok: true, versie: data?.updated_at }
  }
  // Een afbeelding in het document: de browser laadt rechtstreeks op (link met handtekening).
  if (actie === 'doc.beeld') {
    const type = typeof b.type === 'string' ? b.type.toLowerCase() : ''
    const ext = BEELD_TYPES[type]
    const grootte = Number(b.grootte)
    if (!ext) throw new Error('Enkel foto\'s: png, jpg, gif of webp.')
    if (!Number.isFinite(grootte) || grootte <= 0) throw new Error('Leeg bestand.')
    if (grootte > MAX_BEELD) throw new Error('De afbeelding is groter dan 10 MB.')
    const naam = `${d.id}/${crypto.randomUUID()}.${ext}`
    const { data, error } = await admin.storage.from(BIJLAGE_BUCKET).createSignedUploadUrl(`docs/${naam}`)
    if (error || !data?.token) throw new Error(error?.message ?? 'Uploadlink maken mislukt')
    return { ok: true, pad: `docs/${naam}`, token: data.token, bucket: BIJLAGE_BUCKET, src: `/api/admin/agenda?docbeeld=${naam}` }
  }
  if (actie === 'doc.verwijder') { await admin.from('ag_docs').update({ verwijderd_op: nu(), verwijderd_door: k.naam }).eq('id', d.id); return { ok: true } }
  if (actie === 'doc.herstel') { await admin.from('ag_docs').update({ verwijderd_op: null, verwijderd_door: null }).eq('id', d.id); return { ok: true } }
  throw new Error('Onbekende actie')
}

async function instellingActie(c: Ctx, actie: string, b: Record<string, unknown>) {
  const { admin } = c
  if (actie === 'label.bewaar') {
    const naam = typeof b.naam === 'string' ? b.naam.trim().slice(0, 60) : ''
    if (!naam) throw new Error('Geef het label een naam.')
    const kleur = isKleur(b.kleur) ? b.kleur : '#6e6e6e'
    if (isUuid(b.id)) {
      const { error } = await admin.from('ag_labels').update({ naam, kleur }).eq('id', b.id)
      if (error) throw new Error(error.code === '23505' ? 'Dat label bestaat al.' : error.message)
      return { ok: true, id: b.id }
    }
    const { data, error } = await admin.from('ag_labels').insert({ naam, kleur, volgorde: Math.floor(Date.now() / 1000) % 100000 }).select('id').single()
    if (error) throw new Error(error.code === '23505' ? 'Dat label bestaat al.' : error.message)
    return { ok: true, id: data?.id }
  }
  if (actie === 'label.verwijder') {
    if (!isUuid(b.id)) throw new Error('Onbekend label')
    await admin.from('ag_labels').delete().eq('id', b.id)
    return { ok: true }
  }
  if (actie === 'klantkleur') {
    if (!isUuid(b.client_id)) throw new Error('Onbekende klant')
    if (isKleur(b.kleur)) await admin.from('ag_klant_kleuren').upsert({ client_id: b.client_id, kleur: b.kleur }, { onConflict: 'client_id' })
    else await admin.from('ag_klant_kleuren').delete().eq('client_id', b.client_id)
    return { ok: true }
  }
  throw new Error('Onbekende actie')
}

/** Met wie deel ik mijn eigen agenda (mijn privélijsten en privé-items)? */
async function delen(c: Ctx, b: Record<string, unknown>) {
  const { admin, k } = c
  const kijkers = Array.isArray(b.kijkers) ? [...new Set(b.kijkers.filter(isUuid))].filter((x) => x !== k.persoonId).slice(0, 50) : []
  const { data: geldig } = kijkers.length ? await admin.from('ag_personen').select('id').in('id', kijkers) : { data: [] }
  await admin.from('ag_delen').delete().eq('eigenaar_id', k.persoonId)
  const ids = ((geldig ?? []) as { id: string }[]).map((x) => x.id)
  if (ids.length) await admin.from('ag_delen').insert(ids.map((x) => ({ eigenaar_id: k.persoonId, kijker_id: x })))
  return { ok: true, kijkers: ids }
}

async function clickupActie(c: Ctx, actie: string, b: Record<string, unknown>) {
  const { admin, k } = c
  const { koppelToken, importeerClickup } = await import('@/lib/agenda/clickup-import')
  if (actie === 'clickup.koppel') {
    if (typeof b.token !== 'string') throw new Error('Plak je persoonlijke ClickUp-token.')
    const r = await koppelToken(admin, k.persoonId, b.token)
    return { ok: true, naam: r.naam }
  }
  if (actie === 'clickup.ontkoppel') {
    // Het token gaat weg; wat al overgenomen is, blijft staan.
    await admin.from('ag_clickup_bronnen').update({ actief: false, token: null }).eq('sleutel', `persoon:${k.persoonId}`)
    return { ok: true }
  }
  if (actie === 'clickup.nu') {
    const { data: bron } = await admin.from('ag_clickup_bronnen').select('id').eq('sleutel', k.isAdmin && b.alle === true ? 'gedeeld' : `persoon:${k.persoonId}`).maybeSingle()
    const r = await importeerClickup(admin, { budgetMs: 45_000, enkel: k.isAdmin && b.alle === true ? undefined : bron?.id ?? '00000000-0000-0000-0000-000000000000' })
    return { ok: true, bronnen: r.map((x) => ({ fase: x.fase, klaar: x.klaar, tellers: x.tellers, fout: x.fout })) }
  }
  throw new Error('Onbekende actie')
}

async function mailActie(c: Ctx, actie: string, b: Record<string, unknown>) {
  const { admin, k } = c
  if (!k.isAdmin) throw new Error('Enkel de zaakvoerders zien de uitnodigingen uit de mail.')
  if (!isUuid(b.id)) throw new Error('Onbekend voorstel')
  const { data: v } = await admin.from('ag_mail_voorstellen').select('*').eq('id', b.id).maybeSingle()
  if (!v) throw new Error('Dit voorstel bestaat niet meer.')
  if (actie === 'mail.negeer' || actie === 'mail.terug') {
    const status = actie === 'mail.negeer' ? 'genegeerd' : 'voorstel'
    await admin.from('ag_mail_voorstellen').update({ status, beslist_door: actie === 'mail.negeer' ? k.naam : null, beslist_op: actie === 'mail.negeer' ? nu() : null }).eq('id', v.id)
    return { ok: true }
  }
  // Inplannen: voorwaardelijk op de status, zodat twee klikken één item geven.
  if (v.status !== 'voorstel') throw new Error('Dit voorstel werd al behandeld.')
  const z = await laadZicht(admin, k)
  if (v.geannuleerd) {
    if (v.vervangt_item_id) await admin.from('ag_items').update({ verwijderd_op: nu(), verwijderd_door: k.naam, in_app_gewijzigd_op: nu() }).eq('id', v.vervangt_item_id)
    await admin.from('ag_mail_voorstellen').update({ status: 'ingepland', beslist_door: k.naam, beslist_op: nu(), item_id: v.vervangt_item_id }).eq('id', v.id).eq('status', 'voorstel')
    return { ok: true }
  }
  const invoer = {
    titel: b.titel ?? v.titel, start_op: b.start_op ?? v.start_op, eind_op: b.eind_op ?? v.eind_op, heel_dag: false, soort: 'meeting',
    locatie: v.locatie, meet_url: v.meet_url,
    beschrijving: [v.beschrijving, deelnemersTekst(v.organisator, v.deelnemers)].filter(Boolean).join('\n\n'),
    ...(b.lijst_id !== undefined ? { lijst_id: b.lijst_id } : {}), ...(b.client_id !== undefined ? { client_id: b.client_id } : {}),
    ...(b.labels !== undefined ? { labels: b.labels } : {}), ...(b.prive !== undefined ? { prive: b.prive } : {}),
  }
  const { velden, toegewezen, fout: f } = controleerItem({ ...invoer, toegewezen: b.toegewezen }, true)
  if (f) throw new Error(f)
  if (typeof velden.lijst_id === 'string' && !z.zichtbaar.lijsten.has(velden.lijst_id)) throw new Error('Die lijst bestaat niet of je kan ze niet zien.')
  const { data: claim } = await admin.from('ag_mail_voorstellen').update({ status: 'ingepland', beslist_door: k.naam, beslist_op: nu() }).eq('id', v.id).eq('status', 'voorstel').select('id')
  if (!claim?.length) throw new Error('Dit voorstel werd al behandeld.')
  let itemId: string | null = null
  if (v.vervangt_item_id) {
    const { data: oud } = await admin.from('ag_items').select('id').eq('id', v.vervangt_item_id).maybeSingle()
    if (oud) {
      await admin.from('ag_items').update({ titel: velden.titel, start_op: velden.start_op, eind_op: velden.eind_op, locatie: velden.locatie, meet_url: velden.meet_url, verwijderd_op: null, in_app_gewijzigd_op: nu(), updated_at: nu() }).eq('id', oud.id)
      itemId = oud.id
    }
  }
  if (!itemId) {
    const { data, error } = await admin.from('ag_items').insert({ ...velden, labels: velden.labels ?? [], eigenaar_id: k.persoonId, gemaakt_door: k.naam, in_app_gewijzigd_op: nu() }).select('id').single()
    if (error || !data) {
      await admin.from('ag_mail_voorstellen').update({ status: 'voorstel', beslist_door: null, beslist_op: null }).eq('id', v.id)
      throw new Error(error?.message ?? 'Inplannen mislukt')
    }
    itemId = data.id
    await zetToegewezen(admin, data.id, toegewezen ?? [k.persoonId])
  }
  await admin.from('ag_mail_voorstellen').update({ item_id: itemId }).eq('id', v.id)
  return { ok: true, id: itemId }
}

function deelnemersTekst(org: unknown, deelnemers: unknown): string | null {
  const o = org && typeof org === 'object' ? org as { naam?: string | null; email?: string | null } : null
  const d = Array.isArray(deelnemers) ? deelnemers as { naam?: string | null; email?: string }[] : []
  const regels: string[] = []
  if (o?.email || o?.naam) regels.push(`Organisator: ${[o.naam, o.email ? `<${o.email}>` : null].filter(Boolean).join(' ')}`)
  if (d.length) regels.push(`Deelnemers: ${d.map((x) => x.naam ? `${x.naam} <${x.email}>` : x.email).join(', ')}`)
  return regels.length ? regels.join('\n') : null
}

// ── Bijlagen bij een taak (pdf, xml, Word, Excel, foto's …) ─────────────────

const BIJLAGE_BUCKET = 'agenda'
const MAX_BIJLAGE = 50 * 1024 * 1024
// Geen programma's, scripts of webpagina's.
const VERBODEN = /\.(exe|msi|bat|cmd|com|scr|ps1|sh|js|mjs|vbs|jar|apk|dmg|app|html?|php|svgz)$/i
const veiligeNaam = (n: string) => n.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-120) || 'bestand'

async function bijlageActie(c: Ctx, actie: string, b: Record<string, unknown>) {
  const { admin, k } = c
  const z = await laadZicht(admin, k)
  if (actie === 'bijlage.upload') {
    const item = await zichtbaarItem(admin, z, b.item_id)
    const naam = typeof b.naam === 'string' ? b.naam.trim() : ''
    const grootte = Number(b.grootte)
    if (!naam) throw new Error('Geen bestandsnaam.')
    if (VERBODEN.test(naam)) throw new Error('Dit soort bestand kan niet als bijlage (geen programma\'s of webpagina\'s).')
    if (!Number.isFinite(grootte) || grootte <= 0) throw new Error('Leeg bestand.')
    if (grootte > MAX_BIJLAGE) throw new Error('Het bestand is groter dan 50 MB.')
    const pad = `taken/${item.id}/${crypto.randomUUID()}/${veiligeNaam(naam)}`
    const { data, error } = await admin.storage.from(BIJLAGE_BUCKET).createSignedUploadUrl(pad)
    if (error || !data?.token) throw new Error(error?.message ?? 'Uploadlink maken mislukt')
    return { ok: true, pad, token: data.token, bucket: BIJLAGE_BUCKET }
  }
  if (actie === 'bijlage.bewaar') {
    const item = await zichtbaarItem(admin, z, b.item_id)
    const pad = typeof b.pad === 'string' && b.pad.startsWith(`taken/${item.id}/`) && /^taken\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/]+$/i.test(b.pad) ? b.pad : null
    if (!pad) throw new Error('Laad het bestand eerst op.')
    // Staat het er echt? (de browser laadde rechtstreeks op)
    const map = pad.split('/').slice(0, 3).join('/')
    const { data: lijst } = await admin.storage.from(BIJLAGE_BUCKET).list(map, { limit: 5 })
    const bestand = (lijst ?? []).find((f) => `${map}/${f.name}` === pad)
    if (!bestand) throw new Error('Het bestand is niet (volledig) opgeladen. Probeer opnieuw.')
    const naam = typeof b.naam === 'string' && b.naam.trim() ? b.naam.trim().slice(0, 200) : pad.split('/').pop()!
    const { data, error } = await admin.from('ag_bijlagen').insert({
      item_id: item.id, pad, naam, type: typeof b.type === 'string' ? b.type.slice(0, 120) : null,
      grootte: Number((bestand.metadata as { size?: number } | null)?.size ?? b.grootte) || null, persoon_id: k.persoonId, geupload_door: k.naam,
    }).select('id').single()
    if (error) throw new Error(error.message)
    await admin.from('ag_items').update({ in_app_gewijzigd_op: nu(), updated_at: nu() }).eq('id', item.id)
    return { ok: true, id: data?.id }
  }
  if (actie === 'bijlage.verwijder') {
    if (!isUuid(b.id)) throw new Error('Onbekende bijlage')
    const { data: bl } = await admin.from('ag_bijlagen').select('id, item_id').eq('id', b.id).is('verwijderd_op', null).maybeSingle()
    if (!bl) throw new Error('Deze bijlage bestaat niet meer.')
    await zichtbaarItem(admin, z, bl.item_id)
    // Uit de taak, het bestand zelf blijft bewaard.
    await admin.from('ag_bijlagen').update({ verwijderd_op: nu(), verwijderd_door: k.naam }).eq('id', bl.id)
    return { ok: true }
  }
  throw new Error('Onbekende actie')
}

/**
 * Een ingesproken taak lezen: enkel een voorstel voor het formulier. Er wordt
 * niets bewaard; enkel de tekst, de namen van het team en de namen van de
 * lijsten die jij ziet gaan naar de AI.
 */
async function inspreekLees(c: Ctx, b: Record<string, unknown>) {
  const { admin, k } = c
  const zin = typeof b.tekst === 'string' ? b.tekst.trim().slice(0, 4000) : ''
  if (zin.length < 3) throw new Error('Spreek of typ eerst wat er moet gebeuren.')
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Het lezen van de tekst is niet beschikbaar. Vul het formulier zelf in.')
  const z = await laadZicht(admin, k)
  const personen = await laadPersonen(admin)
  const mapPer = new Map(z.mappen.map((m) => [m.id, m]))
  const spacePer = new Map(z.spaces.map((sp) => [sp.id, sp.naam]))
  const lijsten = z.lijsten.filter((l) => z.zichtbaar.lijsten.has(l.id)).slice(0, 400).map((l) => {
    const m = l.map_id ? mapPer.get(l.map_id) : null
    const ouder = m?.parent_id ? mapPer.get(m.parent_id)?.naam : null
    return { id: l.id, label: [spacePer.get(l.space_id ?? ''), ouder, m?.naam, l.naam].filter(Boolean).join(' › ') }
  })
  const ctx: InspreekContext = {
    vandaag: vandaag(),
    personen: personen.map((p) => ({ id: p.id, naam: p.naam, actief: p.actief, metAccount: !!p.user_id })),
    lijsten,
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6', max_tokens: 900, messages: [{ role: 'user', content: inspreekPrompt(zin, ctx, k.naam) }] }),
  }).catch(() => null)
  if (!res || !res.ok) throw new Error('De tekst kon nu niet gelezen worden. Probeer opnieuw of vul het formulier zelf in.')
  const json = await res.json().catch(() => null) as { content?: { text?: string }[] } | null
  const text = (json?.content ?? []).map((x) => x.text ?? '').join('')
  const a = text.indexOf('{'), e = text.lastIndexOf('}')
  let ruw: unknown = null
  try { ruw = a >= 0 && e > a ? JSON.parse(text.slice(a, e + 1)) : null } catch { ruw = null }
  const voorstel = leesInspreekVoorstel(ruw, ctx)
  if (!voorstel) throw new Error('Ik kon er geen taak uit halen. Zeg minstens wat er moet gebeuren.')
  return { voorstel }
}

/**
 * Een meeting uit de Meeting Inplanner afvinken in de agenda (of terug open).
 * Enkel een vinkje voor de agenda: de meeting zelf (Google, herinnering, mail)
 * verandert niet. Het dubbel in ClickUp volgt mee.
 */
async function meetingKlaar(c: Ctx, b: Record<string, unknown>) {
  const { admin, k } = c
  if (!(await magMeetings())) throw new Error('Je kan meetings niet aanpassen.')
  if (!isUuid(b.id)) throw new Error('Onbekende meeting')
  const klaar = b.klaar === true
  const { data: m } = await admin.from('klant_meetings').select('id, clickup_task_id').eq('id', b.id).maybeSingle()
  if (!m) throw new Error('Deze meeting bestaat niet meer.')
  const { error } = await admin.from('klant_meetings').update({ afgevinkt_op: klaar ? nu() : null, afgevinkt_door: klaar ? k.naam : null }).eq('id', m.id)
  if (error) throw new Error(error.message.includes('afgevinkt') ? 'Afvinken kan nog niet (de databank wordt bijgewerkt).' : error.message)
  if (m.clickup_task_id) {
    await admin.from('ag_items').update({ status: klaar ? 'klaar' : 'open', afgerond_op: klaar ? nu() : null, afgerond_door: klaar ? k.naam : null, in_app_gewijzigd_op: nu() }).eq('clickup_id', m.clickup_task_id)
  }
  return { ok: true }
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import type { Actie } from '@/lib/instellingen/model'
import { controleerItem, isUuid, isKleur, type Item } from '@/lib/agenda/model'
import {
  kijkerVan, laadZicht, boomVoor, metToegewezen, meetingsInBereik, itemsInBereik, itemZichtbaar, docZichtbaar, laadPersonen, laadLabels, alleRijen,
  ITEM_VELDEN, type Kijker, type Zicht, type RuwItem,
} from '@/lib/agenda/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Agenda (zie lib/agenda/server.ts voor wie wat ziet).
 * GET  ?boom=1                    boom, personen, labels, klanten, instellingen
 *      ?van=&tot=                 items en meetings in een periode
 *      ?container=lijst|map|space&id=  alle items van een lijst, map of space
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
    if (q.get('van') || q.get('tot')) return NextResponse.json(await bereik(admin, k, q.get('van'), q.get('tot')))
    if (q.get('container')) return NextResponse.json(await container(admin, k, q.get('container')!, q.get('id')))
    if (q.get('item')) return NextResponse.json(await eenItem(admin, k, q.get('item')!))
    if (q.get('klaar')) return NextResponse.json(await afgevinkt(admin, k, q.get('persoon'), q.get('na')))
    if (q.get('doc')) return NextResponse.json(await eenDoc(admin, k, q.get('doc')!))
    if (q.get('prullenbak')) return NextResponse.json(await prullenbak(admin, k))
    if (q.get('mail')) return NextResponse.json(await mailVoorstellen(admin, k))
    if (q.get('zoek') !== null) return NextResponse.json(await zoek(admin, k, q.get('zoek') ?? ''))
    return fout('Onbekende vraag')
  } catch (e) {
    return fout(e instanceof Error ? e.message : 'Er ging iets mis', 500)
  }
}

async function boom(c: Ctx) {
  const { admin, k } = c
  const z = await laadZicht(admin, k)
  const [b, personen, labels, klanten, kleuren, delen, bronnen, mail, rechten, rollen] = await Promise.all([
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
  ])
  const admins = new Set(((rollen.data ?? []) as { user_id: string }[]).map((r) => r.user_id))
  return {
    ik: k.persoonId, isAdmin: k.isAdmin, ...b, personen, labels,
    zaakvoerders: personen.filter((p) => p.user_id && admins.has(p.user_id)).map((p) => p.id),
    klanten: ((klanten.data ?? []) as { id: string; company_name: string | null; archived_at: string | null }[]).map((x) => ({ id: x.id, naam: x.company_name ?? 'Klant', gearchiveerd: !!x.archived_at })),
    klantKleuren: Object.fromEntries(((kleuren.data ?? []) as { client_id: string; kleur: string }[]).map((x) => [x.client_id, x.kleur])),
    deelIkMet: ((delen.data ?? []) as { eigenaar_id: string; kijker_id: string }[]).filter((d) => d.eigenaar_id === k.persoonId).map((d) => d.kijker_id),
    zieIkVan: ((delen.data ?? []) as { eigenaar_id: string; kijker_id: string }[]).filter((d) => d.kijker_id === k.persoonId).map((d) => d.eigenaar_id),
    // Nooit een token naar het scherm: enkel wie, welke fase en hoe ver.
    clickup: ((bronnen.data ?? []) as { id: string; sleutel: string; persoon_id: string | null; clickup_naam: string | null; actief: boolean; fase: string; volledig_op: string | null; laatste_sync_op: string | null; bezig_sinds: string | null; tellers: Record<string, number>; fout: string | null }[])
      .map((x) => ({ ...x, eigen: x.persoon_id === k.persoonId, gedeeld: x.sleutel === 'gedeeld' })),
    mailVoorstellen: mail.count ?? 0,
    meetings: await magMeetings(),
    rechten: Object.fromEntries(rechten),
  }
}

async function bereik(admin: Admin, k: Kijker, van: string | null, tot: string | null) {
  if (!isIso(van) || !isIso(tot) || Date.parse(tot) <= Date.parse(van) || Date.parse(tot) - Date.parse(van) > 70 * 86_400_000) throw new Error('Ongeldige periode')
  const [z, ruw, mt] = await Promise.all([
    laadZicht(admin, k),
    itemsInBereik(admin, van, tot),
    magMeetings().then(async (ja) => (ja ? meetingsInBereik(admin, van, tot, await emailNaarPersoon(admin)) : { items: [] as Item[], clickupIds: new Set<string>() })),
  ])
  // Een meeting uit de Meeting Inplanner staat ook in ClickUp: één keer tonen, die van de Meeting Inplanner.
  const items = await metToegewezen(admin, ruw.filter((r) => !r.clickup_id || !mt.clickupIds.has(r.clickup_id)), z, { subtaken: true })
  return { items: [...items, ...mt.items] }
}

async function container(admin: Admin, k: Kijker, soort: string, id: string | null) {
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
  const z = await laadZicht(admin, k)
  const { data } = await admin.from('ag_items').select(`${ITEM_VELDEN}, beschrijving, velden, gemaakt_door, created_at, in_app_gewijzigd_op`).eq('id', id).maybeSingle()
  if (!data) throw new Error('Dit item bestaat niet meer.')
  const [item] = await metToegewezen(admin, [data as unknown as RuwItem], z, { subtaken: true })
  if (!item) throw new Error('Je kan dit item niet zien.')
  const { data: subs } = await admin.from('ag_items').select(ITEM_VELDEN).eq('parent_id', id).is('verwijderd_op', null).order('created_at').limit(300)
  const subtaken = await metToegewezen(admin, (subs ?? []) as unknown as RuwItem[], z)
  let ouder: { id: string; titel: string } | null = null
  if (item.parent_id) {
    const { data: o } = await admin.from('ag_items').select(ITEM_VELDEN).eq('id', item.parent_id).maybeSingle()
    const [zo] = o ? await metToegewezen(admin, [o as unknown as RuwItem], z) : []
    if (zo) ouder = { id: zo.id, titel: zo.titel }
  }
  const extra = data as unknown as { gemaakt_door: string | null; created_at: string }
  return { item, subtaken, ouder, gemaakt_door: extra.gemaakt_door, gemaakt_op: extra.created_at }
}

async function afgevinkt(admin: Admin, k: Kijker, persoon: string | null, na: string | null) {
  const z = await laadZicht(admin, k)
  const uit: Item[] = []
  let cursor = isIso(na) ? new Date(na).toISOString() : null
  // Per 400 tot er 150 zichtbare zijn (de meeste mag je zien, dus meestal één ronde).
  for (let ronde = 0; ronde < 6 && uit.length < 150; ronde++) {
    let q = admin.from('ag_items').select(ITEM_VELDEN).is('verwijderd_op', null).eq('status', 'klaar').not('afgerond_op', 'is', null).order('afgerond_op', { ascending: false }).limit(400)
    if (cursor) q = q.lt('afgerond_op', cursor)
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
  const { data } = await admin.from('ag_docs').select('id, titel, inhoud, space_id, map_id, lijst_id, prive, eigenaar_id, clickup_parent_id, bijgewerkt_door, updated_at, created_at, verwijderd_op').eq('id', id).maybeSingle()
  if (!data || !docZichtbaar(data as never, z)) throw new Error('Dit document bestaat niet of je kan het niet zien.')
  return { doc: data }
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
    admin.from('ag_docs').select('id, titel, space_id, map_id, lijst_id, prive, eigenaar_id, clickup_parent_id, verwijderd_op, verwijderd_door').not('verwijderd_op', 'is', null).order('verwijderd_op', { ascending: false }).limit(300),
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
  'item.nieuw': 'toevoegen', 'item.wijzig': 'aanpassen', 'item.verwijder': 'verwijderen', 'item.herstel': 'verwijderen',
  'container.nieuw': 'toevoegen', 'container.wijzig': 'aanpassen', 'container.verwijder': 'verwijderen', 'container.herstel': 'verwijderen',
  'doc.nieuw': 'toevoegen', 'doc.wijzig': 'aanpassen', 'doc.verwijder': 'verwijderen', 'doc.herstel': 'verwijderen',
  'label.bewaar': 'instellingen', 'label.verwijder': 'instellingen', 'klantkleur': 'instellingen',
  'delen': 'bekijken', 'clickup.koppel': 'bekijken', 'clickup.ontkoppel': 'bekijken', 'clickup.nu': 'bekijken',
  'mail.plan': 'toevoegen', 'mail.negeer': 'bekijken', 'mail.terug': 'bekijken',
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
      const { data, error } = await admin.from('ag_items').insert({
        ...velden, eigenaar_id: k.persoonId, gemaakt_door: k.naam, in_app_gewijzigd_op: nu(),
        heel_dag: velden.heel_dag ?? false, labels: velden.labels ?? [],
      }).select('id').single()
      if (error || !data) throw new Error(error?.message ?? 'Bewaren mislukt')
      await zetToegewezen(admin, data.id, toegewezen ?? [k.persoonId])
      return { ok: true, id: data.id }
    }
    const bestaand = await zichtbaarItem(admin, z, b.id)
    // Wie het tegelijk aanpaste, wint niet stil: met `versie` (updated_at zoals gezien) controleren we.
    if (typeof b.versie === 'string' && bestaand.updated_at && Date.parse(b.versie) !== Date.parse(bestaand.updated_at)) throw new Error('Conflict: iemand anders paste dit item intussen aan. Herlaad en probeer opnieuw.')
    if ('status' in velden && velden.status === bestaand.status) { delete velden.afgerond_op; delete velden.afgerond_door }
    const { data: upd, error } = await admin.from('ag_items').update({ ...velden, in_app_gewijzigd_op: nu(), updated_at: nu() }).eq('id', bestaand.id).select('updated_at').single()
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
  const zetPrive = async (id: string, prive: boolean) => {
    await admin.from('ag_leden').delete().eq('soort', soort).eq('doel_id', id)
    if (prive) await admin.from('ag_leden').insert({ soort, doel_id: id, persoon_id: k.persoonId })
    await admin.from(TABEL[soort]).update({ prive }).eq('id', id)
  }
  if (actie === 'container.nieuw') {
    if (!naam) throw new Error('Geef een naam.')
    const rij: Record<string, unknown> = { naam, kleur: isKleur(b.kleur) ? b.kleur : null, volgorde: Date.now() / 1e10 + 1000 }
    if (soort !== 'space') {
      if (!isUuid(b.space_id) || !z.zichtbaar.spaces.has(b.space_id)) throw new Error('Kies een space.')
      rij.space_id = b.space_id
      if (soort === 'map' && isUuid(b.parent_id)) { if (!z.zichtbaar.mappen.has(b.parent_id)) throw new Error('Onbekende map.'); rij.parent_id = b.parent_id }
      if (soort === 'lijst' && isUuid(b.map_id)) { if (!z.zichtbaar.mappen.has(b.map_id)) throw new Error('Onbekende map.'); rij.map_id = b.map_id }
      if (isUuid(b.client_id)) rij.client_id = b.client_id
    }
    const { data, error } = await admin.from(TABEL[soort]).insert(rij).select('id').single()
    if (error || !data) throw new Error(error?.message ?? 'Bewaren mislukt')
    if (b.prive === true) await zetPrive(data.id, true)
    return { ok: true, id: data.id }
  }
  if (!isUuid(b.id) || !zicht.has(b.id)) throw new Error('Die bestaat niet of je kan ze niet zien.')
  const id = b.id
  if (actie === 'container.wijzig') {
    const upd: Record<string, unknown> = { updated_at: nu() }
    if ('naam' in b) { if (!naam) throw new Error('Geef een naam.'); upd.naam = naam }
    if ('kleur' in b) upd.kleur = isKleur(b.kleur) ? b.kleur : null
    if ('client_id' in b && soort !== 'space') upd.client_id = isUuid(b.client_id) ? b.client_id : null
    await admin.from(TABEL[soort]).update(upd).eq('id', id)
    if ('prive' in b) await zetPrive(id, b.prive === true)
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
    if (isUuid(b.lijst_id)) { if (!z.zichtbaar.lijsten.has(b.lijst_id)) throw new Error('Onbekende lijst.'); rij.lijst_id = b.lijst_id }
    else if (isUuid(b.map_id)) { if (!z.zichtbaar.mappen.has(b.map_id)) throw new Error('Onbekende map.'); rij.map_id = b.map_id }
    else if (isUuid(b.space_id)) { if (!z.zichtbaar.spaces.has(b.space_id)) throw new Error('Onbekende space.'); rij.space_id = b.space_id }
    const { data, error } = await admin.from('ag_docs').insert(rij).select('id, updated_at').single()
    if (error || !data) throw new Error(error?.message ?? 'Bewaren mislukt')
    return { ok: true, id: data.id, versie: data.updated_at }
  }
  if (!isUuid(b.id)) throw new Error('Onbekend document')
  const { data: d } = await admin.from('ag_docs').select('id, space_id, map_id, lijst_id, prive, eigenaar_id, clickup_parent_id, updated_at, verwijderd_op').eq('id', b.id).maybeSingle()
  if (!d || !docZichtbaar(d as never, z)) throw new Error('Dit document bestaat niet of je kan het niet zien.')
  if (actie === 'doc.wijzig') {
    if (typeof b.versie === 'string' && Date.parse(b.versie) !== Date.parse(d.updated_at)) throw new Error('Conflict: iemand anders paste dit document intussen aan. Herlaad om de laatste versie te zien.')
    const upd: Record<string, unknown> = { updated_at: nu(), in_app_gewijzigd_op: nu(), bijgewerkt_door: k.naam }
    if (typeof b.titel === 'string') upd.titel = b.titel.trim().slice(0, 300) || 'Naamloos document'
    if (typeof b.inhoud === 'string') upd.inhoud = b.inhoud.slice(0, 500_000)
    if ('prive' in b && d.eigenaar_id === k.persoonId) upd.prive = b.prive === true
    const { data, error } = await admin.from('ag_docs').update(upd).eq('id', d.id).select('updated_at').single()
    if (error) throw new Error(error.message)
    return { ok: true, versie: data?.updated_at }
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

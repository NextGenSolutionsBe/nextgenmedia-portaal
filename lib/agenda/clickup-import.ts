import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchMetLimiet, TijdslimietFout } from '@/lib/fetch-met-limiet'
import { itemUitClickup, magOverschrijven, clickupVerschil, naamSleutel, isKleur, type ClickupTaak, type ClickupVerschil } from '@/lib/agenda/model'
import { zorgVoorPersonen, persoonVoorClickup } from '@/lib/agenda/personen-server'
import { stelLabelVoor, labelInvoerVoor, klantNamenVoorLabels, type LabelContext } from '@/lib/agenda/label-voorstel'

type Admin = SupabaseClient

/**
 * ClickUp → agenda. Neemt alles over zoals het in ClickUp staat: spaces, mappen,
 * lijsten (met wie er toegang heeft), taken met subtaken, toegewezenen, tags
 * (labels), prioriteit, status, datums, velden en checklists, en de docs.
 *
 * Per bron (een ClickUp-account): het gedeelde account uit de omgeving
 * (CLICKUP_API_KEY) en de persoonlijke tokens die iemand in de agenda koppelt,
 * zodat ook ieders privélijsten meekomen. Alles is idempotent op het ClickUp-id.
 *
 * Fases: structuur → taken (per pagina van 100) → ouders koppelen → docs →
 * sync. Daarna haalt elke ronde enkel nog wat in ClickUp veranderde, en om de
 * 6 uur de structuur en de docs opnieuw. Wat in de app aangepast werd, blijft
 * staan tot het in ClickUp opnieuw verandert (`magOverschrijven`).
 */

const V2 = 'https://api.clickup.com/api/v2'
const V3 = 'https://api.clickup.com/api/v3'
const PAUZE_MS = 650 // ± 90 vragen per minuut, onder de limiet van ClickUp (100)
const STRUCTUUR_OPNIEUW_MS = 6 * 3600_000

export type Bron = {
  id: string; sleutel: string; token: string | null; persoon_id: string | null
  clickup_user_id: number | null; clickup_naam: string | null; actief: boolean
  fase: string; cursor: Record<string, unknown>; volledig_op: string | null; laatste_sync_op: string | null
  bezig_sinds: string | null; tellers: Record<string, number>; fout: string | null
}

class ClickupFout extends Error { constructor(msg: string, public status: number) { super(msg) } }

class Cu {
  private laatste = 0
  constructor(private token: string) {}
  async get<T>(url: string, poging = 0): Promise<T> {
    const wacht = this.laatste + PAUZE_MS - Date.now()
    if (wacht > 0) await new Promise((r) => setTimeout(r, wacht))
    this.laatste = Date.now()
    let res: Response
    try {
      res = await fetchMetLimiet(url, { headers: { Authorization: this.token, 'Content-Type': 'application/json' }, cache: 'no-store' }, 20_000)
    } catch (e) {
      if (e instanceof TijdslimietFout && poging < 2) return this.get(url, poging + 1)
      throw e
    }
    if (res.status === 429 && poging < 4) {
      const na = Number(res.headers.get('retry-after') ?? 0)
      await new Promise((r) => setTimeout(r, na > 0 ? na * 1000 : 15_000))
      return this.get(url, poging + 1)
    }
    if (res.status >= 500 && poging < 2) { await new Promise((r) => setTimeout(r, 1500)); return this.get(url, poging + 1) }
    const tekst = await res.text()
    if (!res.ok) throw new ClickupFout(`ClickUp ${res.status} op ${new URL(url).pathname}: ${tekst.slice(0, 160)}`, res.status)
    return (tekst ? JSON.parse(tekst) : {}) as T
  }
}

const tokenVan = (b: Bron) => b.token ?? (b.sleutel === 'gedeeld' ? process.env.CLICKUP_API_KEY ?? null : null)

/** Het gedeelde account (omgeving) als bron, als dat er nog niet is. */
async function zorgVoorGedeeldeBron(admin: Admin): Promise<void> {
  if (!process.env.CLICKUP_API_KEY) return
  await admin.from('ag_clickup_bronnen').upsert({ sleutel: 'gedeeld' }, { onConflict: 'sleutel', ignoreDuplicates: true })
}

// ── Structuur ───────────────────────────────────────────────────────────────

type CuLid = { id: number; username?: string; email?: string; role?: number }
type CuSpace = { id: string; name: string; color?: string | null; private?: boolean; members?: { user: CuLid }[] }
type CuLijst = { id: string; name: string; orderindex?: number; statuses?: { status: string; color: string; type: string; orderindex?: number }[]; folder?: { id: string } }
type CuMap = { id: string; name: string; orderindex?: number; lists?: CuLijst[] }

async function structuur(admin: Admin, cu: Cu, bron: Bron, deadline: number, tellers: Record<string, number>): Promise<{ klaar: boolean; team: string }> {
  const cursor = { ...(bron.cursor ?? {}) } as { team?: string; ledenIndex?: number; lijstIds?: string[] }
  const personen = await zorgVoorPersonen(admin)
  const cache = new Map<number, string>()

  // Wie is deze bron, en welke werkruimte.
  if (!bron.clickup_user_id) {
    const u = await cu.get<{ user?: { id: number; username?: string; email?: string } }>(`${V2}/user`)
    if (u.user) {
      const pid = await persoonVoorClickup(admin, u.user, cache, personen)
      await admin.from('ag_clickup_bronnen').update({ clickup_user_id: u.user.id, clickup_naam: u.user.username ?? u.user.email ?? null, persoon_id: bron.persoon_id ?? pid }).eq('id', bron.id)
      bron.clickup_user_id = u.user.id
    }
  }
  const { teams } = await cu.get<{ teams: { id: string; members?: { user: CuLid }[] }[] }>(`${V2}/team`)
  const team = teams?.[0]
  if (!team) throw new Error('Geen ClickUp-werkruimte voor dit account.')
  const leden = (team.members ?? []).map((m) => m.user).filter((u) => u && u.id)
  for (const l of leden) await persoonVoorClickup(admin, l, cache, personen)
  const volwaardig = leden.filter((l) => l.role !== 4).map((l) => l.id) // 4 = gast

  // Klanten om mappen te koppelen (mapnaam = klantnaam).
  const { data: klanten } = await admin.from('clients').select('id, company_name').limit(5000)
  const klantVan = new Map<string, string>()
  for (const k of (klanten ?? []) as { id: string; company_name: string | null }[]) if (k.company_name) klantVan.set(naamSleutel(k.company_name), k.id)

  // Wat in de app vastgezet werd (privé of verplaatst), laat de import staan.
  const vast = await vastgezet(admin)

  // Lijsten-met-leden worden over meerdere rondes nagekeken; de structuur zelf telkens volledig.
  if (cursor.ledenIndex === undefined) {
    const { spaces } = await cu.get<{ spaces: CuSpace[] }>(`${V2}/team/${team.id}/space?archived=false`)
    const lijstIds: string[] = []
    for (const [si, s] of (spaces ?? []).entries()) {
      const spVast = vast.spaces.has(s.id)
      const { data: sp } = await admin.from('ag_spaces').upsert({ clickup_id: s.id, naam: s.name, kleur: isKleur(s.color) ? s.color : null, ...(spVast ? {} : { prive: !!s.private }), volgorde: si, updated_at: new Date().toISOString() }, { onConflict: 'clickup_id' }).select('id').single()
      if (!sp) continue
      tellers.spaces = (tellers.spaces ?? 0) + 1
      if (s.private && !spVast) {
        const ids: string[] = []
        for (const m of s.members ?? []) { const p = await persoonVoorClickup(admin, m.user, cache, personen); if (p) ids.push(p) }
        await zetLeden(admin, 'space', sp.id, ids)
      }
      const [{ folders }, { lists: los }] = await Promise.all([
        cu.get<{ folders: CuMap[] }>(`${V2}/space/${s.id}/folder?archived=false`),
        cu.get<{ lists: CuLijst[] }>(`${V2}/space/${s.id}/list?archived=false`),
      ])
      for (const [fi, f] of (folders ?? []).entries()) {
        const { data: mp } = await admin.from('ag_mappen').upsert({ clickup_id: f.id, ...(vast.mapPlaats.has(f.id) ? {} : { space_id: sp.id }), naam: f.name, volgorde: f.orderindex ?? fi, client_id: klantVan.get(naamSleutel(f.name)) ?? null, updated_at: new Date().toISOString() }, { onConflict: 'clickup_id' }).select('id').single()
        if (!mp) continue
        tellers.mappen = (tellers.mappen ?? 0) + 1
        for (const [li, l] of (f.lists ?? []).entries()) {
          await bewaarLijst(admin, l, sp.id, mp.id, li, vast.lijstPlaats.has(l.id))
          lijstIds.push(l.id)
          tellers.lijsten = (tellers.lijsten ?? 0) + 1
        }
      }
      for (const [li, l] of (los ?? []).entries()) {
        await bewaarLijst(admin, l, sp.id, null, 1000 + li, vast.lijstPlaats.has(l.id))
        lijstIds.push(l.id)
        tellers.lijsten = (tellers.lijsten ?? 0) + 1
      }
    }
    cursor.team = team.id
    cursor.lijstIds = lijstIds
    cursor.ledenIndex = 0
    await admin.from('ag_clickup_bronnen').update({ cursor }).eq('id', bron.id)
  }

  // Wie heeft toegang tot elke lijst? Minder dan alle volwaardige leden = privé (bv. "Marco Privé").
  const lijstIds = cursor.lijstIds ?? []
  while ((cursor.ledenIndex ?? 0) < lijstIds.length) {
    if (Date.now() > deadline) { await admin.from('ag_clickup_bronnen').update({ cursor }).eq('id', bron.id); return { klaar: false, team: team.id } }
    const cid = lijstIds[cursor.ledenIndex!]
    try {
      const { data: lijst } = await admin.from('ag_lijsten').select('id, map_id, leden_vast').eq('clickup_id', cid).maybeSingle()
      // Vastgezet in de app: niet aankomen. In een vastgezette privémap: dezelfde mensen als de map.
      if (lijst?.leden_vast) { cursor.ledenIndex = (cursor.ledenIndex ?? 0) + 1; continue }
      if (lijst?.map_id && vast.mapLeden.has(lijst.map_id)) {
        const mapLeden = vast.mapLeden.get(lijst.map_id)!
        await admin.from('ag_lijsten').update({ prive: true, leden_vast: true }).eq('id', lijst.id)
        await zetLeden(admin, 'lijst', lijst.id, mapLeden)
        cursor.ledenIndex = (cursor.ledenIndex ?? 0) + 1
        continue
      }
      const { members } = await cu.get<{ members: CuLid[] }>(`${V2}/list/${cid}/member`)
      const metToegang = (members ?? []).filter((m) => volwaardig.includes(m.id))
      const prive = metToegang.length > 0 && metToegang.length < volwaardig.length
      if (lijst) {
        await admin.from('ag_lijsten').update({ prive }).eq('id', lijst.id)
        const ids: string[] = []
        if (prive) for (const m of metToegang) { const p = await persoonVoorClickup(admin, m, cache, personen); if (p) ids.push(p) }
        await zetLeden(admin, 'lijst', lijst.id, ids)
      }
    } catch (e) { if (!(e instanceof ClickupFout && e.status === 404)) throw e }
    cursor.ledenIndex = (cursor.ledenIndex ?? 0) + 1
  }
  // Een map waarvan alle lijsten privé zijn, is privé voor wie in die lijsten mag.
  await mappenPriveUitLijsten(admin)
  return { klaar: true, team: team.id }
}

/**
 * Wat de import niet mag aanraken: privé en wie toegang heeft (`leden_vast`,
 * bv. de privémappen van Bram en Chiara of iets dat in de app privé gezet
 * werd) en de plaats (`plaats_vast`, in de app verplaatst).
 */
async function vastgezet(admin: Admin) {
  const [sp, mp, lj, ld] = await Promise.all([
    admin.from('ag_spaces').select('clickup_id').eq('leden_vast', true).not('clickup_id', 'is', null),
    admin.from('ag_mappen').select('id, clickup_id, leden_vast, plaats_vast, prive').or('leden_vast.eq.true,plaats_vast.eq.true'),
    admin.from('ag_lijsten').select('clickup_id').eq('plaats_vast', true).not('clickup_id', 'is', null),
    admin.from('ag_leden').select('doel_id, persoon_id').eq('soort', 'map'),
  ])
  const mappen = (mp.data ?? []) as { id: string; clickup_id: string | null; leden_vast: boolean; plaats_vast: boolean; prive: boolean }[]
  const leden = new Map<string, string[]>()
  for (const r of (ld.data ?? []) as { doel_id: string; persoon_id: string }[]) leden.set(r.doel_id, [...(leden.get(r.doel_id) ?? []), r.persoon_id])
  return {
    spaces: new Set(((sp.data ?? []) as { clickup_id: string }[]).map((x) => x.clickup_id)),
    mapPlaats: new Set(mappen.filter((m) => m.plaats_vast && m.clickup_id).map((m) => m.clickup_id!)),
    lijstPlaats: new Set(((lj.data ?? []) as { clickup_id: string }[]).map((x) => x.clickup_id)),
    // Vastgezette privémappen met hun mensen: lijsten erin volgen die.
    mapLeden: new Map(mappen.filter((m) => m.leden_vast && m.prive && (leden.get(m.id)?.length ?? 0) > 0).map((m) => [m.id, leden.get(m.id)!])),
  }
}

async function bewaarLijst(admin: Admin, l: CuLijst, spaceId: string, mapId: string | null, volgorde: number, plaatsVast = false) {
  const statussen = (l.statuses ?? []).map((s) => ({ status: s.status, kleur: s.color, type: s.type }))
  await admin.from('ag_lijsten').upsert({
    clickup_id: l.id, ...(plaatsVast ? {} : { space_id: spaceId, map_id: mapId }), naam: l.name, volgorde: l.orderindex ?? volgorde,
    ...(statussen.length ? { statussen } : {}), updated_at: new Date().toISOString(),
  }, { onConflict: 'clickup_id' })
}

async function zetLeden(admin: Admin, soort: 'space' | 'map' | 'lijst', doel: string, personen: string[]) {
  await admin.from('ag_leden').delete().eq('soort', soort).eq('doel_id', doel)
  if (personen.length) await admin.from('ag_leden').insert([...new Set(personen)].map((p) => ({ soort, doel_id: doel, persoon_id: p })))
}

async function mappenPriveUitLijsten(admin: Admin) {
  const [{ data: mappen }, { data: lijsten }, { data: leden }] = await Promise.all([
    admin.from('ag_mappen').select('id, prive').not('clickup_id', 'is', null).eq('leden_vast', false),
    admin.from('ag_lijsten').select('id, map_id, prive').not('map_id', 'is', null),
    admin.from('ag_leden').select('doel_id, persoon_id').eq('soort', 'lijst'),
  ])
  const perMap = new Map<string, { prive: boolean; id: string }[]>()
  for (const l of (lijsten ?? []) as { id: string; map_id: string; prive: boolean }[]) perMap.set(l.map_id, [...(perMap.get(l.map_id) ?? []), l])
  const ledenVan = new Map<string, string[]>()
  for (const x of (leden ?? []) as { doel_id: string; persoon_id: string }[]) ledenVan.set(x.doel_id, [...(ledenVan.get(x.doel_id) ?? []), x.persoon_id])
  for (const m of (mappen ?? []) as { id: string; prive: boolean }[]) {
    const ls = perMap.get(m.id) ?? []
    const prive = ls.length > 0 && ls.every((l) => l.prive)
    if (prive !== m.prive) await admin.from('ag_mappen').update({ prive }).eq('id', m.id)
    await zetLeden(admin, 'map', m.id, prive ? [...new Set(ls.flatMap((l) => ledenVan.get(l.id) ?? []))] : [])
  }
}

// ── Taken ───────────────────────────────────────────────────────────────────

type LijstRij = { id: string; clickup_id: string | null; naam: string; map_id: string | null; client_id: string | null; space_id: string; prive: boolean; leden_vast: boolean }
type Ctx = {
  lijsten: Map<string, string>; labels: Map<string, string>; personen: Awaited<ReturnType<typeof zorgVoorPersonen>>; cache: Map<number, string>
  /** Lijsten die vergrendeld privé zijn: taken erin krijgen het slotje. */
  slot: Set<string>
  /** Onze categorielabels (blijven staan als ClickUp de tags verandert). */
  categorie: Set<string>
  labelBoom: { lijsten: LijstRij[]; mappen: { id: string; naam: string; client_id: string | null }[]; spaces: { id: string; naam: string }[] }
  labelCtx: LabelContext
}

async function laadCtx(admin: Admin): Promise<Ctx> {
  const [{ data: lijsten }, { data: labels }, personen, { data: mappen }, { data: spaces }, { data: klanten }] = await Promise.all([
    admin.from('ag_lijsten').select('id, clickup_id, naam, map_id, client_id, space_id, prive, leden_vast'),
    admin.from('ag_labels').select('id, naam, categorie'),
    zorgVoorPersonen(admin),
    admin.from('ag_mappen').select('id, naam, client_id'),
    admin.from('ag_spaces').select('id, naam'),
    admin.from('clients').select('company_name').is('archived_at', null).limit(3000),
  ])
  const ls = (lijsten ?? []) as LijstRij[]
  const lb = (labels ?? []) as { id: string; naam: string; categorie: boolean }[]
  return {
    lijsten: new Map(ls.filter((l) => l.clickup_id).map((l) => [l.clickup_id!, l.id])),
    labels: new Map(lb.map((l) => [l.naam.toLowerCase(), l.id])),
    personen, cache: new Map(),
    slot: new Set(ls.filter((l) => l.leden_vast && l.prive).map((l) => l.id)),
    categorie: new Set(lb.filter((l) => l.categorie).map((l) => l.id)),
    labelBoom: { lijsten: ls, mappen: (mappen ?? []) as { id: string; naam: string; client_id: string | null }[], spaces: (spaces ?? []) as { id: string; naam: string }[] },
    labelCtx: {
      klanten: klantNamenVoorLabels(((klanten ?? []) as { company_name: string | null }[]).map((k) => k.company_name)),
      team: [...new Set(personen.filter((p) => p.actief).map((p) => p.naam.split(' ')[0]).filter((n) => n.length >= 3))],
    },
  }
}

async function labelId(admin: Admin, ctx: Ctx, naam: string, kleur?: string): Promise<string | null> {
  const k = naam.trim().toLowerCase()
  if (!k) return null
  if (ctx.labels.has(k)) return ctx.labels.get(k)!
  const { data } = await admin.from('ag_labels').insert({ naam: naam.trim().slice(0, 60), kleur: isKleur(kleur) ? kleur : '#6e6e6e', volgorde: 100 + ctx.labels.size }).select('id').single()
  const id = data?.id ?? (await admin.from('ag_labels').select('id').ilike('naam', naam.trim()).maybeSingle()).data?.id ?? null
  if (id) ctx.labels.set(k, id)
  return id
}

/** Eén pagina taken bewaren. Geeft het aantal bewaarde (nieuw of bijgewerkt). */
async function bewaarTaken(admin: Admin, taken: ClickupTaak[], ctx: Ctx): Promise<number> {
  if (!taken.length) return 0
  type Bestaand = { id: string; clickup_id: string; clickup_bijgewerkt_op: string | null; in_app_gewijzigd_op: string | null; labels: string[] | null; titel: string; status: string; start_op: string | null; eind_op: string | null; deadline_op: string | null; clickup_verschil?: { bijgewerkt?: string } | null }
  const ids0 = taken.map((t) => t.id)
  const r0 = await admin.from('ag_items').select('id, clickup_id, clickup_bijgewerkt_op, in_app_gewijzigd_op, labels, titel, status, start_op, eind_op, deadline_op, clickup_verschil').in('clickup_id', ids0)
  // Vóór de migratie van fase 3: zonder clickup_verschil.
  const bestaand: unknown[] | null = r0.error ? (await admin.from('ag_items').select('id, clickup_id, clickup_bijgewerkt_op, in_app_gewijzigd_op, labels, titel, status, start_op, eind_op, deadline_op').in('clickup_id', ids0)).data : r0.data
  const per = new Map(((bestaand ?? []) as Bestaand[]).map((b) => [b.clickup_id, b]))
  const verschillen: { id: string; v: ClickupVerschil }[] = []
  const rijen: Record<string, unknown>[] = []
  const toegewezenVan = new Map<string, string[]>()
  for (const t of taken) {
    if (t.archived) continue
    const v = itemUitClickup(t)
    if (!magOverschrijven(per.get(t.id) ?? null, v.clickup_bijgewerkt_op)) {
      // In de app aangepast terwijl ClickUp iets anders zegt: op de lijst "Verschillen met ClickUp".
      const b = per.get(t.id) ?? null
      const vs = clickupVerschil(b, v as Parameters<typeof clickupVerschil>[1])
      if (b && vs) verschillen.push({ id: b.id, v: vs })
      continue
    }
    const labels: string[] = []
    for (const tag of t.tags ?? []) { const id = await labelId(admin, ctx, tag.name, tag.tag_bg); if (id) labels.push(id) }
    const eigenaar = t.creator?.id ? await persoonVoorClickup(admin, { id: t.creator.id, username: t.creator.username, email: t.creator.email }, ctx.cache, ctx.personen) : null
    const pers: string[] = []
    for (const a of t.assignees ?? []) { const p = await persoonVoorClickup(admin, a, ctx.cache, ctx.personen); if (p) pers.push(p) }
    toegewezenVan.set(t.id, pers)
    const lijstId = t.list?.id ? ctx.lijsten.get(t.list.id) ?? null : null
    const al = per.get(t.id)
    // Onze categorielabels blijven staan; een nieuwe taak krijgt er meteen een (voorstel uit de titel).
    for (const l of al?.labels ?? []) if (ctx.categorie.has(l) && !labels.includes(l)) labels.push(l)
    if (!al && !labels.some((l) => ctx.categorie.has(l))) {
      const naam = stelLabelVoor(labelInvoerVoor({ titel: v.titel, soort: v.soort, lijst_id: lijstId }, ctx.labelBoom), ctx.labelCtx)
      const id = ctx.labels.get(naam.toLowerCase())
      if (id && ctx.categorie.has(id)) labels.push(id)
    }
    rijen.push({
      clickup_id: t.id, ...v, labels, eigenaar_id: eigenaar, gemaakt_door: t.creator?.username ?? null,
      clickup_lijst_id: t.list?.id ?? null, lijst_id: lijstId,
      clickup_parent_id: t.parent ?? null,
      // Elke rij dezelfde kolommen (een bulk-upsert zet ontbrekende op null): de aanmaakdatum uit ClickUp.
      created_at: t.date_created ? new Date(Number(t.date_created)).toISOString() : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }
  for (const x of verschillen) await admin.from('ag_items').update({ clickup_verschil_op: new Date().toISOString(), clickup_verschil: x.v }).eq('id', x.id).then(() => undefined, () => undefined)
  if (!rijen.length) return 0
  const { data: opgeslagen, error } = await admin.from('ag_items').upsert(rijen, { onConflict: 'clickup_id' }).select('id, clickup_id')
  if (error) throw new Error(error.message)
  const ids = (opgeslagen ?? []) as { id: string; clickup_id: string }[]
  // Nieuwer in ClickUp: de tekst uit ClickUp geldt, een opmaak uit de app valt weg (vóór de migratie: niets te doen).
  if (ids.length) await admin.from('ag_items').update({ beschrijving_json: null }).in('id', ids.map((x) => x.id)).not('beschrijving_json', 'is', null).then(() => undefined, () => undefined)
  // Taken in een vergrendelde privélijst (bv. Bram Privé) krijgen het slotje.
  const slotIds = rijen.filter((r) => r.lijst_id && ctx.slot.has(r.lijst_id as string)).map((r) => ids.find((x) => x.clickup_id === r.clickup_id)?.id).filter((x): x is string => !!x)
  if (slotIds.length) await admin.from('ag_items').update({ prive: true }).in('id', slotIds).eq('prive', false)
  if (ids.length) {
    await admin.from('ag_toegewezen').delete().in('item_id', ids.map((x) => x.id))
    const tw = ids.flatMap((x) => [...new Set(toegewezenVan.get(x.clickup_id) ?? [])].map((p) => ({ item_id: x.id, persoon_id: p })))
    if (tw.length) await admin.from('ag_toegewezen').insert(tw)
  }
  return ids.length
}

async function takenPaginas(admin: Admin, cu: Cu, team: string, bron: Bron, deadline: number, tellers: Record<string, number>, sinds: number | null): Promise<{ klaar: boolean }> {
  const cursor = { ...(bron.cursor ?? {}) } as Record<string, unknown>
  let page = Number(cursor.pagina ?? 0)
  const ctx = await laadCtx(admin)
  for (; page < 400; page++) {
    if (Date.now() > deadline) { cursor.pagina = page; await admin.from('ag_clickup_bronnen').update({ cursor }).eq('id', bron.id); return { klaar: false } }
    const p = new URLSearchParams({ page: String(page), include_closed: 'true', subtasks: 'true', include_markdown_description: 'true', order_by: 'created', reverse: 'true' })
    if (sinds) p.set('date_updated_gt', String(sinds))
    const { tasks } = await cu.get<{ tasks: ClickupTaak[] }>(`${V2}/team/${team}/task?${p}`)
    const lijst = tasks ?? []
    tellers.gelezen = (tellers.gelezen ?? 0) + lijst.length
    tellers.bewaard = (tellers.bewaard ?? 0) + await bewaarTaken(admin, lijst, ctx)
    if (!lijst.length) break
  }
  delete cursor.pagina
  await admin.from('ag_clickup_bronnen').update({ cursor }).eq('id', bron.id)
  return { klaar: true }
}

// ── Docs ────────────────────────────────────────────────────────────────────

type CuDoc = { id: string; name: string; parent?: { id: string; type: number }; date_updated?: number | string; deleted?: boolean; archived?: boolean; creator?: number }
type CuPagina = { id: string; name?: string; content?: string; pages?: CuPagina[] }
const PARENT: Record<number, string> = { 4: 'space', 5: 'map', 6: 'lijst' }

function paginasNaarTekst(pag: CuPagina[], titel: string, diepte = 1): string {
  const delen: string[] = []
  for (const p of pag) {
    const kop = p.name && !(pag.length === 1 && diepte === 1 && p.name.trim() === titel.trim()) ? `${'#'.repeat(Math.min(3, diepte))} ${p.name.trim()}\n\n` : ''
    delen.push(`${kop}${(p.content ?? '').trim()}`)
    if (p.pages?.length) delen.push(paginasNaarTekst(p.pages, titel, diepte + 1))
  }
  return delen.filter(Boolean).join('\n\n')
}

async function docs(admin: Admin, cu: Cu, team: string, bron: Bron, deadline: number, tellers: Record<string, number>, sinds: number | null): Promise<{ klaar: boolean }> {
  const cursor = { ...(bron.cursor ?? {}) } as Record<string, unknown>
  let volgende = (cursor.docsCursor as string | undefined) ?? undefined
  // De maker wordt de eigenaar: een doc in een map die we niet kennen, ziet enkel hij of zij.
  const { data: pers } = await admin.from('ag_personen').select('id, clickup_id').not('clickup_id', 'is', null)
  const persoonVan = new Map(((pers ?? []) as { id: string; clickup_id: number }[]).map((p) => [Number(p.clickup_id), p.id]))
  for (let ronde = 0; ronde < 50; ronde++) {
    if (Date.now() > deadline) { cursor.docsCursor = volgende; await admin.from('ag_clickup_bronnen').update({ cursor }).eq('id', bron.id); return { klaar: false } }
    const p = new URLSearchParams({ limit: '50', deleted: 'false', archived: 'false' })
    if (volgende) p.set('cursor', volgende)
    let res: { docs?: CuDoc[]; next_cursor?: string | null }
    try { res = await cu.get(`${V3}/workspaces/${team}/docs?${p}`) } catch (e) { if (e instanceof ClickupFout && (e.status === 403 || e.status === 404)) return { klaar: true }; throw e }
    for (const d of res.docs ?? []) {
      if (Date.now() > deadline) { cursor.docsCursor = volgende; await admin.from('ag_clickup_bronnen').update({ cursor }).eq('id', bron.id); return { klaar: false } }
      if (d.deleted || d.archived) continue
      const bijgewerkt = d.date_updated ? new Date(Number(d.date_updated)).toISOString() : null
      if (sinds && bijgewerkt && Date.parse(bijgewerkt) <= sinds) continue
      const eigenaar = d.creator ? persoonVan.get(Number(d.creator)) ?? null : null
      const { data: al } = await admin.from('ag_docs').select('id, eigenaar_id, clickup_bijgewerkt_op, in_app_gewijzigd_op').eq('clickup_id', d.id).maybeSingle()
      if (al && !magOverschrijven(al as { clickup_bijgewerkt_op: string | null; in_app_gewijzigd_op: string | null }, bijgewerkt)) {
        if (!al.eigenaar_id && eigenaar) await admin.from('ag_docs').update({ eigenaar_id: eigenaar }).eq('id', al.id)
        continue
      }
      let inhoud = ''
      try {
        const pag = await cu.get<CuPagina[] | { pages?: CuPagina[] }>(`${V3}/workspaces/${team}/docs/${d.id}/pages?max_page_depth=-1&content_format=text%2Fmd`)
        inhoud = paginasNaarTekst(Array.isArray(pag) ? pag : pag.pages ?? [], d.name)
      } catch (e) { if (!(e instanceof ClickupFout && (e.status === 403 || e.status === 404))) throw e }
      const type = d.parent ? PARENT[Number(d.parent.type)] ?? null : null
      await admin.from('ag_docs').upsert({
        // Nieuwer in ClickUp: de tekst uit ClickUp geldt, de opmaak uit de app wordt opnieuw opgebouwd uit die tekst.
        clickup_id: d.id, titel: (d.name || 'Naamloos document').slice(0, 300), inhoud, inhoud_json: null,
        clickup_parent_id: type ? d.parent!.id : null, clickup_parent_type: type, clickup_bijgewerkt_op: bijgewerkt, eigenaar_id: eigenaar,
        ...(al ? {} : { space_id: null, map_id: null, lijst_id: null }), updated_at: new Date().toISOString(),
      }, { onConflict: 'clickup_id' })
      tellers.docs = (tellers.docs ?? 0) + 1
    }
    volgende = res.next_cursor ?? undefined
    if (!volgende) break
  }
  delete cursor.docsCursor
  await admin.from('ag_clickup_bronnen').update({ cursor }).eq('id', bron.id)
  return { klaar: true }
}

// ── Rondes ──────────────────────────────────────────────────────────────────

export type ImportUitkomst = { bron: string; fase: string; klaar: boolean; tellers: Record<string, number>; fout: string | null }

/** Eén bron zover mogelijk binnen de tijd. */
export async function importeerBron(admin: Admin, bron: Bron, deadline: number): Promise<ImportUitkomst> {
  const token = tokenVan(bron)
  const tellers: Record<string, number> = {}
  if (!token) return { bron: bron.sleutel, fase: bron.fase, klaar: false, tellers, fout: 'Geen ClickUp-token.' }
  const cu = new Cu(token)
  const start = new Date().toISOString()
  await admin.from('ag_clickup_bronnen').update({ bezig_sinds: start, fout: null }).eq('id', bron.id)
  let fase = bron.fase
  let fout: string | null = null
  try {
    for (let stap = 0; stap < 8 && Date.now() < deadline; stap++) {
      const team = String((bron.cursor as { team?: string }).team ?? '')
      if (fase === 'structuur') {
        const r = await structuur(admin, cu, bron, deadline, tellers)
        if (!r.klaar) break
        bron.cursor = { team: r.team }
        fase = bron.volledig_op ? 'sync' : 'taken'
        await admin.from('ag_clickup_bronnen').update({ fase, cursor: bron.cursor, ...(bron.volledig_op ? { tellers: { ...bron.tellers, structuur_op: Date.now() } } : {}) }).eq('id', bron.id)
        if (bron.volledig_op) bron.tellers = { ...bron.tellers, structuur_op: Date.now() }
        continue
      }
      if (fase === 'taken') {
        const r = await takenPaginas(admin, cu, team, bron, deadline, tellers, null)
        if (!r.klaar) break
        fase = 'docs'; bron.cursor = { team }
        await admin.rpc('ag_koppel_ouders')
        await admin.from('ag_clickup_bronnen').update({ fase, cursor: bron.cursor }).eq('id', bron.id)
        continue
      }
      if (fase === 'docs') {
        const r = await docs(admin, cu, team, bron, deadline, tellers, null)
        if (!r.klaar) break
        await admin.rpc('ag_koppel_ouders')
        fase = 'sync'
        bron.volledig_op = new Date().toISOString()
        bron.laatste_sync_op = start
        bron.tellers = { ...bron.tellers, structuur_op: Date.now() }
        await admin.from('ag_clickup_bronnen').update({ fase, cursor: { team }, volledig_op: bron.volledig_op, laatste_sync_op: start, tellers: bron.tellers }).eq('id', bron.id)
        break
      }
      if (fase === 'sync') {
        // Om de 6 uur de structuur (nieuwe mappen, lijsten, wie er toegang heeft) en de docs opnieuw.
        if (Date.now() - Number(bron.tellers?.structuur_op ?? 0) > STRUCTUUR_OPNIEUW_MS) {
          fase = 'structuur'; bron.cursor = {}
          await admin.from('ag_clickup_bronnen').update({ fase, cursor: {} }).eq('id', bron.id)
          continue
        }
        const sinds = bron.laatste_sync_op ? Date.parse(bron.laatste_sync_op) - 10 * 60_000 : null
        const r = await takenPaginas(admin, cu, team, bron, deadline, tellers, sinds)
        if (!r.klaar) break
        const d = await docs(admin, cu, team, bron, deadline, tellers, sinds)
        await admin.rpc('ag_koppel_ouders')
        if (d.klaar) await admin.from('ag_clickup_bronnen').update({ laatste_sync_op: start }).eq('id', bron.id)
        break
      }
      break
    }
  } catch (e) {
    fout = e instanceof Error ? e.message.slice(0, 300) : 'Import mislukt'
  } finally {
    const { data: nu } = await admin.from('ag_clickup_bronnen').select('tellers').eq('id', bron.id).maybeSingle()
    const oud = (nu?.tellers ?? {}) as Record<string, number>
    const samen: Record<string, number> = { ...oud }
    for (const [k, v] of Object.entries(tellers)) samen[`totaal_${k}`] = (oud[`totaal_${k}`] ?? 0) + v
    await admin.from('ag_clickup_bronnen').update({ bezig_sinds: null, fout, tellers: samen, updated_at: new Date().toISOString() }).eq('id', bron.id)
  }
  return { bron: bron.sleutel, fase, klaar: fase === 'sync' && !fout, tellers, fout }
}

/** Alle actieve bronnen na elkaar, binnen het budget (cron of "Nu ophalen"). */
export async function importeerClickup(admin: Admin, opts: { budgetMs?: number; enkel?: string } = {}): Promise<ImportUitkomst[]> {
  await zorgVoorGedeeldeBron(admin)
  const deadline = Date.now() + (opts.budgetMs ?? 50_000)
  let q = admin.from('ag_clickup_bronnen').select('*').eq('actief', true).order('created_at')
  if (opts.enkel) q = q.eq('id', opts.enkel)
  const { data } = await q
  const uit: ImportUitkomst[] = []
  for (const b of (data ?? []) as Bron[]) {
    if (b.bezig_sinds && Date.now() - Date.parse(b.bezig_sinds) < 5 * 60_000) continue
    if (Date.now() > deadline - 5_000) break
    uit.push(await importeerBron(admin, b, deadline))
  }
  return uit
}

/** Een persoonlijk ClickUp-token koppelen: eerst nagaan bij ClickUp, dan bewaren (het token verlaat de server nooit). */
export async function koppelToken(admin: Admin, persoonId: string, token: string): Promise<{ naam: string }> {
  const t = token.trim()
  if (!/^pk_[A-Za-z0-9_]{10,}$/.test(t)) throw new Error('Dat lijkt geen persoonlijk ClickUp-token (begint met pk_).')
  const cu = new Cu(t)
  const u = await cu.get<{ user?: { id: number; username?: string; email?: string } }>(`${V2}/user`).catch(() => null)
  if (!u?.user) throw new Error('ClickUp aanvaardt dit token niet.')
  await admin.from('ag_clickup_bronnen').upsert({
    sleutel: `persoon:${persoonId}`, persoon_id: persoonId, token: t, clickup_user_id: u.user.id, clickup_naam: u.user.username ?? u.user.email ?? null,
    actief: true, fase: 'structuur', cursor: {}, volledig_op: null, laatste_sync_op: null, fout: null, updated_at: new Date().toISOString(),
  }, { onConflict: 'sleutel' })
  return { naam: u.user.username ?? u.user.email ?? 'ClickUp' }
}

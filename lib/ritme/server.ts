import 'server-only'
import { randomUUID } from 'node:crypto'
import { logAudit } from '@/lib/audit'
import {
  CIJFERS, leesScorecard, weken, perWeek, maandagVan, leesActies, leesNotities, controleerActie, controleerDoel, isStem, uitslag, werkvoorraad,
  type CijferKey, type ScorecardInstellingen, type Week, type Actiepunt, type Belofte, type Stem,
} from './model'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
export type Ik = { userId: string; email: string | null; naam: string | null; isAdmin: boolean }

export class RitmeFout extends Error { constructor(m: string, public status = 400) { super(m) } }

const SCORECARD = 'scorecard'
const UITGEREIKT = ['verstuurd', 'gefactureerd', 'betaald']
const nu = () => new Date().toISOString()
const vandaagBrussel = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ontbrekende tabel (vóór de migratie): leeg in plaats van een fout. */
const veilig = async <T,>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> => {
  try { const r = await q; return r.error ? [] : (r.data ?? []) } catch { return [] }
}

// ── Scorecard ───────────────────────────────────────────────────────────────

export type ScorecardRij = { key: CijferKey; label: string; euro: boolean; uitleg: string; waarden: number[]; eigenaar: string | null; doel: number | null; aan: boolean }

export async function scorecard(admin: Admin): Promise<{ weken: Week[]; rijen: ScorecardRij[]; instellingen: ScorecardInstellingen }> {
  const w = weken(vandaagBrussel(), 13)
  const van = w[0].van, vanTs = `${van}T00:00:00Z`
  const [inst, inv, opd, ofv, ofa, con, ngs, mt, abm, opl, aan] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', SCORECARD).maybeSingle().then((r: { data: { value: unknown } | null }) => r.data?.value ?? null, () => null),
    veilig<{ invoice_date: string; amount_excl: number | null; kind: string | null }>(admin.from('invoices').select('invoice_date, amount_excl, kind').in('status', UITGEREIKT).gte('invoice_date', van).limit(5000)),
    veilig<{ created_at: string }>(admin.from('opdrachten').select('created_at').gte('created_at', vanTs).limit(5000)),
    veilig<{ verstuurd_op: string }>(admin.from('offertes').select('verstuurd_op').gte('verstuurd_op', vanTs).limit(5000)),
    veilig<{ geaccepteerd_op: string }>(admin.from('offertes').select('geaccepteerd_op').gte('geaccepteerd_op', vanTs).limit(5000)),
    veilig<{ signed_at: string }>(admin.from('contracts').select('signed_at').gte('signed_at', vanTs).limit(5000)),
    veilig<{ gewonnen_op: string }>(admin.from('ngs_deals').select('gewonnen_op').eq('fase', 'won').is('verwijderd_op', null).gte('gewonnen_op', van).limit(5000)),
    veilig<{ starts_at: string }>(admin.from('klant_meetings').select('starts_at').is('geannuleerd_op', null).neq('status', 'geannuleerd').gte('starts_at', vanTs).lte('starts_at', `${w[w.length - 1].tot}T23:59:59Z`).limit(5000)),
    veilig<{ created_at: string }>(admin.from('abm_notities').select('created_at').not('uitkomst', 'is', null).gte('created_at', vanTs).limit(5000)),
    veilig<{ gepubliceerd_op: string }>(admin.from('oplevering_versies').select('gepubliceerd_op').gte('gepubliceerd_op', vanTs).limit(5000)),
    veilig<{ created_at: string }>(admin.from('klant_aanvragen').select('created_at').gte('created_at', vanTs).limit(5000)),
  ])
  const instellingen = leesScorecard(inst)
  const brussel = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }) : null)
  const facturen = inv.filter((f) => { const k = String(f.kind ?? 'client'); return k !== 'wam' && !k.startsWith('setter') })
  const waarden: Record<CijferKey, number[]> = {
    gefactureerd: perWeek(facturen.map((f) => ({ datum: f.invoice_date, waarde: Number(f.amount_excl) || 0 })), w),
    nieuwe_projecten: perWeek(opd.map((r) => ({ datum: brussel(r.created_at) })), w),
    offertes_verstuurd: perWeek(ofv.map((r) => ({ datum: brussel(r.verstuurd_op) })), w),
    offertes_aanvaard: perWeek(ofa.map((r) => ({ datum: brussel(r.geaccepteerd_op) })), w),
    contracten_getekend: perWeek(con.map((r) => ({ datum: brussel(r.signed_at) })), w),
    solutions_gewonnen: perWeek(ngs.map((r) => ({ datum: r.gewonnen_op?.slice(0, 10) ?? null })), w),
    klantmeetings: perWeek(mt.map((r) => ({ datum: brussel(r.starts_at) })), w),
    abm_gesprekken: perWeek(abm.map((r) => ({ datum: brussel(r.created_at) })), w),
    opleveringen_gedeeld: perWeek(opl.map((r) => ({ datum: brussel(r.gepubliceerd_op) })), w),
    aanvragen: perWeek(aan.map((r) => ({ datum: brussel(r.created_at) })), w),
  }
  return { weken: w, instellingen, rijen: CIJFERS.map((c) => ({ key: c.key, label: c.label, euro: !!c.euro, uitleg: c.uitleg, waarden: waarden[c.key], ...instellingen[c.key] })) }
}

export async function bewaarScorecard(admin: Admin, b: unknown, ik: Ik): Promise<ScorecardInstellingen> {
  const inst = leesScorecard(b)
  const { error } = await admin.from('app_settings').upsert({ key: SCORECARD, value: inst, updated_at: nu(), updated_by_email: ik.email }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
  await logAudit({ action: 'scorecard.instellingen', entityType: 'instellingen', entityId: SCORECARD, summary: 'Scorecard aangepast (eigenaars en doelen)', actorUserId: ik.userId, actorEmail: ik.email })
  return inst
}

// ── 97. Werkvoorraad per bedrijf ────────────────────────────────────────────

export async function werkvoorraadPerBedrijf(admin: Admin) {
  const van = weken(vandaagBrussel(), 13)[0].van
  const [open, gef] = await Promise.all([
    veilig<{ amount_excl: number | null; bedrijf: string | null; kind: string | null }>(admin.from('invoices').select('amount_excl, bedrijf, kind').eq('status', 'te_versturen').limit(5000)),
    veilig<{ amount_excl: number | null; bedrijf: string | null; kind: string | null }>(admin.from('invoices').select('amount_excl, bedrijf, kind').in('status', UITGEREIKT).gte('invoice_date', van).limit(5000)),
  ])
  const telt = (k: string | null) => { const x = String(k ?? 'client'); return x !== 'wam' && !x.startsWith('setter') }
  return (['nextgenmedia', 'nextgensolutions'] as const).map((b) => {
    const t = open.filter((r) => telt(r.kind) && r.bedrijf === b).reduce((s, r) => s + (Number(r.amount_excl) || 0), 0)
    const g = gef.filter((r) => telt(r.kind) && r.bedrijf === b).reduce((s, r) => s + (Number(r.amount_excl) || 0), 0)
    return { bedrijf: b, teFactureren: Math.round(t), gefactureerd13: Math.round(g), ...werkvoorraad(t, g) }
  })
}

// ── 91. Weekoverleg ─────────────────────────────────────────────────────────

export type Overleg = { id: string | null; week: string; notities: ReturnType<typeof leesNotities>; acties: Actiepunt[]; aanwezig: string[]; afgesloten_op: string | null; bijgewerkt_door: string | null; updated_at: string | null }

const naarOverleg = (r: Record<string, unknown> | null, week: string): Overleg => ({
  id: (r?.id as string) ?? null, week, notities: leesNotities(r?.notities), acties: leesActies(r?.acties),
  aanwezig: Array.isArray(r?.aanwezig) ? (r!.aanwezig as string[]).filter((x) => typeof x === 'string').slice(0, 10) : [],
  afgesloten_op: (r?.afgesloten_op as string) ?? null, bijgewerkt_door: (r?.bijgewerkt_door as string) ?? null, updated_at: (r?.updated_at as string) ?? null,
})

export async function overleg(admin: Admin, week: string): Promise<{ overleg: Overleg; vorige: Overleg | null; weken: string[]; metTaak: string[] }> {
  const w = maandagVan(week)
  const [huidig, vorige, lijst] = await Promise.all([
    admin.from('ritme_weekoverleg').select('*').eq('week', w).maybeSingle(),
    admin.from('ritme_weekoverleg').select('*').lt('week', w).order('week', { ascending: false }).limit(1).maybeSingle(),
    veilig<{ week: string }>(admin.from('ritme_weekoverleg').select('week').order('week', { ascending: false }).limit(26)),
  ])
  if (huidig.error && /ritme_weekoverleg/.test(huidig.error.message ?? '')) throw new RitmeFout('Het weekoverleg is nog niet klaar in de databank (migratie).', 503)
  const v = vorige.data as Record<string, unknown> | null
  const o = naarOverleg(huidig.data, w), vo = v ? naarOverleg(v, String(v.week)) : null
  // Welke actiepunten werden al een taak (Taken toewijzen met opvolg_ref "overleg:<id>")?
  const refs = [...o.acties, ...(vo?.acties ?? [])].map((a) => `overleg:${a.id}`)
  const taken = refs.length ? await veilig<{ opvolg_ref: string }>(admin.from('team_taken').select('opvolg_ref').in('opvolg_ref', refs)) : []
  return { overleg: o, vorige: vo, weken: lijst.map((x) => x.week), metTaak: taken.map((t) => t.opvolg_ref.slice(8)) }
}

async function bewaarOverlegRij(admin: Admin, o: Overleg, ik: Ik): Promise<Overleg> {
  const rij = { week: o.week, notities: o.notities, acties: o.acties, aanwezig: o.aanwezig, afgesloten_op: o.afgesloten_op, bijgewerkt_door: ik.naam ?? ik.email, updated_at: nu() }
  const { data, error } = await admin.from('ritme_weekoverleg').upsert(rij, { onConflict: 'week' }).select('*').single()
  if (error) throw new Error(error.message)
  return naarOverleg(data, o.week)
}

export async function overlegActie(admin: Admin, b: Record<string, unknown>, ik: Ik): Promise<Overleg> {
  const week = maandagVan(String(b.week ?? vandaagBrussel()))
  const { overleg: o } = await overleg(admin, week)
  if (b.actie === 'overleg.bewaar') {
    if (b.notities !== undefined) o.notities = leesNotities(b.notities)
    if (Array.isArray(b.aanwezig)) o.aanwezig = (b.aanwezig as unknown[]).filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 40)).slice(0, 10)
    if (b.afsluiten === true) o.afgesloten_op = nu()
    if (b.afsluiten === false) o.afgesloten_op = null
  } else if (b.actie === 'overleg.actie') {
    const c = controleerActie(b)
    if (!c.ok) throw new RitmeFout(c.fout)
    o.acties = [...o.acties, { id: randomUUID(), ...c.actie, taak_id: null }]
  } else if (b.actie === 'overleg.actie_wijzig') {
    const id = String(b.id ?? '')
    const a = o.acties.find((x) => x.id === id)
    if (!a) throw new RitmeFout('Dat actiepunt bestaat niet meer.', 404)
    if (typeof b.klaar === 'boolean') a.klaar = b.klaar
    if (typeof b.taak_id === 'string' && UUID.test(b.taak_id)) a.taak_id = b.taak_id
    if (b.weg === true) o.acties = o.acties.filter((x) => x.id !== id)
  } else throw new RitmeFout('Onbekende actie')
  return bewaarOverlegRij(admin, o, ik)
}

// ── 92. Kwartaaldoelen ──────────────────────────────────────────────────────

export async function doelen(admin: Admin, kwartaal: string) {
  return veilig(admin.from('ritme_kwartaaldoelen').select('*').eq('kwartaal', kwartaal).is('gearchiveerd_op', null).order('created_at'))
}

export async function doelActie(admin: Admin, b: Record<string, unknown>, ik: Ik) {
  if (b.actie === 'doel.nieuw') {
    const c = controleerDoel(b)
    if (!c.ok) throw new RitmeFout(c.fout)
    const { error } = await admin.from('ritme_kwartaaldoelen').insert({ ...c.doel, gemaakt_door: ik.naam ?? ik.email })
    if (error) throw new Error(error.message)
    return
  }
  const id = String(b.id ?? '')
  if (!UUID.test(id)) throw new RitmeFout('Onbekend doel', 404)
  if (b.actie === 'doel.wijzig') {
    const c = controleerDoel(b)
    if (!c.ok) throw new RitmeFout(c.fout)
    const { error } = await admin.from('ritme_kwartaaldoelen').update({ ...c.doel, updated_at: nu() }).eq('id', id)
    if (error) throw new Error(error.message)
    return
  }
  if (b.actie === 'doel.archiveer') {
    const { error } = await admin.from('ritme_kwartaaldoelen').update({ gearchiveerd_op: nu() }).eq('id', id)
    if (error) throw new Error(error.message)
    return
  }
  throw new RitmeFout('Onbekende actie')
}

// ── 93. Beslissingen ────────────────────────────────────────────────────────

export async function beslissingen(admin: Admin) {
  const [b, s] = await Promise.all([
    veilig<Record<string, unknown>>(admin.from('ritme_beslissingen').select('*').is('gearchiveerd_op', null).order('created_at', { ascending: false }).limit(100)),
    veilig<{ beslissing_id: string; auth_user_id: string; naam: string | null; stem: Stem; updated_at: string }>(admin.from('ritme_stemmen').select('beslissing_id, auth_user_id, naam, stem, updated_at')),
  ])
  return b.map((x) => ({ ...x, stemmen: s.filter((y) => y.beslissing_id === x.id) }))
}

export async function beslissingActie(admin: Admin, b: Record<string, unknown>, ik: Ik) {
  if (b.actie === 'beslissing.nieuw') {
    const titel = String(b.titel ?? '').trim().slice(0, 200)
    if (titel.length < 3) throw new RitmeFout('Wat wordt er beslist?')
    const { data, error } = await admin.from('ritme_beslissingen').insert({
      titel, toelichting: String(b.toelichting ?? '').trim().slice(0, 5000) || null,
      bedrijf: b.bedrijf === 'nextgenmedia' || b.bedrijf === 'nextgensolutions' ? b.bedrijf : null,
      voorgesteld_door: ik.naam ?? ik.email, status: 'open',
    }).select('id').single()
    if (error) throw new Error(error.message)
    await logAudit({ action: 'beslissing.nieuw', entityType: 'beslissing', entityId: data.id, summary: `Beslissing voorgesteld: ${titel}`, actorUserId: ik.userId, actorEmail: ik.email })
    return
  }
  const id = String(b.id ?? '')
  if (!UUID.test(id)) throw new RitmeFout('Onbekende beslissing', 404)
  const { data: bes } = await admin.from('ritme_beslissingen').select('id, titel, status').eq('id', id).maybeSingle()
  if (!bes) throw new RitmeFout('Onbekende beslissing', 404)
  if (b.actie === 'beslissing.stem') {
    if (bes.status !== 'open') throw new RitmeFout('Over deze beslissing is al gestemd.', 409)
    if (!isStem(b.stem)) throw new RitmeFout('Kies voor, tegen of onthouding.')
    const { error } = await admin.from('ritme_stemmen').upsert({ beslissing_id: id, auth_user_id: ik.userId, naam: ik.naam ?? ik.email, stem: b.stem, updated_at: nu() }, { onConflict: 'beslissing_id,auth_user_id' })
    if (error) throw new Error(error.message)
    const stemmen = await veilig<{ stem: Stem }>(admin.from('ritme_stemmen').select('stem').eq('beslissing_id', id))
    const u = uitslag(stemmen)
    if (u !== 'open') await admin.from('ritme_beslissingen').update({ status: u, beslist_op: nu(), updated_at: nu() }).eq('id', id).eq('status', 'open')
    await logAudit({ action: 'beslissing.stem', entityType: 'beslissing', entityId: id, summary: `Stem ${b.stem} op "${bes.titel}"${u !== 'open' ? ` · ${u}` : ''}`, actorUserId: ik.userId, actorEmail: ik.email })
    return
  }
  if (b.actie === 'beslissing.archiveer') {
    const { error } = await admin.from('ritme_beslissingen').update({ gearchiveerd_op: nu() }).eq('id', id)
    if (error) throw new Error(error.message)
    return
  }
  throw new RitmeFout('Onbekende actie')
}

// ── 94. Beloftes ────────────────────────────────────────────────────────────

/** Beloftes: teamtaken met "beloofd aan" en de actiepunten van het weekoverleg (laatste 8 weken). */
export async function beloftes(admin: Admin): Promise<Belofte[]> {
  const van = maandagVan(new Date(Date.now() - 56 * 86_400_000).toISOString().slice(0, 10))
  const [taken, ov] = await Promise.all([
    veilig<{ id: string; omschrijving: string; clickup_assignee_naam: string | null; beloofd_aan: string | null; deadline: string | null; afgerond_op: string | null; opvolg_ref: string | null }>(
      admin.from('team_taken').select('id, omschrijving, clickup_assignee_naam, beloofd_aan, deadline, afgerond_op, opvolg_ref').not('beloofd_aan', 'is', null).order('deadline').limit(500)),
    veilig<{ week: string; acties: unknown }>(admin.from('ritme_weekoverleg').select('week, acties').gte('week', van)),
  ])
  const uitTaak = new Set(taken.map((t) => t.opvolg_ref).filter(Boolean))
  const lijst: Belofte[] = taken.map((t) => ({ id: t.id, wat: t.omschrijving, wie: t.clickup_assignee_naam, aan_wie: t.beloofd_aan ?? '', tegen: t.deadline, klaar: !!t.afgerond_op }))
  for (const o of ov) for (const a of leesActies(o.acties)) {
    if (uitTaak.has(`overleg:${a.id}`)) continue
    lijst.push({ id: a.id, wat: a.tekst, wie: a.wie, aan_wie: a.aan_wie ?? 'het team', tegen: a.tegen, klaar: !!a.klaar })
  }
  return lijst
}

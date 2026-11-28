import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { inclFromExcl } from '@/lib/invoices'
import { betaaltermijnVan } from '@/lib/bedrijven/betaaltermijn-server'
import {
  pakketVan, opslagStand, opslagMelding, urenDezeMaand, deadlineNaWerkuren, supportStatus, monitoringAlarm, leesOverdracht,
  leesCareLinks, isPakketKey, reactieLabel, veiligeMonitorUrl, OVERDRACHT_STAPPEN, SUPPORT_KANALEN, type CareInst, type Overdracht, type OpslagStand,
} from './care'
import type { CarePakket } from '@/lib/werking/instellingen'

/**
 * Care bij NextGenSolutions op de server (nieuwe werking fase 6). Niets wordt
 * verwijderd: uren gaan naar een archief (verwijderd_op), supportvragen worden
 * opgelost, checks blijven staan. Nooit een mail naar de klant.
 */
type Admin = ReturnType<typeof createAdminSupabaseClient>

export class CareFout extends Error {
  constructor(message: string, public status = 400) { super(message) }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const moetId = (id: unknown, wat = 'Care'): string => { if (typeof id !== 'string' || !UUID.test(id)) throw new CareFout(`${wat} niet gevonden.`, 404); return id }
const nu = () => new Date().toISOString()
const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const getal = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export type CareRijVol = {
  id: string; client_id: string | null; project_id: string | null; naam: string; status: string
  pakket: string | null; vercel_url: string | null; supabase_ref: string | null; github_url: string | null; monitor_url: string | null
  db_gb: number | null; bestanden_gb: number | null; gemeten_op: string | null; meetbron: string | null
  overdracht: Overdracht; reeks_id: string | null; maandbedrag: number | null; care_contract: boolean
}
function naarVol(r: Record<string, unknown>): CareRijVol {
  return {
    id: String(r.id), client_id: (r.client_id as string | null) ?? null, project_id: (r.project_id as string | null) ?? null, naam: String(r.naam ?? ''), status: String(r.status ?? 'actief'),
    pakket: (r.pakket as string | null) ?? null, vercel_url: (r.vercel_url as string | null) ?? null, supabase_ref: (r.supabase_ref as string | null) ?? null,
    github_url: (r.github_url as string | null) ?? null, monitor_url: (r.monitor_url as string | null) ?? null,
    db_gb: getal(r.db_gb), bestanden_gb: getal(r.bestanden_gb), gemeten_op: (r.gemeten_op as string | null) ?? null, meetbron: (r.meetbron as string | null) ?? null,
    overdracht: leesOverdracht(r.overdracht), reeks_id: (r.reeks_id as string | null) ?? null, maandbedrag: getal(r.maandbedrag), care_contract: r.care_contract === true,
  }
}

async function leesCare(admin: Admin, idIn: unknown): Promise<CareRijVol> {
  const { data } = await admin.from('ngs_care').select('*').eq('id', moetId(idIn)).is('gearchiveerd_op', null).maybeSingle()
  if (!data) throw new CareFout('Care niet gevonden.', 404)
  return naarVol(data as Record<string, unknown>)
}
async function zetCare(admin: Admin, id: string, patch: Record<string, unknown>) {
  const { error } = await admin.from('ngs_care').update({ ...patch, updated_at: nu() }).eq('id', id)
  if (error) throw new Error(error.message)
}
const careInst = async (): Promise<CareInst> => (await leesInstellingen()).werking.care

export type CareDetail = {
  care: CareRijVol; pakket: CarePakket | null; pakketten: CarePakket[]; bevestigd: boolean; migratie_vanaf: number
  opslag: OpslagStand | null; uren: { stand: ReturnType<typeof urenDezeMaand>; rijen: { id: string; datum: string; uren: number; omschrijving: string | null; door: string | null }[] }
  support: { id: string; binnen_op: string; kanaal: string; vraag: string; deadline: string; opgelost_op: string | null; door: string | null; status: string; minutenOver: number }[]
  checks: { op: string; ok: boolean; status: number | null; ms: number | null; fout: string | null }[]; alarm: boolean
  reactie: string | null; beheerToken: boolean
}

export async function careDetail(admin: Admin, idIn: unknown): Promise<CareDetail> {
  const care = await leesCare(admin, idIn)
  const inst = await careInst()
  const pakket = pakketVan(care.pakket, inst)
  const d = vandaag()
  const [{ data: u }, { data: s }, { data: c }] = await Promise.all([
    admin.from('ngs_care_uren').select('id, datum, uren, omschrijving, door').eq('care_id', care.id).is('verwijderd_op', null).gte('datum', `${d.slice(0, 7)}-01`).order('datum', { ascending: false }),
    admin.from('ngs_care_support').select('*').eq('care_id', care.id).order('binnen_op', { ascending: false }).limit(30),
    admin.from('ngs_care_checks').select('op, ok, status, ms, fout').eq('care_id', care.id).order('op', { ascending: false }).limit(12),
  ])
  const rijen = ((u ?? []) as { id: string; datum: string; uren: number; omschrijving: string | null; door: string | null }[]).map((r) => ({ ...r, uren: Number(r.uren) }))
  const checks = (c ?? []) as CareDetail['checks']
  return {
    care, pakket, pakketten: inst.pakketten, bevestigd: inst.bevestigd, migratie_vanaf: inst.migratie_vanaf,
    opslag: opslagStand(care, pakket, inst), uren: { stand: urenDezeMaand(rijen, d, pakket), rijen },
    support: ((s ?? []) as { id: string; binnen_op: string; kanaal: string; vraag: string; deadline: string; opgelost_op: string | null; door: string | null }[])
      .map((x) => ({ ...x, ...supportStatus(x) })),
    checks, alarm: monitoringAlarm(checks), reactie: pakket ? reactieLabel(pakket.reactie_werkuren, inst) : null,
    beheerToken: !!process.env.SUPABASE_MANAGEMENT_TOKEN,
  }
}

/**
 * Opslaggebruik ophalen via de Management API van Supabase (enkel op de server,
 * met SUPABASE_MANAGEMENT_TOKEN). Lukt het niet, dan zegt de app waarom en vul je
 * het met de hand in.
 */
async function meetViaSupabase(ref: string): Promise<{ db_gb: number; bestanden_gb: number }> {
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN
  if (!token) throw new CareFout('Er is geen Supabase-toegangstoken ingesteld. Vul het gebruik met de hand in.')
  const sql = "select pg_database_size(current_database())::bigint as db, coalesce((select sum((metadata->>'size')::bigint) from storage.objects), 0)::bigint as bestanden"
  const r = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!r) throw new CareFout('Supabase antwoordde niet. Probeer later of vul het met de hand in.')
  if (r.status === 401 || r.status === 403 || r.status === 404) throw new CareFout('Geen toegang tot dat Supabase-project met ons token. Vul het gebruik met de hand in.')
  if (!r.ok) throw new CareFout('Supabase gaf een fout. Vul het gebruik met de hand in.')
  const j = (await r.json().catch(() => null)) as { db?: number | string; bestanden?: number | string }[] | null
  const rij = Array.isArray(j) ? j[0] : null
  if (!rij) throw new CareFout('Onverwacht antwoord van Supabase. Vul het gebruik met de hand in.')
  const gb = (b: unknown) => Math.round((Number(b) / 1024 ** 3) * 1000) / 1000
  return { db_gb: gb(rij.db), bestanden_gb: gb(rij.bestanden) }
}

/** Alle acties op één Care-rij. */
export async function careActie(admin: Admin, b: Record<string, unknown>, door: string | null): Promise<Record<string, unknown>> {
  const care = await leesCare(admin, b.id)
  const actie = String(b.actie)
  const inst = await careInst()

  if (actie === 'care.pakket') {
    if (b.pakket !== null && !isPakketKey(b.pakket)) throw new CareFout('Kies Basis, Plus of Pro.')
    const p = b.pakket ? pakketVan(String(b.pakket), inst) : null
    await zetCare(admin, care.id, { pakket: p?.key ?? null, ...(p && !care.reeks_id ? { care_contract: true, maandbedrag: p.prijs } : {}) })
    return { ok: true }
  }
  if (actie === 'care.links') {
    const l = leesCareLinks(b)
    if (!l.ok) throw new CareFout(l.fout)
    if (l.waarde.monitor_url && !veiligeMonitorUrl(l.waarde.monitor_url)) throw new CareFout('De monitor-link moet een publiek https-adres zijn.')
    await zetCare(admin, care.id, l.waarde)
    return { ok: true }
  }
  if (actie === 'care.gebruik') {
    const g = (v: unknown) => { const t = String(v ?? '').trim().replace(',', '.'); if (!t) return null; const n = Number(t); if (!Number.isFinite(n) || n < 0 || n > 100_000) throw new CareFout('Het gebruik is een aantal GB.'); return Math.round(n * 1000) / 1000 }
    await zetCare(admin, care.id, { db_gb: g(b.db_gb), bestanden_gb: g(b.bestanden_gb), gemeten_op: nu(), meetbron: 'hand' })
    return { ok: true }
  }
  if (actie === 'care.meten') {
    if (!care.supabase_ref) throw new CareFout('Vul eerst de Supabase-ref van het project in.')
    const m = await meetViaSupabase(care.supabase_ref)
    await zetCare(admin, care.id, { ...m, gemeten_op: nu(), meetbron: 'api' })
    return { ok: true, ...m }
  }
  if (actie === 'care.uren') {
    const uren = Number(String(b.uren ?? '').replace(',', '.'))
    if (!(uren > 0 && uren <= 24)) throw new CareFout('Hoeveel uur? Tussen 0 en 24.')
    const datum = typeof b.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.datum) ? b.datum : vandaag()
    const { error } = await admin.from('ngs_care_uren').insert({ care_id: care.id, datum, uren: Math.round(uren * 4) / 4, omschrijving: String(b.omschrijving ?? '').trim().slice(0, 300) || null, door })
    if (error) throw new Error(error.message)
    return { ok: true }
  }
  if (actie === 'care.uren_weg') {
    const { error } = await admin.from('ngs_care_uren').update({ verwijderd_op: nu() }).eq('id', moetId(b.uur, 'Uur')).eq('care_id', care.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  }
  if (actie === 'care.support') {
    const vraag = String(b.vraag ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000)
    if (vraag.length < 3) throw new CareFout('Wat is de vraag?')
    const kanaal = SUPPORT_KANALEN.some((k) => k.key === b.kanaal) ? String(b.kanaal) : 'telefoon'
    const pakket = pakketVan(care.pakket, inst)
    if (!pakket) throw new CareFout('Kies eerst het pakket: daar hangt de reactietijd van af.')
    const binnen = typeof b.binnen_op === 'string' && !Number.isNaN(Date.parse(b.binnen_op)) ? new Date(b.binnen_op).toISOString() : nu()
    const { error } = await admin.from('ngs_care_support').insert({ care_id: care.id, binnen_op: binnen, kanaal, vraag, deadline: deadlineNaWerkuren(binnen, pakket.reactie_werkuren, inst), door })
    if (error) throw new Error(error.message)
    return { ok: true }
  }
  if (actie === 'care.support_opgelost') {
    const opgelost = b.opgelost !== false
    const { error } = await admin.from('ngs_care_support').update({ opgelost_op: opgelost ? nu() : null, opgelost_door: opgelost ? door : null }).eq('id', moetId(b.vraag_id, 'Vraag')).eq('care_id', care.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  }
  if (actie === 'care.overdracht') {
    const stap = OVERDRACHT_STAPPEN.find((s) => s.key === b.stap)?.key
    if (!stap) throw new CareFout('Onbekende stap.')
    const o = { ...care.overdracht }
    if (b.gedaan === false) delete o[stap]; else o[stap] = { op: nu(), door }
    await zetCare(admin, care.id, { overdracht: o })
    return { ok: true }
  }
  if (actie === 'care.factuur') return { ok: true, reeks_id: await careFactuurInstellen(admin, care, inst, b.start_maand) }
  throw new CareFout('Onbekende actie.')
}

/**
 * Care-factuur instellen (enkel op klik): een maandreeks in Te factureren met de
 * prijs van het pakket, bedrijf NextGenSolutions. Een tweede keer maakt geen tweede reeks.
 */
async function careFactuurInstellen(admin: Admin, care: CareRijVol, inst: CareInst, startIn: unknown): Promise<string> {
  if (care.reeks_id) {
    const { data: r } = await admin.from('recurring_invoices').select('id').eq('id', care.reeks_id).is('deleted_at', null).maybeSingle()
    if (r) throw new CareFout('De Care-factuur staat al in Te factureren.')
  }
  const pakket = pakketVan(care.pakket, inst)
  if (!pakket) throw new CareFout('Kies eerst het pakket.')
  if (!care.client_id) throw new CareFout('Koppel eerst de klant.')
  const vtg = vandaag()
  const start = typeof startIn === 'string' && /^\d{4}-\d{2}$/.test(startIn) ? startIn : vtg.slice(0, 7)
  const settings = await leesInstellingen()
  const btw = settings.facturatie.standaard_btw_pct
  const termijn = await betaaltermijnVan(admin, 'nextgensolutions', settings.facturatie.betalingstermijn_dagen)
  const rij: Record<string, unknown> = {
    client_id: care.client_id, start_month: start, description: `Care ${pakket.naam}: ${care.naam}`,
    amount_excl: pakket.prijs, vat_pct: btw, amount_incl: inclFromExcl(pakket.prijs, btw), active: true,
    payment_term_days: termijn, bedrijf: 'nextgensolutions',
  }
  let ins = await admin.from('recurring_invoices').insert(rij).select('id').single()
  for (let i = 0; i < 4 && ins.error; i++) {
    const kol = ins.error.message.match(/Could not find the '([^']+)' column/)?.[1]
    if (!kol || !(kol in rij)) break
    delete rij[kol]
    ins = await admin.from('recurring_invoices').insert(rij).select('id').single()
  }
  if (ins.error) throw new Error(ins.error.message)
  const id = String((ins.data as { id: string }).id)
  await zetCare(admin, care.id, { reeks_id: id, care_contract: true, maandbedrag: pakket.prijs })
  return id
}

/** Meldingen voor het belletje: opslag vanaf 80%, supportvragen in gevaar, monitoring-alarm. */
export async function careMeldingen(admin: Admin): Promise<{ id: string; titel: string; href: string; hoog: boolean; datum: string }[]> {
  const { data } = await admin.from('ngs_care').select('*').is('gearchiveerd_op', null).neq('status', 'gestopt').limit(500)
  const rijen = ((data ?? []) as Record<string, unknown>[]).map(naarVol)
  if (!rijen.length) return []
  const inst = await careInst()
  const ids = rijen.map((r) => r.id)
  const [{ data: s }, { data: c }] = await Promise.all([
    admin.from('ngs_care_support').select('id, care_id, vraag, deadline, opgelost_op').in('care_id', ids).is('opgelost_op', null),
    admin.from('ngs_care_checks').select('care_id, op, ok').in('care_id', ids).gte('op', new Date(Date.now() - 3 * 3600_000).toISOString()).order('op', { ascending: false }),
  ])
  const naam = new Map(rijen.map((r) => [r.id, r.naam]))
  const out: { id: string; titel: string; href: string; hoog: boolean; datum: string }[] = []
  const d = vandaag()
  for (const r of rijen) {
    const m = opslagMelding(r.naam, opslagStand(r, pakketVan(r.pakket, inst), inst))
    if (m) out.push({ id: `care-opslag:${r.id}`, titel: m, href: '/admin/nextgensolutions/levering?tab=care', hoog: false, datum: d })
  }
  for (const v of (s ?? []) as { id: string; care_id: string; vraag: string; deadline: string; opgelost_op: string | null }[]) {
    const st = supportStatus(v)
    if (st.status === 'te_laat' || st.status === 'bijna') out.push({ id: `care-support:${v.id}`, titel: `${naam.get(v.care_id) ?? 'Care'}: supportvraag ${st.status === 'te_laat' ? 'over de reactietijd' : 'nadert de reactietijd'} (${v.vraag.slice(0, 60)})`, href: '/admin/nextgensolutions/levering?tab=care', hoog: st.status === 'te_laat', datum: d })
  }
  const perCare = new Map<string, { ok: boolean }[]>()
  for (const x of (c ?? []) as { care_id: string; ok: boolean }[]) { const l = perCare.get(x.care_id) ?? []; l.push(x); perCare.set(x.care_id, l) }
  for (const [id, l] of perCare) if (monitoringAlarm(l)) out.push({ id: `care-alarm:${id}`, titel: `${naam.get(id) ?? 'Care'}: monitoring meldt twee keer na elkaar een fout`, href: '/admin/nextgensolutions/levering?tab=care', hoog: true, datum: d })
  return out
}

/** Eén monitoringronde (scheduler, elke 10 minuten): enkel pakketten met monitoring en een monitor-link. */
export async function monitorRonde(admin: Admin): Promise<{ gecontroleerd: number; fouten: number }> {
  const inst = await careInst()
  const metMonitoring = inst.pakketten.filter((p) => p.monitoring).map((p) => p.key)
  if (!metMonitoring.length) return { gecontroleerd: 0, fouten: 0 }
  const { data } = await admin.from('ngs_care').select('id, monitor_url').in('pakket', metMonitoring).eq('status', 'actief').is('gearchiveerd_op', null).not('monitor_url', 'is', null).limit(100)
  const lijst = ((data ?? []) as { id: string; monitor_url: string }[]).filter((c) => veiligeMonitorUrl(c.monitor_url))
  let fouten = 0
  await Promise.all(lijst.map(async (c) => {
    const start = Date.now()
    let ok = false, status: number | null = null, fout: string | null = null
    try {
      const r = await fetch(c.monitor_url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'NextGen-Care-monitor' } })
      status = r.status; ok = r.ok
      if (!ok) fout = `HTTP ${r.status}`
    } catch (e) { fout = e instanceof Error ? e.name === 'TimeoutError' ? 'Geen antwoord binnen 10 seconden' : e.message.slice(0, 200) : 'Onbekende fout' }
    if (!ok) fouten++
    await admin.from('ngs_care_checks').insert({ care_id: c.id, ok, status, ms: Date.now() - start, fout })
  }))
  return { gecontroleerd: lijst.length, fouten }
}

/** Klantapp: per Care-rij het pakket, de limieten, het gebruik en de resterende uren (nooit interne notities). */
export async function klantCareStand(admin: Admin, careIds: string[]): Promise<Record<string, { pakket: string; reactie: string; db: { gebruikt: number | null; limiet: number }; bestanden: { gebruikt: number | null; limiet: number }; gemeten_op: string | null; uren: { resterend: number; beschikbaar: number } } | null>> {
  if (!careIds.length) return {}
  const inst = await careInst()
  const d = vandaag()
  const [{ data: c }, { data: u }] = await Promise.all([
    admin.from('ngs_care').select('*').in('id', careIds),
    admin.from('ngs_care_uren').select('care_id, datum, uren').in('care_id', careIds).is('verwijderd_op', null).gte('datum', `${d.slice(0, 7)}-01`),
  ])
  const out: Awaited<ReturnType<typeof klantCareStand>> = {}
  for (const r of ((c ?? []) as Record<string, unknown>[]).map(naarVol)) {
    const p = pakketVan(r.pakket, inst)
    if (!p) { out[r.id] = null; continue }
    const st = urenDezeMaand(((u ?? []) as { care_id: string; datum: string; uren: number }[]).filter((x) => x.care_id === r.id).map((x) => ({ datum: x.datum, uren: Number(x.uren) })), d, p)
    out[r.id] = {
      pakket: p.naam, reactie: reactieLabel(p.reactie_werkuren, inst),
      db: { gebruikt: r.db_gb, limiet: p.db_gb }, bestanden: { gebruikt: r.bestanden_gb, limiet: p.bestanden_gb }, gemeten_op: r.gemeten_op,
      uren: { resterend: st.resterend, beschikbaar: st.beschikbaar },
    }
  }
  return out
}

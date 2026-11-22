import 'server-only'
import { randomUUID } from 'crypto'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { VENNOTEN_SLEUTEL, leesVennoten, vennootVan } from '@/lib/vesting-akkoord'
import { leesHandtekening } from '@/lib/contracten/tegenhandtekening'
import {
  VENNOTEN, controleerExtra, controleerReden, controleerRegels, controleerTerugkerend, controleerUitgave, extraTekst, isFrequentie, openAkkoorden, openAkkoordenTekst,
  regelsTekst, tekenStand, terugkerendTekst, uitgaveTekst,
  type BudgetExtra, type ExtraAkkoord, type RegelHandtekening, type RegelsVersie, type Terugkerend, type TerugkerendAkkoord, type Uitgave, type UitgaveAkkoord, type Vennoot,
} from '@/lib/vennoot-uitgaven'

type Admin = ReturnType<typeof createAdminSupabaseClient>

/**
 * Uitgaven vennoten, de serverkant (regels in lib/vennoot-uitgaven.ts).
 * Enkel admins (Marco, Bram, Chiara). Bonnetjes en facturen staan in de
 * privébucket `vennoot-uitgaven`; de browser laadt rechtstreeks op met een
 * ondertekende link, bekijken gaat met een kortlevende link.
 */
export const BON_BUCKET = 'vennoot-uitgaven'
const MAX = 25 * 1024 * 1024
const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp' }
const BON_PAD = /^bonnen\/[0-9a-f-]{36}\/[^/]{1,200}$/i

export class UitgaveFout extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

const MIST = /vennoot_|does not exist|schema cache/i
const veiligeNaam = (naam: string) => naam.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'bon'
const vandaagBrussel = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

function naarUitgave(r: Record<string, unknown>): Uitgave {
  return {
    id: String(r.id), vennoot: r.vennoot as Vennoot, datum: String(r.datum).slice(0, 10), omschrijving: String(r.omschrijving ?? ''),
    doel: (r.doel as string | null) ?? null, bedrag: Number(r.bedrag), bewijs_pad: (r.bewijs_pad as string | null) ?? null, bewijs_naam: (r.bewijs_naam as string | null) ?? null,
    gearchiveerd_op: (r.gearchiveerd_op as string | null) ?? null, gearchiveerd_door: (r.gearchiveerd_door as string | null) ?? null, archief_reden: (r.archief_reden as string | null) ?? null,
    created_at: (r.created_at as string | null) ?? null, created_by: (r.created_by as string | null) ?? null,
  }
}

function naarRegels(r: Record<string, unknown>): RegelsVersie {
  return {
    id: String(r.id), versie: Number(r.versie), regels: Array.isArray(r.regels) ? (r.regels as unknown[]).map(String) : [],
    maandbudget: Number(r.maandbudget), start_maand: String(r.start_maand), created_at: (r.created_at as string | null) ?? null, created_by: (r.created_by as string | null) ?? null,
  }
}

async function vennotenInstelling(admin: Admin) {
  const { data } = await admin.from('app_settings').select('value').eq('key', VENNOTEN_SLEUTEL).maybeSingle()
  return leesVennoten((data as { value?: unknown } | null)?.value)
}

const isV = (v: unknown): v is Vennoot => (VENNOTEN as readonly string[]).includes(String(v))
const tekstOfNull = (v: unknown) => (v as string | null) ?? null

function naarExtra(r: Record<string, unknown>): BudgetExtra {
  return {
    id: String(r.id), vennoten: (Array.isArray(r.vennoten) ? r.vennoten : []).filter(isV), maand: String(r.maand ?? ''), bedrag: Number(r.bedrag), reden: String(r.reden ?? ''),
    gearchiveerd_op: tekstOfNull(r.gearchiveerd_op), gearchiveerd_door: tekstOfNull(r.gearchiveerd_door), archief_reden: tekstOfNull(r.archief_reden),
    created_at: tekstOfNull(r.created_at), created_by: tekstOfNull(r.created_by),
  }
}

function naarTerugkerend(r: Record<string, unknown>): Terugkerend {
  return {
    id: String(r.id), vennoot: r.vennoot as Vennoot, omschrijving: String(r.omschrijving ?? ''), doel: tekstOfNull(r.doel), bedrag: Number(r.bedrag),
    frequentie: isFrequentie(r.frequentie) ? r.frequentie : 'maand', start_datum: String(r.start_datum).slice(0, 10), eind_datum: r.eind_datum ? String(r.eind_datum).slice(0, 10) : null,
    bewijs_pad: tekstOfNull(r.bewijs_pad), bewijs_naam: tekstOfNull(r.bewijs_naam),
    gearchiveerd_op: tekstOfNull(r.gearchiveerd_op), gearchiveerd_door: tekstOfNull(r.gearchiveerd_door), archief_reden: tekstOfNull(r.archief_reden),
    created_at: tekstOfNull(r.created_at), created_by: tekstOfNull(r.created_by),
  }
}

/** Lezen zonder te breken: een tabel die nog niet bestaat (vóór de migratie) = leeg. */
async function leesLijst<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, naar: (r: Record<string, unknown>) => T): Promise<T[]> {
  const { data, error } = await q
  if (error) { if (MIST.test(error.message)) return []; throw new Error(error.message) }
  return ((data ?? []) as Record<string, unknown>[]).map(naar)
}

export type VennotenData = {
  uitgaven: Uitgave[]
  /** Akkoord per uitgave (Marco, Bram, Chiara), op de tekst van dat moment. */
  akkoorden: UitgaveAkkoord[]
  /** Extra budget: telt pas als alle drie akkoord gaven. */
  extras: BudgetExtra[]
  extraAkkoorden: ExtraAkkoord[]
  /** Terugkerende uitgaven (lease, huur, abonnement); de betalingen rekent het model uit. */
  terugkerend: Terugkerend[]
  terugkerendAkkoorden: TerugkerendAkkoord[]
  regels: RegelsVersie | null
  handtekeningen: RegelHandtekening[]
  namen: Record<Vennoot, string>
  ik: Vennoot | null
}

export async function laadVennotenData(admin: Admin, userId: string | null): Promise<VennotenData> {
  const inst = await vennotenInstelling(admin)
  const namen = Object.fromEntries(VENNOTEN.map((k) => [k, inst[k].naam])) as Record<Vennoot, string>
  const ik = vennootVan(userId, inst)
  const [u, r] = await Promise.all([
    admin.from('vennoot_uitgaven').select('*').order('datum', { ascending: false }).limit(5000),
    admin.from('vennoot_regels').select('*').order('versie', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (u.error && MIST.test(u.error.message)) return { uitgaven: [], akkoorden: [], extras: [], extraAkkoorden: [], terugkerend: [], terugkerendAkkoorden: [], regels: null, handtekeningen: [], namen, ik }
  const regels = r.data ? naarRegels(r.data as Record<string, unknown>) : null
  let handtekeningen: RegelHandtekening[] = []
  if (regels) {
    const { data } = await admin.from('vennoot_regels_handtekeningen').select('vennoot, naam, getekend_op, inhoud_tekst, handtekening').eq('regels_id', regels.id)
    handtekeningen = (data ?? []) as RegelHandtekening[]
  }
  let akkoorden: UitgaveAkkoord[] = []
  {
    const { data, error } = await admin.from('vennoot_uitgave_akkoorden').select('uitgave_id, vennoot, naam, akkoord_op, inhoud_tekst').order('akkoord_op').limit(20000)
    if (!error) akkoorden = (data ?? []) as UitgaveAkkoord[]
  }
  const akkoord = (r: Record<string, unknown>) => ({ vennoot: r.vennoot as Vennoot, naam: tekstOfNull(r.naam), akkoord_op: String(r.akkoord_op), inhoud_tekst: String(r.inhoud_tekst) })
  const [extras, extraAkkoorden, terugkerend, terugkerendAkkoorden] = await Promise.all([
    leesLijst(admin.from('vennoot_budget_extra').select('*').order('maand', { ascending: false }).limit(2000), naarExtra),
    leesLijst(admin.from('vennoot_budget_extra_akkoorden').select('extra_id, vennoot, naam, akkoord_op, inhoud_tekst').order('akkoord_op').limit(20000), (r) => ({ ...akkoord(r), extra_id: String(r.extra_id) })),
    leesLijst(admin.from('vennoot_terugkerend').select('*').order('start_datum', { ascending: false }).limit(2000), naarTerugkerend),
    leesLijst(admin.from('vennoot_terugkerend_akkoorden').select('terugkerend_id, vennoot, naam, akkoord_op, inhoud_tekst').order('akkoord_op').limit(20000), (r) => ({ ...akkoord(r), terugkerend_id: String(r.terugkerend_id) })),
  ])
  return { uitgaven: ((u.data ?? []) as Record<string, unknown>[]).map(naarUitgave), akkoorden, extras, extraAkkoorden, terugkerend, terugkerendAkkoorden, regels, handtekeningen, namen, ik }
}

export type RegelsMetHandtekeningen = RegelsVersie & { handtekeningen: RegelHandtekening[] }

/**
 * Alle versies van de regels (nieuwste eerst, max 50), elk met wie die
 * versie tekende. Een handtekening telt enkel bij exact die tekst.
 */
export async function regelsGeschiedenis(admin: Admin): Promise<RegelsMetHandtekeningen[]> {
  const { data, error } = await admin.from('vennoot_regels').select('*').order('versie', { ascending: false }).limit(50)
  if (error) { if (MIST.test(error.message)) return []; throw new Error(error.message) }
  const versies = ((data ?? []) as Record<string, unknown>[]).map(naarRegels)
  if (!versies.length) return []
  const { data: h } = await admin.from('vennoot_regels_handtekeningen').select('regels_id, vennoot, naam, getekend_op, inhoud_tekst, handtekening').in('regels_id', versies.map((v) => v.id))
  const per = new Map<string, RegelHandtekening[]>()
  for (const x of (h ?? []) as (RegelHandtekening & { regels_id: string })[]) {
    const { regels_id, ...rest } = x
    per.set(regels_id, [...(per.get(regels_id) ?? []), rest])
  }
  return versies.map((v) => ({ ...v, handtekeningen: per.get(v.id) ?? [] }))
}

// ── Bonnetjes ────────────────────────────────────────────────────────────────

export async function bonUploadLink(admin: Admin, naam: string, grootte: number): Promise<{ pad: string; token: string; bucket: string; contentType: string }> {
  const ext = (naam.split('.').pop() ?? '').toLowerCase()
  const contentType = TYPES[ext]
  if (!contentType) throw new UitgaveFout('Kies een foto (jpg, png, heic) of een pdf.')
  if (!Number.isFinite(grootte) || grootte <= 0) throw new UitgaveFout('Leeg bestand.')
  if (grootte > MAX) throw new UitgaveFout('Het bestand is groter dan 25 MB.')
  const pad = `bonnen/${randomUUID()}/${veiligeNaam(naam)}`
  const { data, error } = await admin.storage.from(BON_BUCKET).createSignedUploadUrl(pad)
  if (error || !data?.token) throw new Error(error?.message ?? 'Uploadlink maken mislukt')
  return { pad, token: data.token as string, bucket: BON_BUCKET, contentType }
}

/** Een opgeladen bon uit een verzoek: enkel in bonnen/, en het bestand moet echt bestaan. */
async function leesBon(admin: Admin, v: unknown): Promise<{ bewijs_pad: string; bewijs_naam: string } | null> {
  if (!v || typeof v !== 'object') return null
  const { pad, naam } = v as { pad?: unknown; naam?: unknown }
  if (typeof pad !== 'string' || !BON_PAD.test(pad) || pad.includes('..')) throw new UitgaveFout('Het bonnetje is niet goed opgeladen. Probeer opnieuw.')
  const map = pad.split('/').slice(0, 2).join('/')
  const { data } = await admin.storage.from(BON_BUCKET).list(map, { limit: 5 })
  if (!(data ?? []).some((f: { name: string }) => `${map}/${f.name}` === pad)) throw new UitgaveFout('Het bonnetje is niet (volledig) opgeladen. Probeer opnieuw.')
  return { bewijs_pad: pad, bewijs_naam: typeof naam === 'string' && naam.trim() ? naam.trim().slice(0, 200) : pad.split('/').pop()! }
}

export async function bonLink(admin: Admin, pad: string): Promise<string | null> {
  if (!BON_PAD.test(pad)) return null
  // Enkel een bon die echt bij een uitgave of een terugkerende uitgave hoort.
  const [{ data: rij }, { data: tk }] = await Promise.all([
    admin.from('vennoot_uitgaven').select('id').eq('bewijs_pad', pad).limit(1),
    admin.from('vennoot_terugkerend').select('id').eq('bewijs_pad', pad).limit(1),
  ])
  if (!(rij ?? []).length && !(tk ?? []).length) return null
  const { data } = await admin.storage.from(BON_BUCKET).createSignedUrl(pad, 120)
  return data?.signedUrl ?? null
}

// ── Uitgaven ─────────────────────────────────────────────────────────────────

export async function maakUitgave(admin: Admin, b: Record<string, unknown>, door: string | null): Promise<string> {
  const v = controleerUitgave(b, vandaagBrussel())
  if (!v.ok) throw new UitgaveFout(v.fout)
  const bon = await leesBon(admin, b.bon)
  const { data, error } = await admin.from('vennoot_uitgaven').insert({ ...v.waarde, ...(bon ?? {}), created_by: door }).select('id').single()
  if (error) throw new Error(error.message)
  return String((data as { id: string }).id)
}

export async function wijzigUitgave(admin: Admin, id: string, b: Record<string, unknown>): Promise<void> {
  const v = controleerUitgave(b, vandaagBrussel())
  if (!v.ok) throw new UitgaveFout(v.fout)
  // Een nieuw bonnetje vervangt het oude; bon_weg haalt het van de uitgave (het bestand blijft bewaard).
  const bon = b.bon ? await leesBon(admin, b.bon) : b.bon_weg === true ? { bewijs_pad: null, bewijs_naam: null } : null
  const { data, error } = await admin.from('vennoot_uitgaven').update({ ...v.waarde, ...(bon ?? {}), updated_at: new Date().toISOString() }).eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!(data ?? []).length) throw new UitgaveFout('Uitgave niet gevonden.', 404)
}

export async function archiveerUitgave(admin: Admin, id: string, redenIn: unknown, door: string | null): Promise<void> {
  const reden = controleerReden(redenIn)
  if (!reden) throw new UitgaveFout('Schrijf kort waarom je de uitgave archiveert.')
  const { data, error } = await admin.from('vennoot_uitgaven').update({ gearchiveerd_op: new Date().toISOString(), gearchiveerd_door: door, archief_reden: reden }).eq('id', id).is('gearchiveerd_op', null).select('id')
  if (error) throw new Error(error.message)
  if (!(data ?? []).length) throw new UitgaveFout('Deze uitgave is al gearchiveerd.', 409)
}

export async function zetTerug(admin: Admin, id: string): Promise<void> {
  const { error } = await admin.from('vennoot_uitgaven').update({ gearchiveerd_op: null, gearchiveerd_door: null, archief_reden: null }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Akkoord van de ingelogde vennoot op de uitgave zoals ze nu is. */
export async function keurUitgaveGoed(admin: Admin, id: string, inv: { userId: string; naam: string | null; ip: string | null; ua: string | null }): Promise<void> {
  const wie = vennootVan(inv.userId, await vennotenInstelling(admin))
  if (!wie) throw new UitgaveFout('Enkel Marco, Bram en Chiara geven akkoord, elk met hun eigen account.', 403)
  const { data } = await admin.from('vennoot_uitgaven').select('*').eq('id', id).maybeSingle()
  if (!data) throw new UitgaveFout('Uitgave niet gevonden.', 404)
  const u = naarUitgave(data as Record<string, unknown>)
  if (u.gearchiveerd_op) throw new UitgaveFout('Een gearchiveerde uitgave telt niet mee; daar is geen akkoord voor nodig.', 409)
  const { error } = await admin.from('vennoot_uitgave_akkoorden').insert({ uitgave_id: id, vennoot: wie, user_id: inv.userId, naam: inv.naam, inhoud_tekst: uitgaveTekst(u), ip: inv.ip, user_agent: inv.ua?.slice(0, 400) ?? null })
  if (error && !/duplicate|23505/i.test(`${error.code} ${error.message}`)) throw new Error(error.message)
}

/** Melding per vennoot: uitgaven, extra budget en terugkerende uitgaven die op jouw akkoord wachten. */
export async function uitgavenMeldingVoor(userId: string, admin: Admin): Promise<{ id: string; kind: string; priority: 'high' | 'med'; title: string; date: string | null; href: string }[]> {
  const data = await laadVennotenData(admin, userId)
  if (!data.ik) return []
  const open = openAkkoorden(data, data.ik)
  if (!open.totaal) return []
  const laatste = [...open.uitgaven.map((u) => u.created_at ?? u.datum), ...open.extras.map((e) => e.created_at ?? ''), ...open.terugkerend.map((t) => t.created_at ?? t.start_datum)].filter(Boolean).sort().pop() ?? null
  return [{ id: `vennoot-uitgaven:${data.ik}:${open.totaal}:${laatste}`, kind: 'vennoten', priority: open.extras.length ? 'high' : 'med', title: `${openAkkoordenTekst(open)} ${open.totaal === 1 ? 'wacht' : 'wachten'} op jouw akkoord`, date: laatste ? laatste.slice(0, 10) : null, href: '/admin/vennoten?akkoord=1' }]
}

// ── Akkoord (extra budget, terugkerende uitgaven) ────────────────────────────

type AkkoordInvoer = { userId: string; naam: string | null; ip: string | null; ua: string | null }

/**
 * Akkoord van de ingelogde vennoot op exact deze tekst. Wie iets voorstelt of
 * aanpast gaat er zelf mee akkoord (`stil`: geen fout als het geen vennoot is).
 */
async function voegAkkoordToe(admin: Admin, tabel: 'vennoot_budget_extra_akkoorden' | 'vennoot_terugkerend_akkoorden', kolom: 'extra_id' | 'terugkerend_id', id: string, tekst: string, inv: AkkoordInvoer, stil = false): Promise<void> {
  const wie = vennootVan(inv.userId, await vennotenInstelling(admin))
  if (!wie) { if (stil) return; throw new UitgaveFout('Enkel Marco, Bram en Chiara geven akkoord, elk met hun eigen account.', 403) }
  const { error } = await admin.from(tabel).insert({ [kolom]: id, vennoot: wie, user_id: inv.userId, naam: inv.naam, inhoud_tekst: tekst, ip: inv.ip, user_agent: inv.ua?.slice(0, 400) ?? null })
  if (error && !/duplicate|23505/i.test(`${error.code} ${error.message}`)) throw new Error(error.message)
}

// ── Extra budget ─────────────────────────────────────────────────────────────

async function leesExtra(admin: Admin, id: string): Promise<BudgetExtra> {
  const { data, error } = await admin.from('vennoot_budget_extra').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new UitgaveFout('Extra budget niet gevonden.', 404)
  return naarExtra(data as Record<string, unknown>)
}

export async function maakExtra(admin: Admin, b: Record<string, unknown>, inv: AkkoordInvoer): Promise<string> {
  const v = controleerExtra(b)
  if (!v.ok) throw new UitgaveFout(v.fout)
  const { data, error } = await admin.from('vennoot_budget_extra').insert({ ...v.waarde, created_by: inv.naam }).select('*').single()
  if (error) throw new Error(error.message)
  const e = naarExtra(data as Record<string, unknown>)
  await voegAkkoordToe(admin, 'vennoot_budget_extra_akkoorden', 'extra_id', e.id, extraTekst(e), inv, true)
  return e.id
}

export async function wijzigExtra(admin: Admin, id: string, b: Record<string, unknown>, inv: AkkoordInvoer): Promise<void> {
  const v = controleerExtra(b)
  if (!v.ok) throw new UitgaveFout(v.fout)
  const oud = await leesExtra(admin, id)
  if (oud.gearchiveerd_op) throw new UitgaveFout('Dit extra budget is geschrapt. Zet het eerst terug.', 409)
  const { data, error } = await admin.from('vennoot_budget_extra').update({ ...v.waarde, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  const e = naarExtra(data as Record<string, unknown>)
  await voegAkkoordToe(admin, 'vennoot_budget_extra_akkoorden', 'extra_id', e.id, extraTekst(e), inv, true)
}

export async function archiveerExtra(admin: Admin, id: string, redenIn: unknown, door: string | null): Promise<void> {
  const reden = controleerReden(redenIn)
  if (!reden) throw new UitgaveFout('Schrijf kort waarom je dit extra budget schrapt.')
  const { data, error } = await admin.from('vennoot_budget_extra').update({ gearchiveerd_op: new Date().toISOString(), gearchiveerd_door: door, archief_reden: reden }).eq('id', id).is('gearchiveerd_op', null).select('id')
  if (error) throw new Error(error.message)
  if (!(data ?? []).length) throw new UitgaveFout('Dit extra budget is al geschrapt.', 409)
}

export async function zetExtraTerug(admin: Admin, id: string): Promise<void> {
  const { error } = await admin.from('vennoot_budget_extra').update({ gearchiveerd_op: null, gearchiveerd_door: null, archief_reden: null }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function keurExtraGoed(admin: Admin, id: string, inv: AkkoordInvoer): Promise<void> {
  const e = await leesExtra(admin, id)
  if (e.gearchiveerd_op) throw new UitgaveFout('Dit extra budget is geschrapt; daar is geen akkoord voor nodig.', 409)
  await voegAkkoordToe(admin, 'vennoot_budget_extra_akkoorden', 'extra_id', id, extraTekst(e), inv)
}

// ── Terugkerende uitgaven ────────────────────────────────────────────────────

async function leesTerugkerend(admin: Admin, id: string): Promise<Terugkerend> {
  const { data, error } = await admin.from('vennoot_terugkerend').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new UitgaveFout('Terugkerende uitgave niet gevonden.', 404)
  return naarTerugkerend(data as Record<string, unknown>)
}

export async function maakTerugkerend(admin: Admin, b: Record<string, unknown>, inv: AkkoordInvoer): Promise<string> {
  const v = controleerTerugkerend(b)
  if (!v.ok) throw new UitgaveFout(v.fout)
  const bon = await leesBon(admin, b.bon)
  const { data, error } = await admin.from('vennoot_terugkerend').insert({ ...v.waarde, ...(bon ?? {}), created_by: inv.naam }).select('*').single()
  if (error) throw new Error(error.message)
  const t = naarTerugkerend(data as Record<string, unknown>)
  await voegAkkoordToe(admin, 'vennoot_terugkerend_akkoorden', 'terugkerend_id', t.id, terugkerendTekst(t), inv, true)
  return t.id
}

export async function wijzigTerugkerend(admin: Admin, id: string, b: Record<string, unknown>, inv: AkkoordInvoer): Promise<void> {
  const v = controleerTerugkerend(b)
  if (!v.ok) throw new UitgaveFout(v.fout)
  const oud = await leesTerugkerend(admin, id)
  if (oud.gearchiveerd_op) throw new UitgaveFout('Deze terugkerende uitgave is geschrapt. Zet ze eerst terug.', 409)
  const bon = b.bon ? await leesBon(admin, b.bon) : b.bon_weg === true ? { bewijs_pad: null, bewijs_naam: null } : null
  const { data, error } = await admin.from('vennoot_terugkerend').update({ ...v.waarde, ...(bon ?? {}), updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  const t = naarTerugkerend(data as Record<string, unknown>)
  await voegAkkoordToe(admin, 'vennoot_terugkerend_akkoorden', 'terugkerend_id', t.id, terugkerendTekst(t), inv, true)
}

/** Stoppen: de laatste betaling die nog telt is die tot en met `datum` (standaard vandaag). */
export async function stopTerugkerend(admin: Admin, id: string, datumIn: unknown, inv: AkkoordInvoer): Promise<void> {
  const oud = await leesTerugkerend(admin, id)
  if (oud.gearchiveerd_op) throw new UitgaveFout('Deze terugkerende uitgave is geschrapt.', 409)
  const datum = typeof datumIn === 'string' && datumIn ? datumIn : vandaagBrussel()
  const v = controleerTerugkerend({ ...oud, eind_datum: datum })
  if (!v.ok) throw new UitgaveFout(datum < oud.start_datum ? 'Er werd nog niets betaald. Schrap de uitgave in de plaats van te stoppen.' : v.fout)
  const { data, error } = await admin.from('vennoot_terugkerend').update({ eind_datum: v.waarde.eind_datum, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  const t = naarTerugkerend(data as Record<string, unknown>)
  await voegAkkoordToe(admin, 'vennoot_terugkerend_akkoorden', 'terugkerend_id', t.id, terugkerendTekst(t), inv, true)
}

export async function archiveerTerugkerend(admin: Admin, id: string, redenIn: unknown, door: string | null): Promise<void> {
  const reden = controleerReden(redenIn)
  if (!reden) throw new UitgaveFout('Schrijf kort waarom je deze terugkerende uitgave schrapt.')
  const { data, error } = await admin.from('vennoot_terugkerend').update({ gearchiveerd_op: new Date().toISOString(), gearchiveerd_door: door, archief_reden: reden }).eq('id', id).is('gearchiveerd_op', null).select('id')
  if (error) throw new Error(error.message)
  if (!(data ?? []).length) throw new UitgaveFout('Deze terugkerende uitgave is al geschrapt.', 409)
}

export async function zetTerugkerendTerug(admin: Admin, id: string): Promise<void> {
  const { error } = await admin.from('vennoot_terugkerend').update({ gearchiveerd_op: null, gearchiveerd_door: null, archief_reden: null }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function keurTerugkerendGoed(admin: Admin, id: string, inv: AkkoordInvoer): Promise<void> {
  const t = await leesTerugkerend(admin, id)
  if (t.gearchiveerd_op) throw new UitgaveFout('Deze terugkerende uitgave is geschrapt; daar is geen akkoord voor nodig.', 409)
  await voegAkkoordToe(admin, 'vennoot_terugkerend_akkoorden', 'terugkerend_id', id, terugkerendTekst(t), inv)
}

// ── Regels ───────────────────────────────────────────────────────────────────

/** Een nieuwe versie van de regels; alle drie tekenen daarna opnieuw. */
export async function nieuweRegels(admin: Admin, b: Record<string, unknown>, door: string | null): Promise<RegelsVersie> {
  const v = controleerRegels(b)
  if (!v.ok) throw new UitgaveFout(v.fout)
  const { data: laatste } = await admin.from('vennoot_regels').select('versie').order('versie', { ascending: false }).limit(1).maybeSingle()
  const versie = Number((laatste as { versie?: number } | null)?.versie ?? 0) + 1
  const { data, error } = await admin.from('vennoot_regels').insert({ versie, regels: v.waarde.regels, maandbudget: v.waarde.maandbudget, start_maand: v.waarde.start_maand, created_by: door }).select('*').single()
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new UitgaveFout('Iemand anders paste de regels net aan. Herlaad de pagina.', 409)
    throw new Error(error.message)
  }
  return naarRegels(data as Record<string, unknown>)
}

/** Een vennoot tekent de huidige versie, met zijn of haar eigen account. */
export async function tekenRegels(admin: Admin, regelsId: string, inv: { userId: string; email: string | null; naam: string | null; handtekening: unknown; ip: string | null; ua: string | null }): Promise<void> {
  const inst = await vennotenInstelling(admin)
  const vennoot = vennootVan(inv.userId, inst)
  if (!vennoot) throw new UitgaveFout('Enkel Marco, Bram en Chiara tekenen de regels, elk met hun eigen account.', 403)
  const { data: laatste } = await admin.from('vennoot_regels').select('*').order('versie', { ascending: false }).limit(1).maybeSingle()
  if (!laatste || String((laatste as { id: string }).id) !== regelsId) throw new UitgaveFout('De regels werden intussen aangepast. Herlaad de pagina en lees ze opnieuw.', 409)
  const hand = leesHandtekening(inv.handtekening)
  if (!hand.ok) throw new UitgaveFout(hand.fout)
  const regels = naarRegels(laatste as Record<string, unknown>)
  const { error } = await admin.from('vennoot_regels_handtekeningen').insert({
    regels_id: regels.id, vennoot, user_id: inv.userId, naam: inv.naam ?? inst[vennoot].naam, email: inv.email,
    inhoud_tekst: regelsTekst(regels), handtekening: `data:image/png;base64,${hand.base64}`, ip: inv.ip, user_agent: inv.ua?.slice(0, 400) ?? null,
  })
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new UitgaveFout('Je tekende deze versie al.', 409)
    throw new Error(error.message)
  }
}

/** Melding "wacht op jouw handtekening" voor een vennoot die de huidige regels nog niet tekende. */
export async function regelsMeldingVoor(userId: string, admin: Admin): Promise<{ id: string; kind: string; priority: 'high' | 'med'; title: string; date: string | null; href: string }[]> {
  const d = await laadVennotenData(admin, userId)
  if (!d.ik || !d.regels) return []
  if (tekenStand(d.regels, d.handtekeningen)[d.ik]) return []
  return [{ id: `vennoot-regels:${d.ik}:${d.regels.versie}`, kind: 'vennoten', priority: 'high', title: `Uitgaven vennoten: de regels (versie ${d.regels.versie}) wachten op jouw handtekening`, date: null, href: '/admin/vennoten?regels=1' }]
}

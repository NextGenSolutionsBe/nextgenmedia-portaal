import 'server-only'
import { randomUUID } from 'crypto'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { VENNOTEN_SLEUTEL, leesVennoten, vennootVan } from '@/lib/vesting-akkoord'
import { leesHandtekening } from '@/lib/contracten/tegenhandtekening'
import {
  VENNOTEN, controleerReden, controleerRegels, controleerUitgave, regelsTekst, tekenStand, uitgaveTekst, wachtOpAkkoord,
  type RegelHandtekening, type RegelsVersie, type Uitgave, type UitgaveAkkoord, type Vennoot,
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

export type VennotenData = {
  uitgaven: Uitgave[]
  /** Akkoord per uitgave (Marco, Bram, Chiara), op de tekst van dat moment. */
  akkoorden: UitgaveAkkoord[]
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
  if (u.error && MIST.test(u.error.message)) return { uitgaven: [], akkoorden: [], regels: null, handtekeningen: [], namen, ik }
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
  return { uitgaven: ((u.data ?? []) as Record<string, unknown>[]).map(naarUitgave), akkoorden, regels, handtekeningen, namen, ik }
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
  const { data: rij } = await admin.from('vennoot_uitgaven').select('id').eq('bewijs_pad', pad).limit(1)
  if (!(rij ?? []).length) return null
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
  const bon = b.bon ? await leesBon(admin, b.bon) : null
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

/** Melding per vennoot: uitgaven die op jouw akkoord wachten. */
export async function uitgavenMeldingVoor(userId: string, admin: Admin): Promise<{ id: string; kind: string; priority: 'high' | 'med'; title: string; date: string | null; href: string }[]> {
  const data = await laadVennotenData(admin, userId)
  if (!data.ik) return []
  const wacht = wachtOpAkkoord(data.uitgaven, data.akkoorden, data.ik)
  if (!wacht.length) return []
  const laatste = wacht.map((u) => u.created_at ?? u.datum).sort().pop() ?? null
  return [{ id: `vennoot-uitgaven:${data.ik}:${wacht.length}:${laatste}`, kind: 'vennoten', priority: 'med', title: `${wacht.length} ${wacht.length === 1 ? 'uitgave wacht' : 'uitgaven wachten'} op jouw akkoord`, date: laatste ? laatste.slice(0, 10) : null, href: '/admin/vennoten?akkoord=1' }]
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

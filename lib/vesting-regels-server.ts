import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { VENNOTEN, VENNOTEN_SLEUTEL, leesVennoten, vennootVan, type Vennoot } from '@/lib/vesting-akkoord'
import { leesHandtekening } from '@/lib/contracten/tegenhandtekening'
import {
  controleerVestingRegels, tekenStandVoor, vestingRegelsTekst,
  type AlgemeneRegelsVersie, type RegelHandtekening, type RegelsData,
} from '@/lib/regels-akkoord'

type Admin = ReturnType<typeof createAdminSupabaseClient>

/**
 * Regels vesting (serverkant): zelfde werking als de regels bij Uitgaven
 * vennoten. Elke aanpassing is een nieuwe versie (`vesting_regels`), Marco,
 * Bram en Chiara tekenen elk met hun eigen account (`app_settings.vesting_vennoten`);
 * handtekeningen worden enkel toegevoegd, nooit gewijzigd.
 */

export class RegelsFout extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

const MIST = /vesting_regels|does not exist|schema cache/i

function naarVersie(r: Record<string, unknown>): AlgemeneRegelsVersie {
  return {
    id: String(r.id), versie: Number(r.versie), regels: Array.isArray(r.regels) ? (r.regels as unknown[]).map(String) : [],
    created_at: (r.created_at as string | null) ?? null, created_by: (r.created_by as string | null) ?? null,
  }
}

async function vennoten(admin: Admin) {
  const { data } = await admin.from('app_settings').select('value').eq('key', VENNOTEN_SLEUTEL).maybeSingle()
  return leesVennoten((data as { value?: unknown } | null)?.value)
}

/** De geldende versie (of geen), wie ze tekende, de namen en wie jij bent. */
export async function laadVestingRegels(admin: Admin, userId: string | null): Promise<RegelsData> {
  const inst = await vennoten(admin)
  const namen = Object.fromEntries(VENNOTEN.map((k) => [k, inst[k].naam])) as Record<Vennoot, string>
  const ik = vennootVan(userId, inst)
  const { data, error } = await admin.from('vesting_regels').select('*').order('versie', { ascending: false }).limit(1).maybeSingle()
  if (error) { if (MIST.test(error.message)) return { versie: null, handtekeningen: [], namen, ik }; throw new Error(error.message) }
  const versie = data ? naarVersie(data as Record<string, unknown>) : null
  let handtekeningen: RegelHandtekening[] = []
  if (versie) {
    const { data: h } = await admin.from('vesting_regels_handtekeningen').select('vennoot, naam, getekend_op, inhoud_tekst, handtekening').eq('regels_id', versie.id)
    handtekeningen = (h ?? []) as RegelHandtekening[]
  }
  return { versie, handtekeningen, namen, ik }
}

/** Een nieuwe versie; alle drie tekenen daarna opnieuw. */
export async function nieuweVestingRegels(admin: Admin, b: Record<string, unknown>, door: string | null): Promise<AlgemeneRegelsVersie> {
  const v = controleerVestingRegels(b)
  if (!v.ok) throw new RegelsFout(v.fout)
  const { data: laatste } = await admin.from('vesting_regels').select('versie').order('versie', { ascending: false }).limit(1).maybeSingle()
  const versie = Number((laatste as { versie?: number } | null)?.versie ?? 0) + 1
  const { data, error } = await admin.from('vesting_regels').insert({ versie, regels: v.waarde.regels, created_by: door }).select('*').single()
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new RegelsFout('Iemand anders paste de regels net aan. Herlaad de pagina.', 409)
    throw new Error(error.message)
  }
  return naarVersie(data as Record<string, unknown>)
}

/** Een vennoot tekent de geldende versie, met zijn of haar eigen account. */
export async function tekenVestingRegels(admin: Admin, regelsId: string, inv: { userId: string; email: string | null; naam: string | null; handtekening: unknown; ip: string | null; ua: string | null }): Promise<void> {
  const inst = await vennoten(admin)
  const vennoot = vennootVan(inv.userId, inst)
  if (!vennoot) throw new RegelsFout('Enkel Marco, Bram en Chiara tekenen de regels, elk met hun eigen account.', 403)
  const { data: laatste } = await admin.from('vesting_regels').select('*').order('versie', { ascending: false }).limit(1).maybeSingle()
  if (!laatste || String((laatste as { id: string }).id) !== regelsId) throw new RegelsFout('De regels werden intussen aangepast. Herlaad de pagina en lees ze opnieuw.', 409)
  const hand = leesHandtekening(inv.handtekening)
  if (!hand.ok) throw new RegelsFout(hand.fout)
  const versie = naarVersie(laatste as Record<string, unknown>)
  const { error } = await admin.from('vesting_regels_handtekeningen').insert({
    regels_id: versie.id, vennoot, user_id: inv.userId, naam: inv.naam ?? inst[vennoot].naam, email: inv.email,
    inhoud_tekst: vestingRegelsTekst(versie), handtekening: `data:image/png;base64,${hand.base64}`, ip: inv.ip, user_agent: inv.ua?.slice(0, 400) ?? null,
  })
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new RegelsFout('Je tekende deze versie al.', 409)
    throw new Error(error.message)
  }
}

export type VersieMetHandtekeningen = AlgemeneRegelsVersie & { handtekeningen: RegelHandtekening[] }

/** Alle versies (nieuwste eerst, max 50) met wie welke versie tekende. */
export async function vestingRegelsGeschiedenis(admin: Admin): Promise<VersieMetHandtekeningen[]> {
  const { data, error } = await admin.from('vesting_regels').select('*').order('versie', { ascending: false }).limit(50)
  if (error) { if (MIST.test(error.message)) return []; throw new Error(error.message) }
  const versies = ((data ?? []) as Record<string, unknown>[]).map(naarVersie)
  if (!versies.length) return []
  const { data: h } = await admin.from('vesting_regels_handtekeningen').select('regels_id, vennoot, naam, getekend_op, inhoud_tekst, handtekening').in('regels_id', versies.map((v) => v.id))
  const per = new Map<string, RegelHandtekening[]>()
  for (const x of (h ?? []) as (RegelHandtekening & { regels_id: string })[]) {
    const { regels_id, ...rest } = x
    per.set(regels_id, [...(per.get(regels_id) ?? []), rest])
  }
  return versies.map((v) => ({ ...v, handtekeningen: per.get(v.id) ?? [] }))
}

/** Melding "wacht op jouw handtekening" voor een vennoot die de geldende vestingregels nog niet tekende. */
export async function vestingRegelsMeldingVoor(userId: string, admin: Admin): Promise<{ id: string; kind: string; priority: 'high' | 'med'; title: string; date: string | null; href: string }[]> {
  const d = await laadVestingRegels(admin, userId)
  if (!d.ik || !d.versie) return []
  if (tekenStandVoor('vesting', d.versie, d.handtekeningen)[d.ik]) return []
  return [{ id: `vesting-regels:${d.ik}:${d.versie.versie}`, kind: 'vesting', priority: 'high', title: `Vesting: de regels (versie ${d.versie.versie}) wachten op jouw handtekening`, date: null, href: '/admin/vesting?regels=1' }]
}

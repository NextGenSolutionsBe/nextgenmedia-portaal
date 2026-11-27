import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { gewerkteMinuten, type Pauze } from '@/lib/personeel/tijd'
import { BAN_DUUR } from '@/lib/instellingen/medewerkers'
import {
  START_SJABLONEN, naarSjabloon, stappenErbij, studentStand, inJaar, controleerProfiel, offboardingPunten,
  type RolSjabloon, type OnboardingStap, type Functieprofiel, type StudentStand, type OffboardingStand,
} from './rollen'

/**
 * Rollen, onboarding, offboarding, functieprofiel en studenturen op de server
 * (verbeterplan fase 4). Nooit iets verwijderen: offboarding blokkeert enkel de
 * login en zet een einddatum; taken, dossier en geschiedenis blijven.
 * Zonder de migratie werkt alles verder met de startsjablonen uit de code.
 */
type Admin = SupabaseClient

export async function laadSjablonen(admin: Admin, metInactief = false): Promise<RolSjabloon[]> {
  const { data, error } = await admin.from('rol_sjablonen').select('*').order('volgorde', { ascending: true })
  if (error || !data?.length) return START_SJABLONEN
  const lijst = (data as Record<string, unknown>[]).map(naarSjabloon)
  return metInactief ? lijst : lijst.filter((s) => s.actief)
}

export async function bewaarSjabloon(admin: Admin, s: RolSjabloon, door: string): Promise<void> {
  const { error } = await admin.from('rol_sjablonen').upsert({
    key: s.key, naam: s.naam, omschrijving: s.omschrijving, rol: s.rol, modules: s.modules, bedrijven: s.bedrijven,
    onboarding: s.onboarding, startpagina: s.startpagina, volgorde: s.volgorde, actief: s.actief, standaard: s.standaard,
    gewijzigd_door: door, updated_at: new Date().toISOString(),
  }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
}

// ── Onboarding ───────────────────────────────────────────────────────────────

export async function onboardingVan(admin: Admin, staffId: string): Promise<OnboardingStap[]> {
  const { data, error } = await admin.from('onboarding_stappen').select('id, titel, volgorde, gedaan_op, gedaan_door').eq('staff_id', staffId).order('volgorde', { ascending: true })
  if (error) return []
  return (data ?? []) as OnboardingStap[]
}

/** Voortgang van iedereen tegelijk (voor het overzicht): staff_id → { gedaan, totaal }. */
export async function onboardingOverzicht(admin: Admin): Promise<Map<string, { gedaan: number; totaal: number }>> {
  const { data, error } = await admin.from('onboarding_stappen').select('staff_id, gedaan_op').limit(5000)
  const uit = new Map<string, { gedaan: number; totaal: number }>()
  if (error) return uit
  for (const r of (data ?? []) as { staff_id: string; gedaan_op: string | null }[]) {
    const v = uit.get(r.staff_id) ?? { gedaan: 0, totaal: 0 }
    v.totaal++; if (r.gedaan_op) v.gedaan++
    uit.set(r.staff_id, v)
  }
  return uit
}

/** Stappen toevoegen (zonder dubbels). Geeft het aantal nieuwe stappen. */
export async function stappenToevoegen(admin: Admin, staffId: string, titels: string[]): Promise<number> {
  const bestaand = await onboardingVan(admin, staffId)
  const nieuw = stappenErbij(bestaand, titels)
  if (!nieuw.length) return 0
  const start = bestaand.reduce((m, s) => Math.max(m, s.volgorde), 0)
  const { error } = await admin.from('onboarding_stappen').insert(nieuw.map((titel, i) => ({ staff_id: staffId, titel, volgorde: start + i + 1 })))
  if (error) throw new Error(error.message)
  return nieuw.length
}

/** Een stap afvinken of terugzetten. Wie het mag, beslist de route. */
export async function zetStap(admin: Admin, staffId: string, stapId: string, gedaan: boolean, door: string): Promise<void> {
  const { error } = await admin.from('onboarding_stappen')
    .update({ gedaan_op: gedaan ? new Date().toISOString() : null, gedaan_door: gedaan ? door : null })
    .eq('id', stapId).eq('staff_id', staffId)
  if (error) throw new Error(error.message)
}

// ── Offboarding ──────────────────────────────────────────────────────────────

type StaffRij = { id: string; auth_user_id: string | null; email: string | null; active: boolean; eind_datum?: string | null; offboarding_op?: string | null; offboarding_door?: string | null; offboarding_notitie?: string | null }

async function staffRij(admin: Admin, staffId: string): Promise<StaffRij> {
  let r = await admin.from('staff_members').select('id, auth_user_id, email, active, eind_datum, offboarding_op, offboarding_door, offboarding_notitie').eq('id', staffId).maybeSingle()
  if (r.error) r = await admin.from('staff_members').select('id, auth_user_id, email, active').eq('id', staffId).maybeSingle()
  if (!r.data) throw new Error('Medewerker niet gevonden.')
  return r.data as StaffRij
}

export type Offboarding = { stand: OffboardingStand; punten: { tekst: string; open: boolean }[]; op: string | null; door: string | null; notitie: string | null; taken: { id: string; titel: string }[] }

/** Wat er bij het vertrek van iemand nog openstaat. Enkel lezen. */
export async function offboardingVan(admin: Admin, staffId: string): Promise<Offboarding> {
  const s = await staffRij(admin, staffId)
  const uid = s.auth_user_id
  const [user, persoon, onboarding, dossier] = await Promise.all([
    uid ? admin.auth.admin.getUserById(uid).then((r) => r.data?.user ?? null).catch(() => null) : Promise.resolve(null),
    uid ? admin.from('ag_personen').select('id').eq('user_id', uid).maybeSingle().then((r) => (r.data as { id: string } | null)?.id ?? null) : Promise.resolve(null),
    onboardingVan(admin, staffId),
    uid ? admin.from('personeel').select('id').eq('auth_user_id', uid).maybeSingle().then((r) => (r.data as { id: string } | null)?.id ?? null) : Promise.resolve(null),
  ])
  const geblokkeerd = !!(user as { banned_until?: string | null } | null)?.banned_until && new Date((user as { banned_until: string }).banned_until).getTime() > Date.now()
  const [taken, ical, sessie] = await Promise.all([
    persoon ? openTakenVan(admin, persoon) : Promise.resolve([]),
    persoon ? admin.from('ag_ical_links').select('id', { count: 'exact', head: true }).eq('persoon_id', persoon).is('ingetrokken_op', null).then((r) => r.count ?? 0) : Promise.resolve(0),
    dossier ? admin.from('personeel_sessies').select('id', { count: 'exact', head: true }).eq('personeel_id', dossier).eq('status', 'actief').then((r) => (r.count ?? 0) > 0) : Promise.resolve(false),
  ])
  const stand: OffboardingStand = {
    login: !!uid && s.active !== false && !geblokkeerd, openTaken: taken.length, openOnboarding: onboarding.filter((x) => !x.gedaan_op).length,
    icalLinks: ical, lopendeSessie: sessie, eindDatum: s.eind_datum ?? null,
  }
  return { stand, punten: offboardingPunten(stand), op: s.offboarding_op ?? null, door: s.offboarding_door ?? null, notitie: s.offboarding_notitie ?? null, taken: taken.slice(0, 30) }
}

async function openTakenVan(admin: Admin, persoonId: string): Promise<{ id: string; titel: string }[]> {
  const { data: t } = await admin.from('ag_toegewezen').select('item_id').eq('persoon_id', persoonId).limit(2000)
  const ids = ((t ?? []) as { item_id: string }[]).map((x) => x.item_id)
  const uit: { id: string; titel: string }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('ag_items').select('id, titel').in('id', ids.slice(i, i + 200)).eq('status', 'open').is('verwijderd_op', null)
    uit.push(...((data ?? []) as { id: string; titel: string }[]))
  }
  return uit
}

/**
 * Iemand laten vertrekken: einddatum, login blokkeren, agenda-abonnementen intrekken.
 * Niets wordt verwijderd: open taken, dossier, uren en geschiedenis blijven staan.
 */
export async function offboarden(admin: Admin, staffId: string, o: { eind_datum: string | null; notitie: string | null; blokkeren: boolean; icalIntrekken: boolean }, door: string, eigenUid: string): Promise<string[]> {
  const s = await staffRij(admin, staffId)
  if (o.blokkeren && s.auth_user_id === eigenUid) throw new Error('Je kunt je eigen account niet blokkeren.')
  const gedaan: string[] = []
  const nu = new Date().toISOString()
  const patch: Record<string, unknown> = { offboarding_op: nu, offboarding_door: door, offboarding_notitie: o.notitie, updated_at: nu }
  if (o.eind_datum) patch.eind_datum = o.eind_datum
  if (o.blokkeren) patch.active = false
  const { error } = await admin.from('staff_members').update(patch).eq('id', staffId)
  if (error) throw new Error(error.message)
  if (o.eind_datum) gedaan.push(`einddatum ${o.eind_datum}`)
  if (o.blokkeren && s.auth_user_id) {
    await admin.auth.admin.updateUserById(s.auth_user_id, { ban_duration: BAN_DUUR }).catch(() => {})
    gedaan.push('login geblokkeerd')
  }
  if (o.icalIntrekken && s.auth_user_id) {
    const { data: p } = await admin.from('ag_personen').select('id').eq('user_id', s.auth_user_id).maybeSingle()
    if (p) {
      await admin.from('ag_ical_links').update({ ingetrokken_op: nu }).eq('persoon_id', (p as { id: string }).id).is('ingetrokken_op', null)
      gedaan.push('agenda-abonnementen ingetrokken')
    }
  }
  return gedaan
}

// ── Functieprofiel ───────────────────────────────────────────────────────────

export async function functieprofielVan(admin: Admin, personeelId: string): Promise<Functieprofiel | null> {
  const { data, error } = await admin.from('personeel').select('functieprofiel').eq('id', personeelId).maybeSingle()
  if (error || !data) return null
  const p = (data as { functieprofiel: unknown }).functieprofiel
  return p ? controleerProfiel(p) : null
}

export async function bewaarFunctieprofiel(admin: Admin, personeelId: string, p: Functieprofiel): Promise<void> {
  const { error } = await admin.from('personeel').update({ functieprofiel: p, updated_at: new Date().toISOString() }).eq('id', personeelId)
  if (error) throw new Error(/functieprofiel/.test(error.message) ? 'Het functieprofiel kan pas bewaard worden na de update van de databank.' : error.message)
}

// ── Studenten ────────────────────────────────────────────────────────────────

/** Gewerkte uren van een student dit kalenderjaar (alle sessies behalve afgekeurde). */
export async function studentUren(admin: Admin, personeelId: string, jaar = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric' }).format(new Date()))): Promise<StudentStand> {
  const { data } = await admin.from('personeel_sessies').select('start_at, eind_at, pauzes, status')
    .eq('personeel_id', personeelId).gte('start_at', `${jaar - 1}-12-31T00:00:00Z`).lt('start_at', `${jaar + 1}-01-01T12:00:00Z`).limit(5000)
  let min = 0
  for (const s of (data ?? []) as { start_at: string; eind_at: string | null; pauzes: Pauze[] | null; status: string }[]) {
    if (s.status === 'afgekeurd' || !inJaar(s.start_at, jaar)) continue
    min += gewerkteMinuten(s)
  }
  return studentStand(min)
}

/** Alle actieve studenten met hun stand (voor meldingen). */
export async function studentenStand(admin: Admin): Promise<{ id: string; naam: string; stand: StudentStand }[]> {
  const { data } = await admin.from('personeel').select('id, voornaam, achternaam').eq('type', 'student').eq('actief', true)
  const lijst = (data ?? []) as { id: string; voornaam: string | null; achternaam: string | null }[]
  return Promise.all(lijst.map(async (p) => ({ id: p.id, naam: `${p.voornaam ?? ''} ${p.achternaam ?? ''}`.trim() || 'Student', stand: await studentUren(admin, p.id) })))
}

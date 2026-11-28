import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { naamSleutel, type Persoon } from '@/lib/agenda/model'

type Admin = SupabaseClient

/**
 * Iedereen met een account in de app (zaakvoerders en medewerkers) als persoon
 * in de agenda, gekoppeld aan zijn ClickUp-lid als dat er is (op e-mail of op
 * naam: Bram en Chiara hebben in ClickUp een ander e-mailadres dan in de app).
 */
export async function zorgVoorPersonen(admin: Admin): Promise<Persoon[]> {
  const [rollen, staff, bestaand] = await Promise.all([
    admin.from('user_roles').select('user_id, role').eq('role', 'admin'),
    admin.from('staff_members').select('auth_user_id, name, voornaam, achternaam, email, active, verwijderd_at'),
    admin.from('ag_personen').select('id, user_id, clickup_id, naam, email, kleur, actief'),
  ])
  const personen = (bestaand.data ?? []) as Persoon[] & { clickup_id?: number | null }[]
  const metUser = new Map(personen.filter((p) => p.user_id).map((p) => [p.user_id!, p]))

  const appGebruikers: { user_id: string; naam: string; email: string | null; actief: boolean }[] = []
  for (const r of (rollen.data ?? []) as { user_id: string }[]) {
    const { data } = await admin.auth.admin.getUserById(r.user_id)
    const u = data?.user
    if (!u) continue
    const md = (u.user_metadata ?? {}) as Record<string, unknown>
    const naam = String(md.full_name ?? md.name ?? [md.voornaam, md.achternaam].filter(Boolean).join(' ') ?? '').trim() || (u.email ?? 'Teamlid')
    appGebruikers.push({ user_id: u.id, naam, email: u.email?.toLowerCase() ?? null, actief: true })
  }
  for (const s of (staff.data ?? []) as { auth_user_id: string | null; name: string | null; voornaam: string | null; achternaam: string | null; email: string | null; active: boolean | null; verwijderd_at: string | null }[]) {
    if (!s.auth_user_id) continue
    const naam = (s.name || [s.voornaam, s.achternaam].filter(Boolean).join(' ')).trim() || (s.email ?? 'Medewerker')
    appGebruikers.push({ user_id: s.auth_user_id, naam, email: s.email?.toLowerCase() ?? null, actief: s.active !== false && !s.verwijderd_at })
  }

  for (const g of appGebruikers) {
    const al = metUser.get(g.user_id)
    if (al) {
      if (al.actief !== g.actief || (!al.email && g.email)) await admin.from('ag_personen').update({ actief: g.actief, email: al.email ?? g.email, updated_at: new Date().toISOString() }).eq('id', al.id)
      continue
    }
    // Een ClickUp-lid zonder account met dezelfde e-mail of naam? Dan koppelen in plaats van een tweede persoon.
    const zelfde = personen.find((p) => !p.user_id && ((g.email && p.email?.toLowerCase() === g.email) || naamSleutel(p.naam) === naamSleutel(g.naam)))
    if (zelfde) {
      await admin.from('ag_personen').update({ user_id: g.user_id, actief: g.actief, updated_at: new Date().toISOString() }).eq('id', zelfde.id)
      zelfde.user_id = g.user_id
    } else {
      const { data } = await admin.from('ag_personen').insert({ user_id: g.user_id, naam: g.naam, email: g.email, actief: g.actief }).select('id, user_id, clickup_id, naam, email, kleur, actief').single()
      if (data) personen.push(data as Persoon)
    }
  }
  return personen
}

/** De persoon van een ingelogde gebruiker (maakt hem aan als hij er nog niet is). */
export async function persoonVanGebruiker(admin: Admin, userId: string): Promise<Persoon | null> {
  const { data } = await admin.from('ag_personen').select('id, user_id, naam, email, kleur, actief').eq('user_id', userId).maybeSingle()
  if (data) return data as Persoon
  const alle = await zorgVoorPersonen(admin)
  return alle.find((p) => p.user_id === userId) ?? null
}

/**
 * Een ClickUp-lid als persoon: bestaat er al een met dit ClickUp-id, dan die;
 * anders een met dezelfde e-mail of naam (en het id erbij), anders een nieuwe.
 */
export async function persoonVoorClickup(admin: Admin, lid: { id: number; username?: string | null; email?: string | null }, cache: Map<number, string>, personen: (Persoon & { clickup_id?: number | null })[]): Promise<string | null> {
  if (cache.has(lid.id)) return cache.get(lid.id)!
  const naam = (lid.username ?? '').trim() || lid.email || `ClickUp ${lid.id}`
  const email = lid.email?.toLowerCase() ?? null
  let p = personen.find((x) => Number(x.clickup_id) === lid.id)
    ?? personen.find((x) => !x.clickup_id && ((email && x.email?.toLowerCase() === email) || naamSleutel(x.naam) === naamSleutel(naam)))
  if (p && Number(p.clickup_id) !== lid.id) {
    await admin.from('ag_personen').update({ clickup_id: lid.id, updated_at: new Date().toISOString() }).eq('id', p.id)
    p.clickup_id = lid.id
  }
  if (!p) {
    const { data } = await admin.from('ag_personen').upsert({ clickup_id: lid.id, naam, email }, { onConflict: 'clickup_id' }).select('id, user_id, clickup_id, naam, email, kleur, actief').single()
    if (!data) return null
    p = data as Persoon & { clickup_id: number }
    personen.push(p)
  }
  cache.set(lid.id, p.id)
  return p.id
}

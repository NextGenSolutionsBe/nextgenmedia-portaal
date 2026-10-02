import 'server-only'
import type { Admin } from './server'

/**
 * Werknemers (interne logins met modulerechten) en Personeel (dossiers, uren,
 * planning) zijn één en dezelfde persoon. De koppeling loopt via dezelfde
 * login: personeel.auth_user_id = staff_members.auth_user_id. Zo werkt iemand
 * met één account in het portaal (zijn modules) én klokt hij in via /team.
 */

type Staff = { id: string; auth_user_id: string | null; email: string | null; name: string | null; voornaam?: string | null; achternaam?: string | null; functie?: string | null; active?: boolean | null; verwijderd_at?: string | null }

/** Een personeelsdossier voor een interne werknemer: bestaat er al een met hetzelfde e-mailadres, dan koppelen we dat. */
export async function dossierVoorWerknemer(admin: Admin, s: Staff, door: string | null): Promise<{ id: string; nieuw: boolean } | null> {
  if (!s.auth_user_id) return null
  const { data: gekoppeld } = await admin.from('personeel').select('id').eq('auth_user_id', s.auth_user_id).maybeSingle()
  if (gekoppeld) return { id: gekoppeld.id, nieuw: false }
  const email = (s.email ?? '').toLowerCase() || null
  if (email) {
    const { data: opEmail } = await admin.from('personeel').select('id, auth_user_id').ilike('email', email).maybeSingle()
    if (opEmail && !opEmail.auth_user_id) {
      await admin.from('personeel').update({ auth_user_id: s.auth_user_id, account_status: 'actief', updated_at: new Date().toISOString() }).eq('id', opEmail.id)
      return { id: opEmail.id, nieuw: false }
    }
  }
  const naam = (s.name ?? '').trim()
  const voornaam = s.voornaam?.trim() || naam.split(/\s+/)[0] || (email ?? 'Medewerker').split('@')[0]
  const achternaam = s.achternaam?.trim() || naam.split(/\s+/).slice(1).join(' ') || null
  const { data, error } = await admin.from('personeel').insert({
    voornaam, achternaam, email, type: 'werknemer', functie: s.functie ?? null, actief: s.active !== false && !s.verwijderd_at,
    auth_user_id: s.auth_user_id, account_status: 'actief', created_by: door,
  }).select('id').single()
  if (error) return null
  return { id: data.id, nieuw: true }
}

/** De interne login (Werknemers) achter een dossier, of een kandidaat op e-mailadres. */
export async function internAccount(admin: Admin, p: { auth_user_id: string | null; email: string | null }): Promise<{ gekoppeld: Staff & { rol?: string | null; permissions?: string[] } | null; kandidaat: Staff | null }> {
  const kol = 'id, auth_user_id, email, name, rol, permissions, active, verwijderd_at'
  if (p.auth_user_id) {
    const { data } = await admin.from('staff_members').select(kol).eq('auth_user_id', p.auth_user_id).maybeSingle()
    if (data) return { gekoppeld: data, kandidaat: null }
  }
  if (!p.auth_user_id && p.email) {
    const { data } = await admin.from('staff_members').select(kol).ilike('email', p.email).is('verwijderd_at', null).maybeSingle()
    if (data?.auth_user_id) return { gekoppeld: null, kandidaat: data }
  }
  return { gekoppeld: null, kandidaat: null }
}

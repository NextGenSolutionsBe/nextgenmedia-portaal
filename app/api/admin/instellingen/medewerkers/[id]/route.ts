import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { sanitizeModules } from '@/lib/staff'
import { eisHoofdbeheerder } from '@/lib/instellingen/api'
import { STAFF_ROLLEN } from '@/lib/instellingen/model'
import { isAdminId, adminUid, BAN_DUUR } from '@/lib/instellingen/medewerkers'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

/** Hoeveel hoofdbeheerders kunnen er nog inloggen (niet geband)? */
async function actieveHoofdbeheerders(admin: Admin): Promise<number> {
  const { data: roles } = await admin.from('user_roles').select('user_id').eq('role', 'admin')
  const ids = ((roles ?? []) as { user_id: string }[]).map((r) => r.user_id)
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const nu = Date.now()
  return ((data?.users ?? []) as { id: string; banned_until?: string | null }[])
    .filter((u) => ids.includes(u.id) && !(u.banned_until && new Date(u.banned_until).getTime() > nu)).length
}

const herlaad = () => { try { revalidatePath('/admin/werknemers'); revalidatePath('/admin/instellingen') } catch { /* */ } }

// PATCH — gegevens, rol, modules, actief/inactief, e-mail, wachtwoord.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await eisHoofdbeheerder(); if (!g.ok) return g.response
    const { id } = await params
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!b) return NextResponse.json({ error: 'Ongeldige gegevens.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)

    // ── Hoofdbeheerder (admin-account): naam en actief/inactief ────────────
    if (isAdminId(id)) {
      const uid = adminUid(id)
      const { data: rol } = await admin.from('user_roles').select('user_id').eq('user_id', uid).eq('role', 'admin').maybeSingle()
      if (!rol) return NextResponse.json({ error: 'Hoofdbeheerder niet gevonden.' }, { status: 404 })
      const wijzigingen: string[] = []
      if (typeof b.actief === 'boolean') {
        if (!b.actief) {
          if (uid === g.persoon.userId) return NextResponse.json({ error: 'Je kunt je eigen account niet deactiveren.' }, { status: 400 })
          if ((await actieveHoofdbeheerders(admin)) <= 1) return NextResponse.json({ error: 'Er moet minstens één actieve hoofdbeheerder overblijven.' }, { status: 400 })
        }
        const { error } = await admin.auth.admin.updateUserById(uid, { ban_duration: b.actief ? 'none' : BAN_DUUR })
        if (error) throw new Error(error.message)
        wijzigingen.push(b.actief ? 'geactiveerd' : 'gedeactiveerd')
      }
      if (typeof b.voornaam === 'string' || typeof b.achternaam === 'string') {
        const naam = `${String(b.voornaam ?? '').trim()} ${String(b.achternaam ?? '').trim()}`.trim()
        if (naam) {
          const { error } = await admin.auth.admin.updateUserById(uid, { user_metadata: { full_name: naam, name: naam } })
          if (error) throw new Error(error.message)
          wijzigingen.push('naam')
        }
      }
      // E-mailadres (= login) en wachtwoord van een hoofdbeheerder.
      if (typeof b.email === 'string' && b.email.trim()) {
        const nieuw = b.email.trim().toLowerCase()
        const { data: huidig } = await admin.auth.admin.getUserById(uid)
        if (nieuw !== (huidig?.user?.email ?? '').toLowerCase()) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nieuw)) return NextResponse.json({ error: 'Dat is geen geldig e-mailadres.' }, { status: 400 })
          const { data: bezet } = await admin.from('staff_members').select('id').eq('email', nieuw).maybeSingle()
          if (bezet) return NextResponse.json({ error: 'Dat adres is al van een werknemer.' }, { status: 409 })
          const { error } = await admin.auth.admin.updateUserById(uid, { email: nieuw, email_confirm: true })
          if (error) return NextResponse.json({ error: /already|exists|registered/i.test(error.message) ? 'Dat adres is al in gebruik als login.' : error.message }, { status: 400 })
          wijzigingen.push(`e-mail → ${nieuw}`)
        }
      }
      if (typeof b.password === 'string' && b.password) {
        if (b.password.length < 8) return NextResponse.json({ error: 'Een wachtwoord telt minstens 8 tekens.' }, { status: 400 })
        const { error } = await admin.auth.admin.updateUserById(uid, { password: b.password, email_confirm: true })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        wijzigingen.push('wachtwoord')
      }
      await logAudit({
        action: 'staff.admin.updated', entityType: 'auth_user', entityId: uid, summary: `Hoofdbeheerder bijgewerkt (${wijzigingen.join(', ') || 'geen wijzigingen'})`,
        actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: 'admin', metadata: { wijzigingen }, ip: meta.ip, userAgent: meta.userAgent,
      })
      herlaad()
      return NextResponse.json({ ok: true })
    }

    // ── Werknemer ──────────────────────────────────────────────────────────
    const { data: staff } = await admin.from('staff_members').select('id, auth_user_id, email, name, active, rol, verwijderd_at').eq('id', id).maybeSingle()
    if (!staff) return NextResponse.json({ error: 'Medewerker niet gevonden.' }, { status: 404 })

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    const wijzigingen: string[] = []
    if (typeof b.voornaam === 'string') { patch.voornaam = b.voornaam.trim().slice(0, 80) || null; wijzigingen.push('voornaam') }
    if (typeof b.achternaam === 'string') { patch.achternaam = b.achternaam.trim().slice(0, 80) || null; wijzigingen.push('achternaam') }
    if (typeof b.voornaam === 'string' || typeof b.achternaam === 'string') {
      const naam = `${String(patch.voornaam ?? '')} ${String(patch.achternaam ?? '')}`.trim()
      patch.name = naam || staff.name
    }
    if (typeof b.functie === 'string') { patch.functie = b.functie.trim().slice(0, 120) || null; wijzigingen.push('functie') }
    if (typeof b.rol === 'string') {
      if (!STAFF_ROLLEN.includes(b.rol as never)) return NextResponse.json({ error: 'Onbekende rol.' }, { status: 400 })
      patch.rol = b.rol; wijzigingen.push(`rol → ${b.rol}`)
    }
    if (Array.isArray(b.permissions)) { patch.permissions = sanitizeModules(b.permissions); wijzigingen.push('modules') }
    if (typeof b.actief === 'boolean') {
      if (!b.actief && staff.auth_user_id === g.persoon.userId) return NextResponse.json({ error: 'Je kunt je eigen account niet deactiveren.' }, { status: 400 })
      patch.active = b.actief
      if (b.actief) patch.verwijderd_at = null
      wijzigingen.push(b.actief ? 'geactiveerd' : 'gedeactiveerd')
    }

    // E-mail = login: op twee plekken tegelijk, met terugdraaien als de tweede stap faalt.
    const nieuwEmail = typeof b.email === 'string' ? b.email.trim().toLowerCase() : null
    let oudEmail: string | null = null
    if (nieuwEmail && nieuwEmail !== (staff.email ?? '').toLowerCase()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nieuwEmail)) return NextResponse.json({ error: 'Dat is geen geldig e-mailadres.' }, { status: 400 })
      const { data: bezet } = await admin.from('staff_members').select('id').eq('email', nieuwEmail).neq('id', id).maybeSingle()
      if (bezet) return NextResponse.json({ error: 'Dat adres is al van een andere medewerker.' }, { status: 409 })
      if (staff.auth_user_id) {
        const { error } = await admin.auth.admin.updateUserById(staff.auth_user_id, { email: nieuwEmail, email_confirm: true })
        if (error) return NextResponse.json({ error: /already|exists|registered/i.test(error.message) ? 'Dat adres is al in gebruik als login.' : error.message }, { status: 400 })
        oudEmail = staff.email ?? null
      }
      patch.email = nieuwEmail; wijzigingen.push(`e-mail → ${nieuwEmail}`)
    }
    if (typeof b.password === 'string' && b.password) {
      if (b.password.length < 8) return NextResponse.json({ error: 'Een wachtwoord telt minstens 8 tekens.' }, { status: 400 })
      if (staff.auth_user_id) {
        const { error } = await admin.auth.admin.updateUserById(staff.auth_user_id, { password: b.password, email_confirm: true })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      }
      wijzigingen.push('wachtwoord')
    }

    const { error } = await admin.from('staff_members').update(patch).eq('id', id)
    if (error) {
      if (oudEmail && staff.auth_user_id) await admin.auth.admin.updateUserById(staff.auth_user_id, { email: oudEmail, email_confirm: true }).catch(() => {})
      throw new Error(error.message)
    }
    // Inloggen fysiek blokkeren of weer toelaten — de middleware weigert een
    // inactieve rij al, dit sluit ook de deur bij de authenticatie zelf.
    if (typeof b.actief === 'boolean' && staff.auth_user_id) {
      await admin.auth.admin.updateUserById(staff.auth_user_id, { ban_duration: b.actief ? 'none' : BAN_DUUR }).catch(() => {})
    }

    await logAudit({
      action: 'staff.updated', entityType: 'staff_member', entityId: id, summary: `Medewerker bijgewerkt (${wijzigingen.join(', ') || 'geen wijzigingen'})`,
      actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: 'admin',
      metadata: { wijzigingen, modules: Array.isArray(b.permissions) ? patch.permissions : undefined }, ip: meta.ip, userAgent: meta.userAgent,
    })
    herlaad()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — standaard archiveren (inactief + verwijderd_at + login geblokkeerd).
// Met ?definitief=1 (enkel voor een gearchiveerde werknemer): de werknemer en
// het login-account worden echt verwijderd. Is hetzelfde login-account ook
// klant, klant-subaccount of freelancer, dan blijft de login bestaan en
// verdwijnt enkel de werknemerstoegang.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await eisHoofdbeheerder(); if (!g.ok) return g.response
    const { id } = await params
    if (isAdminId(id)) return NextResponse.json({ error: 'Een hoofdbeheerder kan niet verwijderd worden. Deactiveer het account als het niet meer mag inloggen.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: staff } = await admin.from('staff_members').select('id, auth_user_id, email, name, verwijderd_at').eq('id', id).maybeSingle()
    if (!staff) return NextResponse.json({ error: 'Medewerker niet gevonden.' }, { status: 404 })
    if (staff.auth_user_id === g.persoon.userId) return NextResponse.json({ error: 'Je kunt je eigen account niet verwijderen.' }, { status: 400 })

    if (new URL(req.url).searchParams.get('definitief') === '1') {
      if (!staff.verwijderd_at) return NextResponse.json({ error: 'Archiveer de medewerker eerst; definitief verwijderen kan enkel vanuit het archief.' }, { status: 400 })
      const uid = staff.auth_user_id as string | null
      // Hangt aan dezelfde login nog iets anders dan de werknemerstoegang?
      let ookAnders: string[] = []
      if (uid) {
        const [{ data: owner }, { data: sub }, { data: fl }, { data: rollen }] = await Promise.all([
          admin.from('clients').select('id').eq('owner_user_id', uid).limit(1),
          admin.from('client_users').select('id').eq('auth_user_id', uid).limit(1),
          admin.from('freelancers').select('id').eq('user_id', uid).limit(1),
          admin.from('user_roles').select('role').eq('user_id', uid),
        ])
        if ((owner ?? []).length) ookAnders.push('klant')
        if ((sub ?? []).length) ookAnders.push('klant-subaccount')
        if ((fl ?? []).length) ookAnders.push('freelancer')
        if (((rollen ?? []) as { role: string }[]).some((r) => r.role === 'admin')) ookAnders.push('hoofdbeheerder')
        ookAnders = [...new Set(ookAnders)]
      }
      const { error: dErr } = await admin.from('staff_members').delete().eq('id', id)
      if (dErr) throw new Error(dErr.message)
      let loginVerwijderd = false
      if (uid && ookAnders.length === 0) {
        try { await admin.from('user_roles').delete().eq('user_id', uid) } catch { /* cascade doet de rest */ }
        const { error } = await admin.auth.admin.deleteUser(uid)
        if (error) {
          // De werknemer is weg; het login-account blijft geblokkeerd bestaan.
          await admin.auth.admin.updateUserById(uid, { ban_duration: BAN_DUUR }).catch(() => {})
        } else loginVerwijderd = true
      } else if (uid) {
        try { await admin.from('user_roles').delete().eq('user_id', uid).eq('role', 'staff') } catch { /* */ }
      }
      const meta = requestMeta(req)
      await logAudit({
        action: 'staff.deleted', entityType: 'staff_member', entityId: id,
        summary: `Medewerker definitief verwijderd: ${staff.email ?? id}${loginVerwijderd ? ' (login verwijderd)' : ookAnders.length ? ` (login behouden: ook ${ookAnders.join(', ')})` : ''}`,
        actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: 'admin', metadata: { loginVerwijderd, ookAnders }, ip: meta.ip, userAgent: meta.userAgent,
      })
      herlaad()
      return NextResponse.json({ ok: true, loginVerwijderd, ookAnders })
    }
    const { error } = await admin.from('staff_members').update({ active: false, verwijderd_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
    if (staff.auth_user_id) await admin.auth.admin.updateUserById(staff.auth_user_id, { ban_duration: BAN_DUUR }).catch(() => {})
    const meta = requestMeta(req)
    await logAudit({
      action: 'staff.archived', entityType: 'staff_member', entityId: id, summary: `Medewerker verwijderd (gearchiveerd): ${staff.email ?? id}`,
      actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
    })
    herlaad()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — herstellen uit het archief.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await eisHoofdbeheerder(); if (!g.ok) return g.response
    const { id } = await params
    if (isAdminId(id)) return NextResponse.json({ error: 'Niet van toepassing op een hoofdbeheerder.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: staff } = await admin.from('staff_members').select('id, auth_user_id, email, verwijderd_at').eq('id', id).maybeSingle()
    if (!staff) return NextResponse.json({ error: 'Medewerker niet gevonden.' }, { status: 404 })
    const { error } = await admin.from('staff_members').update({ active: true, verwijderd_at: null, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
    if (staff.auth_user_id) await admin.auth.admin.updateUserById(staff.auth_user_id, { ban_duration: 'none' }).catch(() => {})
    const meta = requestMeta(req)
    await logAudit({
      action: 'staff.restored', entityType: 'staff_member', entityId: id, summary: `Medewerker hersteld: ${staff.email ?? id}`,
      actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
    })
    herlaad()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

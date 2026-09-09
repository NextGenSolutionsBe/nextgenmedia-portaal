import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Per intern account instellen of de toegestuurde inlogcode nodig is.
 *
 * ADMIN-ONLY, en dat is geen formaliteit: wie dit kan wijzigen, kan de
 * tweestapsverificatie van het hele platform uitzetten. Elke wijziging gaat
 * daarom ook in het audit-log.
 */

/** Bestaat de tabel nog niet, dan zegt PostgREST dat op deze manieren. */
function missingTable(msg: string): boolean {
  return /login_settings/i.test(msg) &&
    /does not exist|schema cache|could not find|relation/i.test(msg)
}

const MIGRATION_HINT =
  'De tabel login_settings bestaat nog niet in de database. Draai eerst de migratie ' +
  '(supabase/migrations/99999999_SYNC_ALL.sql) — tot dan blijft de inlogcode voor iedereen verplicht.'

type Account = {
  authUserId: string
  email: string | null
  name: string | null
  role: 'admin' | 'employee'
  active: boolean
  twoFactorRequired: boolean
}

// GET — alle interne accounts met hun huidige instelling.
export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()

    const [{ data: roles }, { data: staff }, { data: settings, error: settingsErr }] = await Promise.all([
      admin.from('user_roles').select('user_id, role').eq('role', 'admin'),
      admin.from('staff_members').select('auth_user_id, name, email, active'),
      admin.from('login_settings').select('auth_user_id, two_factor_required'),
    ])

    // Ontbreekt de tabel, dan tonen we dat meteen in het scherm i.p.v. de
    // gebruiker te laten ontdekken dat opslaan niet werkt.
    const ready = !(settingsErr && missingTable(settingsErr.message ?? ''))

    const required = new Map(
      ((settings ?? []) as { auth_user_id: string; two_factor_required: boolean }[])
        .map((r) => [r.auth_user_id, r.two_factor_required]),
    )
    // Geen rij = code verplicht. Zie twoFactorRequired() in lib/two-factor.ts.
    const isRequired = (id: string) => required.get(id) !== false

    // E-mailadressen van admins zitten in auth, niet in een eigen tabel.
    const { data: authUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? null]))

    const out: Account[] = []
    for (const r of (roles ?? []) as { user_id: string }[]) {
      out.push({
        authUserId: r.user_id,
        email: emailById.get(r.user_id) ?? null,
        name: null,
        role: 'admin',
        active: true,
        twoFactorRequired: isRequired(r.user_id),
      })
    }
    for (const s of (staff ?? []) as { auth_user_id: string | null; name: string | null; email: string | null; active: boolean }[]) {
      if (!s.auth_user_id) continue                       // nog geen login-account
      if (out.some((a) => a.authUserId === s.auth_user_id)) continue   // is al admin
      out.push({
        authUserId: s.auth_user_id,
        email: s.email,
        name: s.name,
        role: 'employee',
        active: s.active !== false,
        twoFactorRequired: isRequired(s.auth_user_id),
      })
    }

    out.sort((a, b) => (a.role === b.role ? (a.email ?? '').localeCompare(b.email ?? '') : a.role === 'admin' ? -1 : 1))
    return NextResponse.json({ accounts: out, ready, hint: ready ? null : MIGRATION_HINT })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH { authUserId, twoFactorRequired } — de instelling voor één account.
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()

    const authUserId = String(b.authUserId ?? '')
    const wanted = b.twoFactorRequired !== false
    if (!authUserId) return NextResponse.json({ error: 'Account ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()

    // Enkel interne accounts. Klanten en partners hebben sowieso nooit een code,
    // en mogen hier dus ook niet in terechtkomen.
    const { data: role } = await admin.from('user_roles').select('role').eq('user_id', authUserId).maybeSingle()
    const isAdmin = role?.role === 'admin'
    const { data: staff } = await admin.from('staff_members').select('id').eq('auth_user_id', authUserId).maybeSingle()
    if (!isAdmin && !staff) return NextResponse.json({ error: 'Dit is geen intern account' }, { status: 400 })

    const { error } = await admin.from('login_settings').upsert({
      auth_user_id: authUserId,
      two_factor_required: wanted,
      note: String(b.note ?? '').trim() || null,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_user_id' })
    if (error) {
      // Deze route is admin-only, dus hier mag de échte oorzaak wél op het
      // scherm — een algemene "er ging iets mis" helpt niemand verder.
      if (missingTable(error.message)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 })
      console.error('[login-settings]', error)
      return NextResponse.json({ error: `Opslaan mislukt: ${error.message}` }, { status: 400 })
    }

    const meta = requestMeta(req)
    await logAudit({
      action: wanted ? 'auth.2fa.enable' : 'auth.2fa.disable',
      entityType: 'auth_user', entityId: authUserId,
      summary: wanted
        ? 'Inlogcode weer verplicht gemaakt voor een account'
        : 'Inlogcode uitgezet voor een account',
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

import { safeMessage } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { vrijstellingGeldig } from '@/lib/two-factor'

export const dynamic = 'force-dynamic'

/**
 * GET — alle interne accounts (hoofdbeheerders + niet-gearchiveerde werknemers)
 * met hun 2FA-status: app gekoppeld of niet, en een eventuele (tijdelijke)
 * vrijstelling. ADMIN-ONLY. Wijzigen gebeurt via /api/admin/login-settings/2fa
 * (met herbevestiging); je eigen 2FA beheer je via Mijn account.
 */

type Account = {
  authUserId: string
  email: string | null
  name: string | null
  role: 'admin' | 'employee'
  active: boolean
  /** Authenticator-app gekoppeld — enkel de status, nooit het geheim. */
  totpActief: boolean
  /** Door een admin vrijgesteld (op dit moment geldig). */
  vrijgesteld: boolean
  /** Tot wanneer (null = tot een admin het weer aanzet). */
  vrijgesteldTot: string | null
}

export async function GET() {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()

    const [{ data: roles }, { data: staff }, { data: settings }, { data: totp }, { data: authUsers }] = await Promise.all([
      admin.from('user_roles').select('user_id').eq('role', 'admin'),
      admin.from('staff_members').select('auth_user_id, name, email, active, verwijderd_at'),
      admin.from('login_settings').select('auth_user_id, two_factor_required, vrijgesteld_tot'),
      admin.from('user_totp').select('user_id').eq('actief', true),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ])
    const metApp = new Set(((totp ?? []) as { user_id: string }[]).map((r) => r.user_id))
    const instelling = new Map(((settings ?? []) as { auth_user_id: string; two_factor_required: boolean; vrijgesteld_tot: string | null }[]).map((r) => [r.auth_user_id, r]))
    const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? null]))
    const nu = Date.now()
    const status = (id: string) => {
      const r = instelling.get(id) ?? null
      const vrij = vrijstellingGeldig(r, nu)
      return { totpActief: metApp.has(id), vrijgesteld: vrij, vrijgesteldTot: vrij ? r?.vrijgesteld_tot ?? null : null }
    }

    const out: Account[] = []
    for (const r of (roles ?? []) as { user_id: string }[]) {
      if (!emailById.has(r.user_id)) continue
      out.push({ authUserId: r.user_id, email: emailById.get(r.user_id) ?? null, name: null, role: 'admin', active: true, ...status(r.user_id) })
    }
    for (const s of (staff ?? []) as { auth_user_id: string | null; name: string | null; email: string | null; active: boolean; verwijderd_at: string | null }[]) {
      if (!s.auth_user_id || s.verwijderd_at) continue             // geen login of gearchiveerd
      if (out.some((a) => a.authUserId === s.auth_user_id)) continue // is al admin
      out.push({ authUserId: s.auth_user_id, email: s.email, name: s.name, role: 'employee', active: s.active !== false, ...status(s.auth_user_id) })
    }
    out.sort((a, b) => (a.role === b.role ? (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? '') : a.role === 'admin' ? -1 : 1))
    // Heeft de admin zelf een app? Dan vragen gevoelige acties ook een code daaruit.
    return NextResponse.json({ accounts: out, ikHebApp: metApp.has(actor.id), meId: actor.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { sendEmail, EMAIL_FROM } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET ?email=...&test=1 — waarom krijgt dit account geen inlogcode?
// Toont per stap wat er gebeurt: account gevonden, rol, werknemersrij, of
// tweestapsverificatie van toepassing is, en (met test=1) wat de mailprovider
// exact antwoordt bij een echte verzendpoging. ADMIN-ONLY.
export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const email = (req.nextUrl.searchParams.get('email') ?? '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'Geef ?email=... mee' }, { status: 400 })

    const admin = createAdminSupabaseClient()

    // 1) Auth-account opzoeken (listUsers is gepagineerd; team is klein).
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const authUser = (list?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email)

    // 2) Rol + werknemersrij.
    const [roleRes, staffByAuth, staffByEmail] = await Promise.all([
      authUser ? admin.from('user_roles').select('role').eq('user_id', authUser.id).maybeSingle() : Promise.resolve({ data: null }),
      authUser ? admin.from('staff_members').select('id, active, auth_user_id, email').eq('auth_user_id', authUser.id).maybeSingle() : Promise.resolve({ data: null }),
      admin.from('staff_members').select('id, active, auth_user_id, email').eq('email', email).maybeSingle(),
    ])

    const role = (roleRes.data as { role?: string } | null)?.role ?? null
    const staff = (staffByAuth.data ?? staffByEmail.data) as
      { id: string; active: boolean; auth_user_id: string | null; email: string } | null

    const isAdmin = role === 'admin'
    const isActiveStaff = !!staff && staff.active !== false && !!staff.auth_user_id
    const twoFactorApplies = isAdmin || isActiveStaff

    // 3) Recent aangevraagde codes (bewijst of het versturen überhaupt startte).
    const { data: codes } = authUser
      ? await admin.from('login_codes')
          .select('created_at, expires_at, consumed_at, attempts')
          .eq('user_id', authUser.id).order('created_at', { ascending: false }).limit(3)
      : { data: null }

    // 4) Optioneel: écht een testmail sturen en het antwoord van de provider tonen.
    let mailTest: { ok: boolean; error?: string; id?: string } | null = null
    if (req.nextUrl.searchParams.get('test') === '1' && authUser?.email) {
      const r = await sendEmail({
        to: authUser.email,
        subject: 'Test — NextGenMedia',
        text: 'Dit is een testbericht om te controleren of e-mail naar dit adres aankomt.',
      })
      mailTest = { ok: r.ok, error: r.error, id: r.id }
    }

    return NextResponse.json({
      email,
      authAccount: authUser ? { found: true, id: authUser.id, email: authUser.email, confirmed: !!authUser.email_confirmed_at } : { found: false },
      role,
      staffMember: staff
        ? { found: true, id: staff.id, active: staff.active, linkedToAccount: !!staff.auth_user_id, emailInStaffRow: staff.email }
        : { found: false },
      twoFactorApplies,
      // Waarom zou de code NIET verstuurd worden?
      blockedReason: !authUser ? 'Geen account met dit e-mailadres'
        : !twoFactorApplies ? 'Geen admin en geen actieve werknemer → code niet van toepassing'
        : !authUser.email ? 'Account heeft geen e-mailadres'
        : null,
      recentCodes: codes ?? [],
      mailFrom: EMAIL_FROM,
      mailProviderConfigured: !!process.env.RESEND_API_KEY,
      mailTest,
      hint: 'Voeg &test=1 toe om een echte testmail te sturen en het antwoord van de mailprovider te zien.',
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fout' }, { status: 400 })
  }
}

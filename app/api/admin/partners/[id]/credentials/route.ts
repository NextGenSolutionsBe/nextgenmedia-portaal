import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// PATCH — admin updates a partner's login email and/or password
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id: partnerId } = await params
    const { email, password } = await req.json()

    if (!email && !password) {
      return NextResponse.json({ error: 'Geef een e-mail of wachtwoord op' }, { status: 400 })
    }
    if (password && String(password).length < 8) {
      return NextResponse.json({ error: 'Wachtwoord moet minstens 8 tekens zijn' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    const { data: partner } = await admin
      .from('freelancers')
      .select('user_id')
      .eq('id', partnerId)
      .maybeSingle()
    if (!partner?.user_id) {
      return NextResponse.json({ error: 'Geen gekoppeld login-account voor deze partner' }, { status: 404 })
    }

    const authPatch: { email?: string; password?: string } = {}
    if (email) authPatch.email = String(email).trim()
    if (password) authPatch.password = String(password)

    const { error: authErr } = await admin.auth.admin.updateUserById(partner.user_id, {
      ...authPatch,
      email_confirm: true,
    })
    if (authErr) throw new Error(authErr.message)

    const rowPatch: Record<string, unknown> = {}
    if (email) rowPatch.email = String(email).trim()
    // Wachtwoord bewust NIET spiegelen naar de tabel: Supabase Auth bewaart het
    // al gehasht. Een leesbare kopie is een onnodig datalekrisico.
    if (Object.keys(rowPatch).length > 0) {
      let { error } = await admin.from('freelancers').update(rowPatch).eq('id', partnerId)
      if (error && /login_password/i.test(error.message ?? '')) {
        delete rowPatch.login_password
        if (Object.keys(rowPatch).length > 0) {
          ({ error } = await admin.from('freelancers').update(rowPatch).eq('id', partnerId))
        } else { error = null }
      }
      if (error) throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'partner.credentials.update',
      entityType: 'partner',
      entityId: partnerId,
      summary: `Login-gegevens partner gewijzigd (${[email ? 'e-mail' : null, password ? 'wachtwoord' : null].filter(Boolean).join(' + ')})`,
      actorUserId: actor.id,
      actorEmail: actor.email ?? null,
      actorRole: 'admin',
      metadata: { changed_email: Boolean(email), changed_password: Boolean(password) },
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    try { revalidatePath(`/admin/partners/${partnerId}`) } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

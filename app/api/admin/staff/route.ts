import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { sanitizeModules } from '@/lib/staff'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// GET — alle werknemers (admin-only).
export async function GET() {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('staff_members').select('id, name, email, active, permissions, created_at, last_login_at').order('created_at', { ascending: true })
    return NextResponse.json({ staff: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuwe werknemer (auth-account + rol 'employee' + staff_members-rij).
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const name = (b.name as string)?.trim() || null
    const email = (b.email as string)?.trim().toLowerCase()
    const password = b.password as string | undefined
    if (!email) return NextResponse.json({ error: 'E-mail is verplicht' }, { status: 400 })
    if (!password || String(password).length < 8) return NextResponse.json({ error: 'Wachtwoord van minstens 8 tekens is verplicht' }, { status: 400 })
    const permissions = sanitizeModules(b.permissions)

    const admin = createAdminSupabaseClient()
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: name || email },
    })
    if (authErr || !created.user) return NextResponse.json({ error: `Account aanmaken mislukt: ${authErr?.message ?? 'onbekend'}` }, { status: 400 })
    const authUserId = created.user.id

    // Rol-rij is best-effort: het app_role-enum bevat mogelijk (nog) geen
    // 'employee' als de migratie niet gedraaid is. De werknemer-status wordt
    // primair uit staff_members afgeleid (zie role-resolutie in middleware/
    // layouts), dus een mislukte rol-insert mag de aanmaak niet blokkeren.
    await admin.from('user_roles').upsert(
      { user_id: authUserId, role: 'employee' },
      { onConflict: 'user_id,role' },
    ).then(({ error }) => { if (error) console.warn('user_roles employee insert overgeslagen:', error.message) })

    // staff_members is de bron van waarheid — dit MOET lukken.
    const { data: row, error: rowErr } = await admin
      .from('staff_members')
      .insert({ auth_user_id: authUserId, name, email, active: true, permissions, created_by: actor.id })
      .select('id').single()
    if (rowErr || !row) {
      await admin.auth.admin.deleteUser(authUserId).catch(() => {})
      return NextResponse.json({ error: `Werknemer aanmaken mislukt: ${rowErr?.message}` }, { status: 400 })
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'staff.created', entityType: 'staff_member', entityId: row.id,
      summary: `Werknemer aangemaakt (${email})`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { modules: permissions }, ip: meta.ip, userAgent: meta.userAgent,
    })
    try { revalidatePath('/admin/werknemers') } catch { }
    return NextResponse.json({ ok: true, id: row.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

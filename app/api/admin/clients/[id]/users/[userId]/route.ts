import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { sanitizePermissions, presetPermissions, type PresetKey } from '@/lib/portal-permissions'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// PATCH — subaccount bijwerken: naam/rol/actief/permissions/wachtwoord/preset.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id: clientId, userId } = await params
    const b = await req.json()
    const admin = createAdminSupabaseClient()

    const { data: cu } = await admin.from('client_users').select('*').eq('id', userId).eq('client_id', clientId).maybeSingle()
    if (!cu) return NextResponse.json({ error: 'Subaccount niet gevonden' }, { status: 404 })

    const patch: Record<string, unknown> = {}
    if (typeof b.name === 'string') patch.name = b.name.trim() || null
    if (typeof b.phone === 'string') patch.phone = b.phone.trim() || null
    if (typeof b.role_label === 'string') patch.role_label = b.role_label.trim() || null
    if (typeof b.active === 'boolean') patch.active = b.active
    if (b.preset) patch.permissions = presetPermissions(b.preset as PresetKey)
    if (b.permissions) patch.permissions = sanitizePermissions(b.permissions)

    // Wachtwoord / e-mail van het auth-account.
    const authPatch: { email?: string; password?: string } = {}
    if (typeof b.email === 'string' && b.email.trim()) { authPatch.email = b.email.trim().toLowerCase(); patch.email = authPatch.email }
    if (b.password) {
      if (String(b.password).length < 8) return NextResponse.json({ error: 'Wachtwoord moet minstens 8 tekens zijn' }, { status: 400 })
      authPatch.password = String(b.password)
    }
    if (Object.keys(authPatch).length > 0 && cu.auth_user_id) {
      const { error: authErr } = await admin.auth.admin.updateUserById(cu.auth_user_id, { ...authPatch, email_confirm: true })
      if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })
    }

    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString()
      const { error } = await admin.from('client_users').update(patch).eq('id', userId)
      if (error) throw new Error(error.message)
    }

    const meta = requestMeta(req)
    const changed = [
      b.permissions || b.preset ? 'rechten' : null,
      typeof b.active === 'boolean' ? (b.active ? 'geactiveerd' : 'gedeactiveerd') : null,
      b.password ? 'wachtwoord' : null,
    ].filter(Boolean).join(', ')
    await logAudit({
      action: 'client_user.updated', entityType: 'client_user', entityId: userId,
      summary: `Subaccount bijgewerkt${changed ? ` (${changed})` : ''}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { client_id: clientId, changed }, ip: meta.ip, userAgent: meta.userAgent,
    })

    try { revalidatePath(`/admin/clients/${clientId}`) } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — subaccount verwijderen (rij + gekoppeld auth-account).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id: clientId, userId } = await params
    const admin = createAdminSupabaseClient()

    const { data: cu } = await admin.from('client_users').select('id, auth_user_id, email').eq('id', userId).eq('client_id', clientId).maybeSingle()
    if (!cu) return NextResponse.json({ error: 'Subaccount niet gevonden' }, { status: 404 })

    const { error } = await admin.from('client_users').delete().eq('id', userId)
    if (error) throw new Error(error.message)

    // Auth-account + rol opruimen (best effort).
    if (cu.auth_user_id) {
      try { await admin.from('user_roles').delete().eq('user_id', cu.auth_user_id) } catch { }
      try { await admin.auth.admin.deleteUser(cu.auth_user_id) } catch { }
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'client_user.deleted', entityType: 'client_user', entityId: userId,
      summary: `Subaccount verwijderd (${cu.email ?? userId})`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { client_id: clientId }, ip: meta.ip, userAgent: meta.userAgent,
    })

    try { revalidatePath(`/admin/clients/${clientId}`) } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

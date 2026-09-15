import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { sanitizePermissions, presetPermissions, type PresetKey } from '@/lib/portal-permissions'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// GET — lijst van subaccounts voor deze klant.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id: clientId } = await params
    const admin = createAdminSupabaseClient()
    const { data } = await admin
      .from('client_users')
      .select('id, name, email, phone, role_label, active, permissions, created_at, last_login_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })
    return NextResponse.json({ users: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuw subaccount aanmaken (auth-user + client_users-rij).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id: clientId } = await params
    const b = await req.json()

    const name = (b.name as string)?.trim() || null
    const email = (b.email as string)?.trim().toLowerCase()
    const password = b.password as string | undefined
    const phone = (b.phone as string)?.trim() || null
    const preset = (b.preset as PresetKey) || 'eigenaar'
    const roleLabel = (b.role_label as string)?.trim() || preset
    if (!email) return NextResponse.json({ error: 'E-mail is verplicht' }, { status: 400 })
    if (!password || String(password).length < 8) return NextResponse.json({ error: 'Wachtwoord van minstens 8 tekens is verplicht' }, { status: 400 })

    const permissions = b.permissions ? sanitizePermissions(b.permissions) : presetPermissions(preset)

    const admin = createAdminSupabaseClient()

    // Klant moet bestaan.
    const { data: client } = await admin.from('clients').select('id, company_name').eq('id', clientId).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })

    // Auth-user aanmaken.
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: name || email, client_id: clientId },
    })
    if (authErr || !created.user) return NextResponse.json({ error: `Account aanmaken mislukt: ${authErr?.message ?? 'onbekend'}` }, { status: 400 })
    const authUserId = created.user.id

    // Rol = client (zodat portaal toegankelijk is).
    await admin.from('user_roles').insert({ user_id: authUserId, role: 'client' })

    const { data: row, error: rowErr } = await admin
      .from('client_users')
      .insert({ client_id: clientId, auth_user_id: authUserId, name, email, phone, role_label: roleLabel, active: true, permissions })
      .select('id')
      .single()
    if (rowErr || !row) {
      // Rollback auth-user als de rij faalt.
      await admin.auth.admin.deleteUser(authUserId).catch(() => {})
      return NextResponse.json({ error: `Subaccount aanmaken mislukt: ${rowErr?.message}` }, { status: 400 })
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'client_user.created', entityType: 'client_user', entityId: row.id,
      summary: `Subaccount aangemaakt (${email}) voor ${client.company_name}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { client_id: clientId, preset, role_label: roleLabel }, ip: meta.ip, userAgent: meta.userAgent,
    })

    try { revalidatePath(`/admin/clients/${clientId}`) } catch { }
    return NextResponse.json({ ok: true, id: row.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: clientId } = await params

    // Verify admin
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase
      .from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin') {
      return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    }

    const { service_slug } = await req.json()
    if (!service_slug) {
      return NextResponse.json({ error: 'service_slug vereist' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    // Check if a client_services record exists for this service.
    // We MUST preserve the existing config (posts/reels/channels/etc) — only flip active.
    const { data: existing } = await admin
      .from('client_services')
      .select('id, config')
      .eq('client_id', clientId)
      .eq('service_slug', service_slug)
      .maybeSingle()

    if (existing) {
      // Existing service: just activate, do NOT touch config
      const { error } = await admin
        .from('client_services')
        .update({ active: true })
        .eq('id', existing.id)
      if (error) throw new Error(error.message)
    } else {
      // No record yet (edge case) — insert with empty config
      const { error } = await admin
        .from('client_services')
        .insert({ client_id: clientId, service_slug, active: true, config: {} })
      if (error) throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'client.access.grant',
      entityType: 'client',
      entityId: clientId,
      summary: `Portaaltoegang verleend voor dienst "${service_slug}"`,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      actorRole: 'admin',
      metadata: { service_slug },
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    // Invalidate caches so portal + admin pages reflect new access immediately
    try {
      revalidatePath(`/admin/clients/${clientId}`)
      revalidatePath('/portal')
      revalidatePath('/portal/social-media')
      revalidatePath('/portal/website')
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: safeMessage(err) },
      { status: 400 },
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: clientId } = await params

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase
      .from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin') {
      return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    }

    const { service_slug } = await req.json()
    if (!service_slug) {
      return NextResponse.json({ error: 'service_slug vereist' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    // Revoke access: set active = false (preserve config so it can be re-granted)
    const { error } = await admin
      .from('client_services')
      .update({ active: false })
      .eq('client_id', clientId)
      .eq('service_slug', service_slug)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'client.access.revoke',
      entityType: 'client',
      entityId: clientId,
      summary: `Portaaltoegang ingetrokken voor dienst "${service_slug}"`,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      actorRole: 'admin',
      metadata: { service_slug },
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    // Invalidate caches so portal access is revoked immediately
    try {
      revalidatePath(`/admin/clients/${clientId}`)
      revalidatePath('/portal')
      revalidatePath('/portal/social-media')
      revalidatePath('/portal/website')
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: safeMessage(err) },
      { status: 400 },
    )
  }
}

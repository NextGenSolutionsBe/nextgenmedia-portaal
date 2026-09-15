import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const ALLOWED_PATCH_FIELDS = new Set([
  'name', 'company', 'phone', 'vat_number', 'iban', 'region',
  'roles', 'hourly_rate', 'notes', 'active',
])

// PATCH — edit partner details
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { id } = await params
    const body = await req.json()
    const admin = createAdminSupabaseClient()

    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED_PATCH_FIELDS.has(k) && v !== undefined) patch[k] = v
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    }

    const { error } = await admin.from('freelancers').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    try {
      revalidatePath('/admin/partners')
      revalidatePath(`/admin/partners/${id}`)
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — deactivate and optionally hard-delete a partner
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { id } = await params
    const { hard = false } = await req.json().catch(() => ({ hard: false }))
    const admin = createAdminSupabaseClient()

    // Fetch partner to get auth user id and verify existence
    const { data: partner, error: fetchErr } = await admin
      .from('freelancers')
      .select('id, user_id, name')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) throw new Error(fetchErr.message)
    if (!partner) return NextResponse.json({ error: 'Partner niet gevonden' }, { status: 404 })

    if (hard) {
      // Hard delete: remove all related data then the freelancer record
      await Promise.allSettled([
        admin.from('partner_ledger_entries').delete().eq('freelancer_id', id),
        admin.from('partner_settlements').delete().eq('freelancer_id', id),
        admin.from('freelancer_assignments').delete().eq('freelancer_id', id),
      ])
      const { error: delErr } = await admin.from('freelancers').delete().eq('id', id)
      if (delErr) throw new Error(delErr.message)

      // Delete auth user — best effort
      if (partner.user_id) {
        try { await admin.auth.admin.deleteUser(partner.user_id) } catch { }
      }
    } else {
      // Soft delete: deactivate only
      const { error: deactErr } = await admin
        .from('freelancers')
        .update({ active: false })
        .eq('id', id)
      if (deactErr) throw new Error(deactErr.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: hard ? 'partner.delete' : 'partner.deactivate',
      entityType: 'partner',
      entityId: id,
      summary: hard
        ? `Partner "${partner.name}" en alle gekoppelde gegevens definitief verwijderd`
        : `Partner "${partner.name}" gedeactiveerd`,
      actorUserId: actor.id,
      actorEmail: actor.email ?? null,
      actorRole: 'admin',
      metadata: { hard: Boolean(hard), name: partner.name },
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    try {
      revalidatePath('/admin/partners')
      revalidatePath(`/admin/partners/${id}`)
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

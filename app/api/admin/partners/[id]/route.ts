import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const ALLOWED_PATCH_FIELDS = new Set([
  'name', 'company', 'phone', 'vat_number', 'iban', 'region',
  'roles', 'hourly_rate', 'notes', 'active', 'bio', 'commission_pct',
])

const tekstOfNull = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

/**
 * Update die een ontbrekende kolom laat vallen en opnieuw probeert — er
 * bestaan twee schemaversies van `freelancers` (name/full_name,
 * company/company_name, commission_pct/default_commission_pct).
 */
async function updateResilient(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  id: string,
  payload: Record<string, unknown>,
): Promise<{ message: string } | null> {
  const working = { ...payload }
  for (let i = 0; i <= Object.keys(payload).length; i++) {
    if (Object.keys(working).length === 0) return null
    const { error } = await admin.from('freelancers').update(working).eq('id', id)
    if (!error) return null
    const code = (error as { code?: string }).code
    const msg = error.message ?? ''
    const ontbreekt = code === 'PGRST204' || code === '42703' || /could not find the '.*' column|column .* does not exist/i.test(msg)
    if (!ontbreekt) return error
    const m = msg.match(/'([^']+)' column/i) || msg.match(/column "?([a-z0-9_]+)"?/i)
    const kol = m?.[1]
    if (!kol || !(kol in working)) return error
    delete working[kol]
  }
  return { message: 'Bijwerken mislukt na meerdere pogingen' }
}

// PATCH — edit partner details
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const admin = createAdminSupabaseClient()

    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body ?? {})) {
      if (ALLOWED_PATCH_FIELDS.has(k) && v !== undefined) patch[k] = v
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    }

    // Validatie + normalisatie
    if ('name' in patch) {
      const n = tekstOfNull(patch.name, 160)
      if (!n) return NextResponse.json({ error: 'Naam mag niet leeg zijn.' }, { status: 400 })
      patch.name = n
      patch.full_name = n // legacy-schema (NOT NULL daar); valt weg als de kolom ontbreekt
    }
    for (const k of ['company', 'phone', 'vat_number', 'iban', 'region'] as const) {
      if (k in patch) patch[k] = tekstOfNull(patch[k], 160)
    }
    if ('company' in patch) patch.company_name = patch.company
    for (const k of ['notes', 'bio'] as const) {
      if (k in patch) patch[k] = tekstOfNull(patch[k], 4000)
    }
    if ('roles' in patch) {
      if (!Array.isArray(patch.roles)) return NextResponse.json({ error: 'Rollen moeten een lijst zijn.' }, { status: 400 })
      patch.roles = (patch.roles as unknown[]).filter((r): r is string => typeof r === 'string' && r.trim() !== '')
    }
    if ('hourly_rate' in patch) {
      if (patch.hourly_rate === null || patch.hourly_rate === '') patch.hourly_rate = null
      else {
        const n = Number(patch.hourly_rate)
        if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'Uurtarief klopt niet.' }, { status: 400 })
        patch.hourly_rate = n
      }
    }
    if ('commission_pct' in patch) {
      const n = Number(patch.commission_pct)
      if (patch.commission_pct === null || patch.commission_pct === '' || !Number.isFinite(n) || n < 0 || n > 100) {
        return NextResponse.json({ error: 'Commissie moet tussen 0 en 100 % liggen.' }, { status: 400 })
      }
      patch.commission_pct = n
      patch.default_commission_pct = n
    }
    if ('active' in patch) patch.active = !!patch.active

    const error = await updateResilient(admin, id, patch)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'partner.update',
      entityType: 'partner',
      entityId: id,
      summary: 'active' in patch && Object.keys(patch).length === 1
        ? `Partner ${patch.active ? 'geactiveerd' : 'gedeactiveerd'}`
        : 'Partnergegevens bijgewerkt',
      actorUserId: actor.id,
      actorEmail: actor.email ?? null,
      actorRole: 'admin',
      metadata: { velden: Object.keys(patch) },
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

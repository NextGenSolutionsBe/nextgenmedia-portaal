import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { validateBtw } from '@/lib/btw'
import { clickupConfigured, deleteList } from '@/lib/clickup'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// Klant-verwijdering ruimt ook storage, auth en (best-effort) ClickUp op.
export const maxDuration = 60

// Strikt admin (voor destructieve acties zoals klant-DELETE).
async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' ? user : null
}

// Admin óf actieve werknemer (module-afscherming zit in de middleware).
async function requireStaffLocal(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

// PATCH — update client fields
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const user = await requireStaffLocal(supabase)
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const body = await req.json()
    const admin = createAdminSupabaseClient()

    const patch: Record<string, unknown> = {}
    if (body.company_name !== undefined) patch.company_name = body.company_name
    if (body.contact_name !== undefined) patch.contact_name = body.contact_name || null
    if (body.niche !== undefined) patch.niche = body.niche || null
    if (body.website_url !== undefined) patch.website_url = body.website_url || null
    if (body.customer_since !== undefined) patch.customer_since = body.customer_since || null
    if (body.btw_nummer !== undefined) {
      const v = validateBtw(body.btw_nummer)
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
      patch.btw_nummer = v.value || null
    }

    // Update resiliently: drop columns that don't exist yet (customer_since / btw_nummer).
    let { error } = await admin.from('clients').update(patch).eq('id', id)
    while (error) {
      const col = String(error.message ?? '').match(/'([^']+)' column|column "([^"]+)"/)?.[1]
        ?? (/customer_since/i.test(error.message ?? '') ? 'customer_since' : /btw_nummer/i.test(error.message ?? '') ? 'btw_nummer' : null)
      if (col && col in patch) {
        delete patch[col]
        if (Object.keys(patch).length === 0) { error = null; break }
        ;({ error } = await admin.from('clients').update(patch).eq('id', id))
      } else break
    }
    if (error) throw new Error(error.message)

    // Handle service updates
    // IMPORTANT: We update CONFIG only. We never auto-activate services on edit —
    // portal access is gated by client_services.active = true, which is only set
    // by the explicit grant-access endpoint after admin verifies the signed contract.
    // The original POST route creates new services with active = false by default.
    if (body.services !== undefined) {
      const newServices: string[] = body.services ?? []

      // Get existing services (with current active state — to preserve it)
      const { data: existingServices } = await admin
        .from('client_services')
        .select('service_slug, active')
        .eq('client_id', id)

      const existingMap = new Map(
        (existingServices ?? []).map((s: { service_slug: string; active: boolean }) => [s.service_slug, s.active])
      )
      const existingSlugs = Array.from(existingMap.keys())

      // 1) Deactivate REMOVED services (services that exist but no longer in new list)
      //    Note: we deactivate, not delete — preserves history + can be re-granted later.
      const toDeactivate = existingSlugs.filter((s) => !newServices.includes(s))
      if (toDeactivate.length > 0) {
        await admin.from('client_services').update({ active: false })
          .eq('client_id', id).in('service_slug', toDeactivate)
      }

      // 2) Update or insert services in the new list — PRESERVE active state
      for (const slug of newServices) {
        const config = slug === 'social-media'
          ? { posts: body.posts_per_month ?? 0, reels: body.reels_per_month ?? 0, stories: body.stories_per_month ?? 0, channels: body.platforms ?? [] }
          : slug === 'webdesign'
          ? { maintenance_included: body.webdesign_maintenance_included ?? false }
          : slug === 'ads'
          ? { budget: body.ads_budget ?? null }
          : {}

        if (existingMap.has(slug)) {
          // Existing service: update config ONLY, do NOT touch `active`
          // (admin must explicitly grant/revoke via /grant-access endpoint)
          await admin.from('client_services').update({ config })
            .eq('client_id', id).eq('service_slug', slug)
        } else {
          // Brand new service: insert with active = false (consistent with POST route)
          // Admin must explicitly grant access after contract is signed.
          await admin.from('client_services').insert({ client_id: id, service_slug: slug, active: false, config })
        }
      }

      // Also update service_contracts social config if social media settings changed
      if (newServices.includes('social-media') && (body.posts_per_month !== undefined || body.reels_per_month !== undefined || body.stories_per_month !== undefined)) {
        await admin.from('service_contracts')
          .update({
            config: {
              posts: body.posts_per_month ?? 0,
              reels: body.reels_per_month ?? 0,
              stories: body.stories_per_month ?? 0,
              channels: body.platforms ?? [],
            },
          })
          .eq('client_id', id)
          .eq('service_slug', 'social-media')
      }
    }

    // Invalidate caches so admin pages refresh
    try {
      revalidatePath('/admin/clients')
      revalidatePath(`/admin/clients/${id}`)
      revalidatePath('/portal')
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — hard delete client and all related data
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const user = await requireAdmin(supabase)
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { confirmed_name } = await req.json()
    if (!confirmed_name) return NextResponse.json({ error: 'Bevestigingsnaam ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()

    // Verify the confirmed name matches
    const { data: client } = await admin
      .from('clients')
      .select('company_name, owner_user_id, clickup_list_id')
      .eq('id', id)
      .maybeSingle()

    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })
    if (client.company_name.trim().toLowerCase() !== confirmed_name.trim().toLowerCase()) {
      return NextResponse.json({ error: 'Bedrijfsnaam komt niet overeen' }, { status: 400 })
    }

    // 1. Fetch contracts before deleting (need paths for storage cleanup)
    const { data: clientContracts } = await admin
      .from('contracts')
      .select('id, pdf_path, signed_pdf_path')
      .eq('client_id', id)

    // 2. Delete contracts (cascades: contract_signatures, contract_events)
    if (clientContracts && clientContracts.length > 0) {
      const contractIds = clientContracts.map(c => c.id)
      await admin.from('contracts').delete().in('id', contractIds)

      // Clean up storage files — best effort
      const paths = clientContracts.flatMap(c =>
        [c.pdf_path, c.signed_pdf_path].filter((p): p is string => !!p)
      )
      if (paths.length > 0) {
        try { await admin.storage.from('contracts').remove(paths) } catch { }
      }
    }

    // 3. Delete other client-related data — best effort (may or may not cascade)
    await Promise.allSettled([
      admin.from('social_content_items').delete().eq('client_id', id),
      admin.from('webdesign_change_requests').delete().eq('client_id', id),
    ])

    // 3b. ClickUp: verwijder de volledige CONTENTKALENDER-lijst van deze klant
    //     (spiegelt de verwijdering — alle gesyncte taken verdwijnen in één call).
    //     Best-effort: mag de klant-verwijdering nooit blokkeren.
    if (clickupConfigured() && client.clickup_list_id) {
      try { await deleteList(client.clickup_list_id as string) } catch { }
    }

    // 4. Delete client record (cascades: client_services, service_contracts, revenue_entries)
    const { error: clientErr } = await admin.from('clients').delete().eq('id', id)
    if (clientErr) throw new Error(clientErr.message)

    // 5. Delete auth user — best effort
    if (client.owner_user_id) {
      try { await admin.auth.admin.deleteUser(client.owner_user_id) } catch { }
    }

    // GDPR: record the erasure (no personal data beyond the company name)
    const meta = requestMeta(req)
    await logAudit({
      action: 'client.delete',
      entityType: 'client',
      entityId: id,
      summary: `Klant "${client.company_name}" en alle gekoppelde gegevens definitief verwijderd`,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      actorRole: 'admin',
      metadata: { company_name: client.company_name },
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    // 6. Invalidate caches so the clients list updates immediately
    try {
      revalidatePath('/admin/clients')
      revalidatePath('/admin/contracts')
      revalidatePath('/admin')
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

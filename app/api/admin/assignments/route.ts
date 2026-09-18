import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient, insertResilient , isActiveStaff } from '@/lib/supabase/server'
import { inferAssignmentOrigin } from '@/lib/utils'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function assertAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (data?.role !== 'admin' && !(await isActiveStaff(user.id))) throw new Error('Geen toegang')
  return user
}

// POST — create a new freelancer assignment
export async function POST(req: NextRequest) {
  try {
    await assertAdmin()
    const admin = createAdminSupabaseClient()
    const body = await req.json()
    const {
      title,
      description,
      roles,
      service_slug,
      client_id,
      freelancer_id,
      budget,
      deadline,
    } = body

    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'Titel is verplicht' }, { status: 400 })
    }

    const rolesArr: string[] = Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : []
    if (rolesArr.length === 0) {
      return NextResponse.json({ error: 'Minstens één rol is verplicht' }, { status: 400 })
    }

    // `role` is the singular column from the legacy schema (NOT NULL there);
    // `roles` is the modern array column. insertResilient drops whichever column
    // the live DB lacks and retries, so this works on any schema version.
    const { data, error } = await insertResilient(
      admin,
      'freelancer_assignments',
      {
        title: title.trim(),
        description: description?.trim() || null,
        role: rolesArr[0],
        roles: rolesArr,
        service_slug: service_slug || null,
        client_id: client_id || null,
        freelancer_id: freelancer_id || null,
        budget: budget ?? null,
        deadline: deadline || null,
        status: 'open',
        origin: 'admin',   // NextGenMedia → partner (outbound)
      },
      { required: ['title', 'status'] },
    )
    if (error) throw new Error(error.message)

    try {
      revalidatePath('/admin/assignments')
      if (freelancer_id) revalidatePath(`/admin/partners/${freelancer_id}`)
    } catch { }

    return NextResponse.json({ id: data?.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — update assignment (status, roles, budget, assignment to partner, etc.)
const ALLOWED_PATCH_FIELDS = new Set([
  'status', 'title', 'description', 'budget', 'payout',
  'deadline', 'freelancer_id', 'client_id', 'service_slug',
])
const ALLOWED_STATUSES = new Set(['open', 'in_progress', 'completed', 'cancelled'])

export async function PATCH(req: NextRequest) {
  try {
    await assertAdmin()
    const admin = createAdminSupabaseClient()
    const { id, ...rest } = await req.json()
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rest)) {
      if (ALLOWED_PATCH_FIELDS.has(k) && v !== undefined) patch[k] = v
    }
    if (patch.status !== undefined && !ALLOWED_STATUSES.has(patch.status as string)) {
      return NextResponse.json({ error: `Ongeldige status: ${patch.status}` }, { status: 400 })
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    }

    // When an assignment is completed, create the correct ledger entry based on
    // its direction. select('*') so a missing column never makes this fail.
    //
    //  ┌ origin    ┌ deal_type   → ledger meaning
    //  │ admin     │ (fixed)     → we hired the partner (subcontract): WE PAY PARTNER
    //  │ partner   │ fixed       → partner gave US a job for a fixed price: PARTNER PAYS US
    //  │ partner   │ commission  → referral; commission is handled via commission
    //  │           │               deals (10/8/5%), so NO automatic ledger entry here
    let didAutoPayout = false
    if (patch.status === 'completed') {
      const { data: existing } = await admin
        .from('freelancer_assignments')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (existing && existing.status !== 'completed' && existing.freelancer_id) {
        // Use the heuristic so direction is correct even before the
        // origin/deal_type columns are migrated.
        const origin = inferAssignmentOrigin(existing)
        const dealType = existing.deal_type === 'commission' ? 'commission' : 'fixed'
        const amount = Number(existing.payout ?? existing.budget ?? 0)

        // Commission proposals do NOT settle the full amount — skip.
        if (dealType !== 'commission' && amount > 0) {
          const partnerPaysUs = origin === 'partner'   // inbound fixed = partner owes us
          const { error: ledgerErr } = await insertResilient(
            admin,
            'partner_ledger_entries',
            {
              freelancer_id: existing.freelancer_id,
              kind: partnerPaysUs ? 'service_billed' : 'payout_owed',
              direction: partnerPaysUs ? 'partner_pays_us' : 'we_pay_partner',
              // amount sign mirrors direction: negative = partner owes us
              amount: partnerPaysUs ? -amount : amount,
              client_id: existing.client_id ?? null,
              assignment_id: existing.id,
              description: partnerPaysUs
                ? `Onderaanneming (partner betaalt ons): ${existing.title}`
                : `Opdracht afgerond (wij betalen partner): ${existing.title}`,
              occurred_on: new Date().toISOString().slice(0, 10),
              status: 'pending',
            },
            { required: ['freelancer_id', 'amount'] },
          )
          if (!ledgerErr) didAutoPayout = true
          else console.error('[assignments] auto-ledger insert failed:', ledgerErr.message)
        }
      }
    }

    // Update resiliently: drop a patch key the schema lacks (e.g. payout) and retry.
    let updateErr = (await admin.from('freelancer_assignments').update(patch).eq('id', id)).error
    if (updateErr) {
      const msg = updateErr.message ?? ''
      const match = msg.match(/'([^']+)' column/i) || msg.match(/column "?([a-z0-9_]+)"?/i)
      const badCol = match?.[1]
      if (badCol && badCol in patch) {
        delete patch[badCol]
        if (Object.keys(patch).length > 0) {
          updateErr = (await admin.from('freelancer_assignments').update(patch).eq('id', id)).error
        } else {
          updateErr = null
        }
      }
    }
    if (updateErr) throw new Error(updateErr.message)

    try {
      revalidatePath('/admin/assignments')
      revalidatePath('/admin/partners')
    } catch { }

    return NextResponse.json({ ok: true, auto_payout: didAutoPayout })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — permanently remove an assignment
export async function DELETE(req: NextRequest) {
  try {
    await assertAdmin()
    const admin = createAdminSupabaseClient()
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    // Best-effort: detach any ledger entries that referenced this assignment
    try { await admin.from('partner_ledger_entries').update({ assignment_id: null }).eq('assignment_id', id) } catch { }

    const { error } = await admin.from('freelancer_assignments').delete().eq('id', id)
    if (error) throw new Error(error.message)

    try {
      revalidatePath('/admin/assignments')
      revalidatePath('/admin/partners')
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

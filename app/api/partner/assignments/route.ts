import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient, insertResilient } from '@/lib/supabase/server'
import { inferAssignmentOrigin } from '@/lib/utils'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// POST — partner creates a new inbound assignment proposal for NextGenMedia
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

    const { data: partner } = await supabase
      .from('freelancers')
      .select('id, name')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!partner) return NextResponse.json({ error: 'Geen partneraccount' }, { status: 403 })

    const {
      title,
      description,
      service_slug,
      proposed_budget,
      proposed_hours,
      hourly_rate,
      deadline,
      deal_type,   // 'commission' | 'fixed'
    } = await req.json()

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Titel is verplicht' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    // ── COMMISSION lead: partner refers a client/job for us to run ──────────
    // We create an assignment marked as commission so admin sees it under
    // "Inkomend". Admin later attaches the contract value via a commission deal.
    if (deal_type === 'commission') {
      const { data: row, error } = await insertResilient(
        admin,
        'freelancer_assignments',
        {
          title: title.trim(),
          description: description?.trim() || null,
          freelancer_id: partner.id,
          service_slug: service_slug || null,
          budget: null,
          payout: null,
          deadline: deadline || null,
          status: 'open',
          origin: 'partner',
          deal_type: 'commission',
          role: 'other',
          roles: [],
        },
        { required: ['title', 'freelancer_id', 'status'] },
      )
      if (error) throw new Error(error.message)
      try {
        revalidatePath('/partner/assignments')
        revalidatePath('/admin/assignments')
      } catch { }
      return NextResponse.json({ id: row?.id })
    }

    // ── FIXED proposal: partner asks us to do work for a fixed amount ───────
    // Compute budget from hours × rate if not directly supplied
    const budget = proposed_budget ?? (
      proposed_hours && hourly_rate
        ? Math.round(proposed_hours * hourly_rate * 100) / 100
        : null
    )

    // Insert resiliently: optional columns (role, roles, payout, service_slug)
    // exist only in some schema versions. The helper drops any column the live
    // DB doesn't have and retries, so this works regardless of applied migrations.
    const { data: row, error } = await insertResilient(
      admin,
      'freelancer_assignments',
      {
        title: title.trim(),
        description: description?.trim() || null,
        freelancer_id: partner.id,
        service_slug: service_slug || null,
        budget: budget ?? null,
        payout: budget ?? null,   // proposed payout = proposed budget by default
        deadline: deadline || null,
        status: 'open',           // visible to admin immediately
        origin: 'partner',        // inbound proposal from partner → NextGenMedia
        deal_type: 'fixed',       // fixed-amount subcontract proposal
        role: 'other',            // present in legacy schema (NOT NULL there)
        roles: [],                // present in newer schema
      },
      { required: ['title', 'freelancer_id', 'status'] },
    )

    if (error) throw new Error(error.message)

    try {
      revalidatePath('/partner/assignments')
      revalidatePath('/admin/assignments')
    } catch { }

    return NextResponse.json({ id: row?.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

const ALLOWED_STATUSES = new Set(['in_progress', 'completed', 'cancelled'])

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

    const { data: partner } = await supabase
      .from('freelancers').select('id').eq('user_id', user.id).maybeSingle()
    if (!partner) return NextResponse.json({ error: 'Geen partneraccount' }, { status: 403 })

    const { id, status } = await req.json()
    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Ongeldige status' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    // Load the assignment (scoped to this partner) to enforce direction rules.
    const { data: existing } = await admin
      .from('freelancer_assignments')
      .select('*')
      .eq('id', id)
      .eq('freelancer_id', partner.id)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: 'Opdracht niet gevonden' }, { status: 404 })
    }

    const origin = inferAssignmentOrigin(existing)
    const current = existing.status as string

    // ── Authorization matrix ──────────────────────────────────────────────
    // received (admin → partner): partner may accept (open→in_progress),
    //   complete (in_progress→completed) or reject (→cancelled).
    // proposed (partner → admin): partner may NOT self-approve. They can only
    //   withdraw an open proposal (open→cancelled), or, once admin approved it
    //   (in_progress), mark it completed.
    let allowed = false
    if (origin === 'admin') {
      allowed =
        (current === 'open' && (status === 'in_progress' || status === 'cancelled')) ||
        (current === 'in_progress' && (status === 'completed' || status === 'cancelled'))
    } else {
      // proposed by this partner
      allowed =
        (current === 'open' && status === 'cancelled') ||              // withdraw
        (current === 'in_progress' && status === 'completed')          // finish approved work
    }

    if (!allowed) {
      const msg = origin === 'partner' && current === 'open' && status === 'in_progress'
        ? 'Je eigen voorstel moet eerst door NextGenMedia goedgekeurd worden.'
        : 'Deze statuswijziging is niet toegestaan.'
      return NextResponse.json({ error: msg }, { status: 403 })
    }

    // Create the correct ledger entry on completion, based on direction:
    //   received (admin → partner): we owe the partner (we_pay_partner)
    //   proposed fixed (partner → us): the partner owes us (partner_pays_us)
    //   proposed commission: handled via commission deals → no auto entry
    let didAutoPayout = false
    if (status === 'completed' && current !== 'completed') {
      const dealType = existing.deal_type === 'commission' ? 'commission' : 'fixed'
      const amount = Number(existing.payout ?? existing.budget ?? 0)

      if (dealType !== 'commission' && amount > 0) {
        const partnerPaysUs = origin === 'partner'   // inbound fixed proposal
        const { error: ledgerErr } = await insertResilient(
          admin,
          'partner_ledger_entries',
          {
            freelancer_id: partner.id,
            kind: partnerPaysUs ? 'service_billed' : 'payout_owed',
            direction: partnerPaysUs ? 'partner_pays_us' : 'we_pay_partner',
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
        else console.error('[partner/assignments] auto-ledger failed:', ledgerErr.message)
      }
    }

    const { error } = await admin
      .from('freelancer_assignments')
      .update({ status })
      .eq('id', id)
      .eq('freelancer_id', partner.id)
    if (error) throw new Error(error.message)

    try {
      revalidatePath('/partner/assignments')
      revalidatePath('/partner')
      revalidatePath('/admin/assignments')
    } catch { }

    return NextResponse.json({ ok: true, auto_payout: didAutoPayout })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

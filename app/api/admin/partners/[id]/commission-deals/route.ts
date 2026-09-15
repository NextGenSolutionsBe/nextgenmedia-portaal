import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff, insertResilient } from '@/lib/supabase/server'
import { commissionForSale } from '@/lib/utils'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// A commission deal = a REFERRAL: partner brought us this client on `start_date`
// (the first-referral date). Each later SALE to that client earns commission at
// the rate of the referral year it falls in (10% / 8% / 5%).

// POST — create a referral relationship
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id: freelancerId } = await params
    const body = await req.json()

    const { client_id, label, service_slug, start_date, pct_year_1, pct_year_2, pct_year_3, notes } = body

    if (!client_id && !label?.trim()) {
      return NextResponse.json({ error: 'Kies een klant of geef een naam/label op' }, { status: 400 })
    }

    // direction: 'we_pay_partner' (partner verwees klant naar ons) of
    //            'partner_pays_us' (wij verwezen klant naar partner).
    const direction = body.direction === 'partner_pays_us' ? 'partner_pays_us' : 'we_pay_partner'

    const admin = createAdminSupabaseClient()
    const { data, error } = await insertResilient(
      admin,
      'partner_commission_deals',
      {
        freelancer_id: freelancerId,
        client_id: client_id || null,
        label: label?.trim() || null,
        service_slug: service_slug || null,
        contract_value: 0,                                  // per-sale model; not used upfront
        direction,
        start_date: start_date || new Date().toISOString().slice(0, 10),
        pct_year_1: pct_year_1 != null ? Number(pct_year_1) : 10,
        pct_year_2: pct_year_2 != null ? Number(pct_year_2) : 8,
        pct_year_3: pct_year_3 != null ? Number(pct_year_3) : 5,
        status: 'active',
        notes: notes?.trim() || null,
      },
      { select: '*', required: ['freelancer_id'] },
    )
    if (error) throw new Error(error.message)

    try { revalidatePath(`/admin/partners/${freelancerId}`) } catch { }
    return NextResponse.json({ deal: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — add a sale to a referral, OR edit the referral's fields
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id: freelancerId } = await params
    const body = await req.json()
    const { deal_id, action } = body

    if (!deal_id) return NextResponse.json({ error: 'deal_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()

    const { data: deal } = await admin
      .from('partner_commission_deals')
      .select('*')
      .eq('id', deal_id)
      .eq('freelancer_id', freelancerId)
      .maybeSingle()
    if (!deal) return NextResponse.json({ error: 'Doorverwijzing niet gevonden' }, { status: 404 })

    // ── Add a sale → compute commission for that year → ledger + sale row ────
    if (action === 'add_sale') {
      const saleAmount = Number(body.sale_amount)
      const saleDate = (body.sale_date as string) || new Date().toISOString().slice(0, 10)
      if (!saleAmount || saleAmount <= 0) {
        return NextResponse.json({ error: 'Verkoopbedrag is verplicht' }, { status: 400 })
      }

      const { year, pct, amount } = commissionForSale(
        {
          referred_at: deal.start_date,
          pct_year_1: deal.pct_year_1,
          pct_year_2: deal.pct_year_2,
          pct_year_3: deal.pct_year_3,
        },
        saleAmount,
        saleDate,
      )
      if (amount <= 0) return NextResponse.json({ error: 'Commissie is 0' }, { status: 400 })

      const dealName = deal.label || 'doorverwezen klant'
      const saleDesc = body.description?.trim()

      // Direction of the commission follows the referral direction:
      //   we_pay_partner  → wij betalen partner (amount positief)   · scenario 1
      //   partner_pays_us → partner betaalt ons (amount negatief)   · scenario 2
      const direction = deal.direction === 'partner_pays_us' ? 'partner_pays_us' : 'we_pay_partner'
      const wePay = direction === 'we_pay_partner'

      // 1) Create the ledger entry for the commission, in the correct direction
      const { data: ledger, error: ledgerErr } = await insertResilient(
        admin,
        'partner_ledger_entries',
        {
          freelancer_id: freelancerId,
          kind: 'commission_owed',
          direction,
          amount: wePay ? amount : -amount,
          client_id: deal.client_id ?? null,
          commission_deal_id: deal_id,
          commission_year: year,
          description: `Commissie ${pct}% (jaar ${year})${wePay ? '' : ' — partner betaalt ons'} — ${saleDesc ? saleDesc + ' · ' : ''}${dealName}`,
          occurred_on: saleDate,
          status: 'pending',
        },
        { select: '*', required: ['freelancer_id', 'amount'] },
      )
      if (ledgerErr) throw new Error(ledgerErr.message)

      // 2) Record the sale (best effort — table may not be migrated yet)
      await insertResilient(
        admin,
        'partner_commission_sales',
        {
          deal_id,
          freelancer_id: freelancerId,
          service_slug: body.service_slug || null,
          description: saleDesc || null,
          sale_amount: saleAmount,
          sale_date: saleDate,
          commission_year: year,
          commission_pct: pct,
          commission_amount: amount,
          ledger_id: ledger?.id ?? null,
        },
        { required: ['deal_id', 'freelancer_id', 'sale_amount'] },
      )

      try { revalidatePath(`/admin/partners/${freelancerId}`) } catch { }
      return NextResponse.json({ ok: true, year, pct, amount })
    }

    // ── Edit referral fields ────────────────────────────────────────────────
    const patch: Record<string, unknown> = {}
    for (const k of ['label', 'service_slug', 'start_date', 'pct_year_1', 'pct_year_2', 'pct_year_3', 'status', 'notes', 'client_id', 'direction'] as const) {
      if (body[k] !== undefined) patch[k] = body[k]
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    }
    const { error } = await admin.from('partner_commission_deals').update(patch).eq('id', deal_id)
    if (error) throw new Error(error.message)

    try { revalidatePath(`/admin/partners/${freelancerId}`) } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — remove a referral (?deal_id=) or a single sale (?sale_id=)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id: freelancerId } = await params
    const dealId = req.nextUrl.searchParams.get('deal_id')
    const saleId = req.nextUrl.searchParams.get('sale_id')
    const admin = createAdminSupabaseClient()

    // Delete a single sale (and its ledger entry if still pending)
    if (saleId) {
      const { data: sale } = await admin
        .from('partner_commission_sales')
        .select('*')
        .eq('id', saleId)
        .eq('freelancer_id', freelancerId)
        .maybeSingle()
      if (sale?.ledger_id) {
        // Only remove the ledger entry if it hasn't been settled yet.
        try {
          await admin.from('partner_ledger_entries').delete().eq('id', sale.ledger_id).eq('status', 'pending')
        } catch { }
      }
      const { error } = await admin.from('partner_commission_sales').delete().eq('id', saleId).eq('freelancer_id', freelancerId)
      if (error) throw new Error(error.message)
      try { revalidatePath(`/admin/partners/${freelancerId}`) } catch { }
      return NextResponse.json({ ok: true })
    }

    if (!dealId) return NextResponse.json({ error: 'deal_id of sale_id vereist' }, { status: 400 })

    // Delete the referral. Its sales cascade; also clean up pending ledger entries.
    try {
      await admin.from('partner_ledger_entries').delete().eq('commission_deal_id', dealId).eq('status', 'pending')
    } catch { }
    const { error } = await admin
      .from('partner_commission_deals')
      .delete()
      .eq('id', dealId)
      .eq('freelancer_id', freelancerId)
    if (error) throw new Error(error.message)

    try { revalidatePath(`/admin/partners/${freelancerId}`) } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

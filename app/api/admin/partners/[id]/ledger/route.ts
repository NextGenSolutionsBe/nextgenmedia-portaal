import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient, insertResilient , isActiveStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

const VALID_KINDS = ['commission_owed', 'payout_owed', 'service_billed', 'manual_credit', 'manual_debit']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { id } = await params
    const body = await req.json()
    const { kind, amount, client_id, description, occurred_on } = body

    if (!VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'Ongeldig type' }, { status: 400 })
    }
    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      return NextResponse.json({ error: 'Bedrag is verplicht' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    // Verify partner exists
    const { data: partner } = await admin.from('freelancers').select('id').eq('id', id).maybeSingle()
    if (!partner) return NextResponse.json({ error: 'Partner niet gevonden' }, { status: 404 })

    // Direction is explicit: positive amount = we pay the partner,
    // negative amount = partner pays us. Allow an explicit override too.
    const numAmount = Number(amount)
    const direction: string = body.direction === 'partner_pays_us' || body.direction === 'we_pay_partner'
      ? body.direction
      : (numAmount >= 0 ? 'we_pay_partner' : 'partner_pays_us')

    const { data, error } = await insertResilient(
      admin,
      'partner_ledger_entries',
      {
        freelancer_id: id,
        kind,
        amount: numAmount,
        direction,
        client_id: client_id || null,
        description: description || null,
        occurred_on: occurred_on || new Date().toISOString().slice(0, 10),
        status: 'pending',
        created_by: user.id,
      },
      { select: '*', required: ['freelancer_id', 'amount'] },
    )

    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'partner.ledger.create', entityType: 'partner_ledger_entry', entityId: String(data?.id ?? ''),
      summary: `Ledgerpost toegevoegd (${kind}, €${Math.abs(numAmount)})`,
      actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin',
      metadata: { partner_id: id, kind, amount: numAmount, direction }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ entry: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

type LedgerRij = {
  id: string; kind: string; status: string; amount: number; direction: string | null
  settlement_id: string | null; commission_deal_id?: string | null; assignment_id?: string | null
}

/**
 * Enkel handmatige posten zijn vrij aan te passen. Posten uit een
 * doorverwijzing (commissie), een afgeronde opdracht of een afrekening horen
 * bij hun bron: wijzigen/verwijderen gebeurt daar, anders lopen bron en
 * ledger uit elkaar. Geeft de reden terug waarom het niet mag, of null.
 */
function waaromVast(e: LedgerRij): string | null {
  if (e.kind === 'settlement' || e.settlement_id || e.status === 'settled') {
    return 'Deze post is al afgerekend en hoort bij een afrekening. Draai eerst de afrekening terug.'
  }
  if (e.commission_deal_id || e.kind === 'commission_owed') {
    return 'Deze commissiepost komt uit een doorverwijzing. Pas de verkoop aan of verwijder ze bij ‘Doorverwijzingen’.'
  }
  if (e.assignment_id) {
    return 'Deze post komt uit een afgeronde opdracht. Pas de opdracht aan bij ‘Opdrachten’.'
  }
  return null
}

async function haalPost(admin: ReturnType<typeof createAdminSupabaseClient>, partnerId: string, entryId: string) {
  const { data } = await admin.from('partner_ledger_entries').select('*')
    .eq('id', entryId).eq('freelancer_id', partnerId).maybeSingle()
  return (data ?? null) as LedgerRij | null
}

// PATCH { entry_id, amount?, description?, occurred_on?, client_id? } — handmatige post bewerken.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const entryId = String(body.entry_id ?? '')
    if (!entryId) return NextResponse.json({ error: 'entry_id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const post = await haalPost(admin, id, entryId)
    if (!post) return NextResponse.json({ error: 'Post niet gevonden' }, { status: 404 })
    const reden = waaromVast(post)
    if (reden) return NextResponse.json({ error: reden }, { status: 409 })

    const patch: Record<string, unknown> = {}
    if (body.amount !== undefined) {
      const n = Math.abs(Number(body.amount))
      if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: 'Geef een geldig bedrag.' }, { status: 400 })
      // Teken volgt de richting: negatief = partner betaalt ons.
      const dir = post.direction === 'partner_pays_us' || post.direction === 'we_pay_partner'
        ? post.direction : (Number(post.amount) >= 0 ? 'we_pay_partner' : 'partner_pays_us')
      patch.amount = dir === 'partner_pays_us' ? -n : n
    }
    if (body.description !== undefined) {
      const d = String(body.description ?? '').trim().slice(0, 500)
      if (!d) return NextResponse.json({ error: 'Omschrijving mag niet leeg zijn.' }, { status: 400 })
      patch.description = d
    }
    if (body.occurred_on !== undefined) {
      const d = String(body.occurred_on ?? '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return NextResponse.json({ error: 'Ongeldige datum.' }, { status: 400 })
      patch.occurred_on = d
    }
    if (body.client_id !== undefined) patch.client_id = body.client_id || null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })

    const { error } = await admin.from('partner_ledger_entries').update(patch).eq('id', entryId).eq('freelancer_id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'partner.ledger.update', entityType: 'partner_ledger_entry', entityId: entryId,
      summary: 'Ledgerpost bijgewerkt', actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin',
      metadata: { partner_id: id, velden: Object.keys(patch), oud_bedrag: post.amount, nieuw_bedrag: patch.amount ?? post.amount },
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?entry_id= — handmatige post verwijderen.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const entryId = req.nextUrl.searchParams.get('entry_id') ?? ''
    if (!entryId) return NextResponse.json({ error: 'entry_id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const post = await haalPost(admin, id, entryId)
    if (!post) return NextResponse.json({ error: 'Post niet gevonden' }, { status: 404 })
    const reden = waaromVast(post)
    if (reden) return NextResponse.json({ error: reden }, { status: 409 })

    const { error } = await admin.from('partner_ledger_entries').delete().eq('id', entryId).eq('freelancer_id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'partner.ledger.delete', entityType: 'partner_ledger_entry', entityId: entryId,
      summary: `Ledgerpost verwijderd (${post.kind}, €${Math.abs(Number(post.amount))})`,
      actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin',
      metadata: { partner_id: id, kind: post.kind, amount: post.amount }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

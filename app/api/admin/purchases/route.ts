import { leesGetal } from '@/lib/getal'
import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { FOUNDER_EMAILS } from '@/lib/founders'
import { randomUUID } from 'crypto'
import { bevestigAankoop, volgendNummer } from '@/lib/aankopen/bewijs'
import { laadAankoopActor, rechtenVoor } from '@/lib/aankopen/rechten'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const THRESHOLD = 1000          // € incl. btw — boven deze drempel is goedkeuring nodig
const BUCKET = 'contracts'

// Wie moet er goedkeuren: de zaakvoerders behalve de aanvrager.
function requiredApprovers(requesterEmail: string | null): string[] {
  const req = (requesterEmail ?? '').toLowerCase()
  return FOUNDER_EMAILS.filter((e) => e.toLowerCase() !== req)
}

async function recomputeStatus(admin: ReturnType<typeof createAdminSupabaseClient>, purchaseId: string, requesterEmail: string | null, needsApproval: boolean): Promise<string> {
  if (!needsApproval) return 'approved_under_threshold'
  const { data: appr } = await admin.from('purchase_approvals').select('approver_email, decision').eq('purchase_id', purchaseId)
  const rows = appr ?? []
  if (rows.some((a) => a.decision === 'rejected')) return 'rejected'
  const required = requiredApprovers(requesterEmail).map((e) => e.toLowerCase())
  const approved = new Set(rows.filter((a) => a.decision === 'approved').map((a) => (a.approver_email ?? '').toLowerCase()))
  return required.every((e) => approved.has(e)) ? 'approved' : 'pending'
}

// POST (multipart) — nieuwe aankoopaanvraag
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const fd = await req.formData()
    const title = (fd.get('title') as string)?.trim()
    const amountExcl = (leesGetal(fd.get('amount_excl')) ?? NaN)
    const vatPct = (leesGetal(fd.get('vat_pct')) ?? 21)
    if (!title) return NextResponse.json({ error: 'Titel is verplicht' }, { status: 400 })
    if (!amountExcl || amountExcl <= 0) return NextResponse.json({ error: 'Bedrag is verplicht' }, { status: 400 })

    const incl = amountExcl * (1 + vatPct / 100)
    const needsApproval = incl > THRESHOLD
    const isConcept = fd.get('concept') === 'true'
    const status = isConcept ? 'concept' : needsApproval ? 'pending' : 'approved_under_threshold'

    const admin = createAdminSupabaseClient()

    // Optionele bijlage
    let attachmentPath: string | null = null
    const file = fd.get('attachment') as File | null
    if (file && file.size > 0) {
      const ext = (file.name.split('.').pop() ?? 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'
      const path = `purchases/${randomUUID()}.${ext}`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false })
      if (!upErr) attachmentPath = path
    }

    // Aanvraagnummer (AA-2026-001), per jaar genummerd.
    let reference: string | null = null
    try { reference = await volgendNummer(admin, 'aanvraag', new Date().getFullYear()) } catch { reference = null }

    const { data, error } = await admin.from('purchases').insert({
      reference,
      title, description: (fd.get('description') as string)?.trim() || null,
      amount_excl: amountExcl, vat_pct: vatPct,
      supplier: (fd.get('supplier') as string)?.trim() || null,
      category: (fd.get('category') as string)?.trim() || null,
      requester_user_id: actor.id, requester_email: actor.email ?? null,
      entry_date: (fd.get('entry_date') as string) || new Date().toISOString().slice(0, 10),
      attachment_path: attachmentPath, status, needs_approval: needsApproval,
    }).select('id').single()
    if (error) throw new Error(error.message)
    // Onder de drempel is de aanvraag meteen bevestigd → bewijsdocument (best-effort).
    if (status === 'approved_under_threshold') { try { await bevestigAankoop(admin, data.id, actor.email ?? null) } catch (e) { console.error('[purchases] bewijs:', e instanceof Error ? e.message : e) } }

    const meta = requestMeta(req)
    await logAudit({
      action: 'purchase.create', entityType: 'purchase', entityId: data.id,
      summary: `Aankoopaanvraag "${title}" (${incl.toFixed(0)} incl.) — ${status}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { amount_incl: incl, needs_approval: needsApproval, status }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH (json) — action: decide | submit | add_cost
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const body = await req.json()
    const { purchase_id, action } = body
    if (!purchase_id) return NextResponse.json({ error: 'purchase_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()

    const { data: p } = await admin.from('purchases').select('*').eq('id', purchase_id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Aankoop niet gevonden' }, { status: 404 })
    if (p.deleted_at) return NextResponse.json({ error: 'Deze aanvraag is verwijderd. Herstel ze eerst vanuit het archief.' }, { status: 409 })
    const meta = requestMeta(req)

    if (action === 'decide') {
      const decision = body.decision === 'rejected' ? 'rejected' : 'approved'
      if ((p.requester_email ?? '').toLowerCase() === (actor.email ?? '').toLowerCase()) {
        return NextResponse.json({ error: 'Je kan je eigen aanvraag niet goedkeuren' }, { status: 400 })
      }
      if (!requiredApprovers(p.requester_email).map(e => e.toLowerCase()).includes((actor.email ?? '').toLowerCase())) {
        return NextResponse.json({ error: 'Je goedkeuring is niet vereist voor deze aanvraag' }, { status: 400 })
      }
      // upsert beslissing (één per goedkeurder)
      const { data: existing } = await admin.from('purchase_approvals').select('id').eq('purchase_id', purchase_id).eq('approver_email', actor.email).maybeSingle()
      const payload = { purchase_id, approver_user_id: actor.id, approver_email: actor.email, decision, comment: body.comment?.trim() || null, decided_at: new Date().toISOString() }
      if (existing) await admin.from('purchase_approvals').update(payload).eq('id', existing.id)
      else await admin.from('purchase_approvals').insert(payload)

      const newStatus = await recomputeStatus(admin, purchase_id, p.requester_email, p.needs_approval)
      await admin.from('purchases').update({ status: newStatus }).eq('id', purchase_id)
      // Beide zaakvoerders akkoord → officieel bevestigd → bewijsdocument (best-effort, één keer per versie).
      if (newStatus === 'approved') { try { await bevestigAankoop(admin, purchase_id, actor.email ?? null) } catch (e) { console.error('[purchases] bewijs:', e instanceof Error ? e.message : e) } }

      await logAudit({
        action: decision === 'approved' ? 'purchase.approve' : 'purchase.reject',
        entityType: 'purchase', entityId: purchase_id, summary: `Aankoop "${p.title}" ${decision === 'approved' ? 'goedgekeurd' : 'afgekeurd'} → ${newStatus}`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
        metadata: { decision, comment: body.comment ?? null }, ip: meta.ip, userAgent: meta.userAgent,
      })
      return NextResponse.json({ ok: true, status: newStatus })
    }

    if (action === 'submit') {
      const newStatus = p.needs_approval ? 'pending' : 'approved_under_threshold'
      await admin.from('purchases').update({ status: newStatus }).eq('id', purchase_id)
      if (newStatus === 'approved_under_threshold') { try { await bevestigAankoop(admin, purchase_id, actor.email ?? null) } catch (e) { console.error('[purchases] bewijs:', e instanceof Error ? e.message : e) } }
      return NextResponse.json({ ok: true, status: newStatus })
    }

    if (action === 'add_cost') {
      if (!['approved', 'approved_under_threshold'].includes(p.status)) return NextResponse.json({ error: 'Alleen goedgekeurde aankopen' }, { status: 400 })
      if (p.cost_entry_id) return NextResponse.json({ error: 'Al toegevoegd als kost' }, { status: 400 })
      const { data: cost, error } = await admin.from('cost_entries').insert({
        name: p.title, category: p.category || 'Aankoop', type: 'one_time',
        cost_date: p.entry_date, amount_excl: p.amount_excl, vat_pct: p.vat_pct,
        notes: `Aankoop goedgekeurd in app${p.supplier ? ' · ' + p.supplier : ''}`,
      }).select('id').single()
      if (error) throw new Error(error.message)
      await admin.from('purchases').update({ cost_entry_id: cost.id }).eq('id', purchase_id)
      await logAudit({
        action: 'purchase.add_cost', entityType: 'purchase', entityId: purchase_id,
        summary: `Aankoop "${p.title}" toegevoegd als kost`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
        metadata: { cost_entry_id: cost.id }, ip: meta.ip, userAgent: meta.userAgent,
      })
      return NextResponse.json({ ok: true, cost_id: cost.id })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?id= — veilig verwijderen (soft-delete naar het archief; nooit definitief)
export async function DELETE(req: NextRequest) {
  try {
    const actor = await laadAankoopActor()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: p } = await admin.from('purchases').select('*').eq('id', id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Aankoop niet gevonden' }, { status: 404 })
    if (p.deleted_at) return NextResponse.json({ ok: true, alVerwijderd: true })
    if (!rechtenVoor(actor, p).verwijderen) return NextResponse.json({ error: 'Je mag deze aanvraag niet verwijderen.' }, { status: 403 })
    const nu = new Date().toISOString()
    const { error } = await admin.from('purchases').update({ deleted_at: nu, deleted_by_email: actor.email, deleted_by_user_id: actor.id }).eq('id', id).is('deleted_at', null)
    if (error) throw new Error(error.message)
    await admin.from('purchase_edits').insert({ purchase_id: id, version: p.version ?? 1, actie: 'verwijderd', actor_user_id: actor.id, actor_email: actor.email, oud: { status: p.status }, nieuw: { deleted_at: nu } })
    const meta = requestMeta(req)
    await logAudit({ action: 'purchase.delete', entityType: 'purchase', entityId: id, summary: `Aankoopaanvraag ${p.reference ?? ''} "${p.title ?? ''}" verwijderd (archief)`, actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.isAdmin ? 'admin' : 'staff', ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { formulierGuard, migratieAntwoord, nieuwToken, isUuid } from '@/lib/formulieren/server'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

/**
 * Een deellink aanmaken — optioneel voor een klant, met label, vervaldatum en
 * "eenmalig". Er wordt NIETS gemaild: klantmails zijn altijd handmatig (de
 * builder biedt kopiëren en de MailComposer met preview + bevestiging).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const g = await formulierGuard('toevoegen')
    if (!g.ok) return g.response
    if (!isUuid(params.id)) return NextResponse.json({ error: 'Formulier niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()

    const { data: f, error: fFout } = await admin.from('formulieren').select('id, titel').eq('id', params.id).maybeSingle()
    if (fFout) return migratieAntwoord(fFout.message) ?? NextResponse.json({ error: safeMessage(fFout, 'formulier-link') }, { status: 500 })
    if (!f) return NextResponse.json({ error: 'Formulier niet gevonden' }, { status: 404 })

    let clientId: string | null = null
    let klantNaam: string | null = null
    if (b.client_id) {
      if (!isUuid(b.client_id)) return NextResponse.json({ error: 'Ongeldige klant' }, { status: 400 })
      const { data: c } = await admin.from('clients').select('id, company_name').eq('id', b.client_id).maybeSingle()
      if (!c) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })
      clientId = c.id; klantNaam = c.company_name ?? null
    }

    let verlooptOp: string | null = null
    if (b.verloopt_op) {
      const s = String(b.verloopt_op)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NextResponse.json({ error: 'Ongeldige vervaldatum' }, { status: 400 })
      // Geldig t.e.m. het einde van die dag (Belgische tijd, ruim genomen).
      verlooptOp = new Date(`${s}T23:59:59+02:00`).toISOString()
      if (new Date(verlooptOp).getTime() < Date.now()) return NextResponse.json({ error: 'De vervaldatum ligt in het verleden.' }, { status: 400 })
    }

    const label = String(b.label ?? '').trim().slice(0, 120) || null
    const rij = { formulier_id: f.id, client_id: clientId, token: nieuwToken(), label, verloopt_op: verlooptOp, eenmalig: b.eenmalig === true, created_by: g.actor.userId }
    const { data, error } = await admin.from('formulier_links').insert(rij).select('id, client_id, token, label, verloopt_op, ingetrokken_op, eenmalig, created_at').single()
    if (error) return NextResponse.json({ error: safeMessage(error, 'formulier-link') }, { status: 500 })

    const meta = requestMeta(req)
    await logAudit({
      action: 'formulier.link.create', entityType: 'formulier', entityId: f.id,
      summary: `Deellink aangemaakt voor "${f.titel}"${klantNaam ? ` — ${klantNaam}` : ' (algemeen)'}`,
      actorUserId: g.actor.userId, actorEmail: g.actor.email, actorRole: 'staff',
      metadata: { link_id: data.id, client_id: clientId, eenmalig: rij.eenmalig, verloopt_op: verlooptOp }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ link: { ...data, klant_naam: klantNaam, inzendingen: 0 } })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulier-link') }, { status: 400 })
  }
}

/** Een link intrekken (zacht: ingetrokken_op). Body: { link_id }. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const g = await formulierGuard('aanpassen')
    if (!g.ok) return g.response
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    if (!isUuid(params.id) || !isUuid(b.link_id)) return NextResponse.json({ error: 'Link niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('formulier_links')
      .update({ ingetrokken_op: new Date().toISOString() })
      .eq('id', b.link_id).eq('formulier_id', params.id).is('ingetrokken_op', null)
      .select('id, label, client_id').maybeSingle()
    if (error) return NextResponse.json({ error: safeMessage(error, 'formulier-link') }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Link niet gevonden of al ingetrokken' }, { status: 404 })
    const meta = requestMeta(req)
    await logAudit({
      action: 'formulier.link.revoke', entityType: 'formulier', entityId: params.id,
      summary: `Deellink ingetrokken${data.label ? `: ${data.label}` : ''}`,
      actorUserId: g.actor.userId, actorEmail: g.actor.email, actorRole: 'staff',
      metadata: { link_id: data.id, client_id: data.client_id }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulier-link') }, { status: 400 })
  }
}

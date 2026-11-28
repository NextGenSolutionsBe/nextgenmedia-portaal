import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { formulierGuard, migratieAntwoord, nieuwToken, isUuid } from '@/lib/formulieren/server'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Een deellink aanmaken — optioneel voor een klant, met label, vervaldatum en
 * "eenmalig". Er wordt NIETS gemaild: klantmails zijn altijd handmatig (de
 * builder biedt kopiëren en de MailComposer met preview + bevestiging).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const params = await ctx.params
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

/** Vervaldatum 'YYYY-MM-DD' → einde van die dag; leeg → null; ongeldig → fout. */
function leesVervaldatum(v: unknown): { ok: true; waarde: string | null } | { ok: false; fout: string } {
  if (v === null || v === undefined || v === '') return { ok: true, waarde: null }
  const s = String(v)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, fout: 'Ongeldige vervaldatum' }
  const iso = new Date(`${s}T23:59:59+02:00`).toISOString()
  if (new Date(iso).getTime() < Date.now()) return { ok: false, fout: 'De vervaldatum ligt in het verleden.' }
  return { ok: true, waarde: iso }
}

/**
 * Een link aanpassen. Body: { link_id, label?, client_id?, verloopt_op?, eenmalig? }.
 * Zonder een van die velden (enkel { link_id }) wordt de link ingetrokken
 * (zacht: ingetrokken_op) — zo blijven bestaande aanroepen werken.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const params = await ctx.params
    const g = await formulierGuard('aanpassen')
    if (!g.ok) return g.response
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    if (!isUuid(params.id) || !isUuid(b.link_id)) return NextResponse.json({ error: 'Link niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)

    const bewerkt = ['label', 'client_id', 'verloopt_op', 'eenmalig'].some((k) => k in b)
    if (bewerkt) {
      const { data: oud, error: oudFout } = await admin.from('formulier_links')
        .select('id, label, client_id, verloopt_op, eenmalig').eq('id', b.link_id).eq('formulier_id', params.id).maybeSingle()
      if (oudFout) return NextResponse.json({ error: safeMessage(oudFout, 'formulier-link') }, { status: 500 })
      if (!oud) return NextResponse.json({ error: 'Link niet gevonden' }, { status: 404 })

      const patch: Record<string, unknown> = {}
      let klantNaam: string | null | undefined
      if ('label' in b) patch.label = String(b.label ?? '').trim().slice(0, 120) || null
      if ('client_id' in b) {
        if (!b.client_id) { patch.client_id = null; klantNaam = null }
        else {
          if (!isUuid(b.client_id)) return NextResponse.json({ error: 'Ongeldige klant' }, { status: 400 })
          const { data: c } = await admin.from('clients').select('id, company_name').eq('id', b.client_id).maybeSingle()
          if (!c) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })
          patch.client_id = c.id; klantNaam = c.company_name ?? null
        }
      }
      if ('verloopt_op' in b) {
        // Een ongewijzigde (reeds verstreken) datum mag blijven staan; enkel een nieuwe datum moet in de toekomst liggen.
        const oudeDag = oud.verloopt_op ? new Date(oud.verloopt_op).toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }) : null
        if (b.verloopt_op && b.verloopt_op === oudeDag) patch.verloopt_op = oud.verloopt_op
        else {
          const v = leesVervaldatum(b.verloopt_op)
          if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
          patch.verloopt_op = v.waarde
        }
      }
      if ('eenmalig' in b) patch.eenmalig = b.eenmalig === true

      const { data, error } = await admin.from('formulier_links').update(patch).eq('id', oud.id)
        .select('id, client_id, token, label, verloopt_op, ingetrokken_op, eenmalig, created_at').maybeSingle()
      if (error) return NextResponse.json({ error: safeMessage(error, 'formulier-link') }, { status: 500 })
      if (!data) return NextResponse.json({ error: 'Link niet gevonden' }, { status: 404 })

      await logAudit({
        action: 'formulier.link.update', entityType: 'formulier', entityId: params.id,
        summary: `Deellink aangepast${data.label ? `: ${data.label}` : ''}`,
        actorUserId: g.actor.userId, actorEmail: g.actor.email, actorRole: 'staff',
        metadata: { link_id: data.id, voor: oud, na: patch }, ip: meta.ip, userAgent: meta.userAgent,
      })
      return NextResponse.json({ ok: true, link: klantNaam === undefined ? data : { ...data, klant_naam: klantNaam } })
    }

    const { data, error } = await admin.from('formulier_links')
      .update({ ingetrokken_op: new Date().toISOString() })
      .eq('id', b.link_id).eq('formulier_id', params.id).is('ingetrokken_op', null)
      .select('id, label, client_id').maybeSingle()
    if (error) return NextResponse.json({ error: safeMessage(error, 'formulier-link') }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Link niet gevonden of al ingetrokken' }, { status: 404 })
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

/**
 * Een link definitief verwijderen: ?link_id=… — enkel als er nog GEEN
 * inzendingen via die link binnenkwamen. Anders blijft intrekken de weg,
 * zodat de herkomst van die inzendingen bewaard blijft.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const params = await ctx.params
    const g = await formulierGuard('verwijderen')
    if (!g.ok) return g.response
    const linkId = req.nextUrl.searchParams.get('link_id')
    if (!isUuid(params.id) || !isUuid(linkId)) return NextResponse.json({ error: 'Link niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()

    const { data: link, error: lFout } = await admin.from('formulier_links')
      .select('id, label, client_id').eq('id', linkId).eq('formulier_id', params.id).maybeSingle()
    if (lFout) return NextResponse.json({ error: safeMessage(lFout, 'formulier-link') }, { status: 500 })
    if (!link) return NextResponse.json({ error: 'Link niet gevonden' }, { status: 404 })

    const { count, error: cFout } = await admin.from('formulier_inzendingen')
      .select('id', { count: 'exact', head: true }).eq('link_id', link.id)
    if (cFout) return NextResponse.json({ error: safeMessage(cFout, 'formulier-link') }, { status: 500 })
    if ((count ?? 0) > 0) {
      return NextResponse.json({
        error: `Via deze link ${count === 1 ? 'kwam 1 inzending' : `kwamen ${count} inzendingen`} binnen. Verwijderen kan dan niet (de herkomst zou verloren gaan) — trek de link in.`,
      }, { status: 409 })
    }

    const { error } = await admin.from('formulier_links').delete().eq('id', link.id)
    if (error) return NextResponse.json({ error: safeMessage(error, 'formulier-link') }, { status: 500 })

    const meta = requestMeta(req)
    await logAudit({
      action: 'formulier.link.delete', entityType: 'formulier', entityId: params.id,
      summary: `Deellink verwijderd${link.label ? `: ${link.label}` : ''}`,
      actorUserId: g.actor.userId, actorEmail: g.actor.email, actorRole: 'staff',
      metadata: { link_id: link.id, client_id: link.client_id }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulier-link') }, { status: 400 })
  }
}

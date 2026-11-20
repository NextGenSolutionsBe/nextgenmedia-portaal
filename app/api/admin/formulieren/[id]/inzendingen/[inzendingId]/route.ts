import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { formulierGuard, isUuid, BUCKET } from '@/lib/formulieren/server'
import { normaliseerVelden, isInzendingStatus, INZENDING_STATUS_INFO, type BestandAntwoord } from '@/lib/formulieren/model'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; inzendingId: string }> }

/**
 * Eén inzending openen: met tijdelijke downloadlinks (1 uur) voor bestanden.
 * Een nieuwe inzending wordt bij het openen automatisch "gezien".
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const params = await ctx.params
  try {
    const g = await formulierGuard('bekijken')
    if (!g.ok) return g.response
    if (!isUuid(params.id) || !isUuid(params.inzendingId)) return NextResponse.json({ error: 'Inzending niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const { data: r, error } = await admin.from('formulier_inzendingen')
      .select('id, formulier_id, link_id, client_id, antwoorden, velden_snapshot, naam, email, status, admin_notitie, created_at')
      .eq('id', params.inzendingId).eq('formulier_id', params.id).maybeSingle()
    if (error) return NextResponse.json({ error: safeMessage(error, 'formulier-inzending') }, { status: 500 })
    if (!r) return NextResponse.json({ error: 'Inzending niet gevonden' }, { status: 404 })

    let status = r.status as string
    if (status === 'nieuw') {
      const { error: upd } = await admin.from('formulier_inzendingen').update({ status: 'gezien' }).eq('id', r.id).eq('status', 'nieuw')
      if (!upd) status = 'gezien'
    }

    // Downloadlinks per bestandspad, met de oorspronkelijke naam als downloadnaam.
    const velden = normaliseerVelden(r.velden_snapshot ?? [])
    const antwoorden = (r.antwoorden ?? {}) as Record<string, unknown>
    const bestanden: Record<string, string> = {}
    for (const v of velden.filter((x) => x.type === 'bestand')) {
      const lijst = Array.isArray(antwoorden[v.id]) ? (antwoorden[v.id] as BestandAntwoord[]) : []
      for (const b of lijst) {
        if (!b?.pad || !b.pad.startsWith(`${params.id}/`)) continue
        try {
          const { data } = await admin.storage.from(BUCKET).createSignedUrl(b.pad, 3600, { download: b.naam || true })
          if (data?.signedUrl) bestanden[b.pad] = data.signedUrl
        } catch { /* ontbrekend bestand: geen link */ }
      }
    }

    let klant_naam: string | null = null
    if (r.client_id) {
      const { data: c } = await admin.from('clients').select('company_name').eq('id', r.client_id).maybeSingle()
      klant_naam = (c?.company_name as string | undefined) ?? null
    }
    return NextResponse.json({ inzending: { ...r, status, velden_snapshot: velden, klant_naam }, bestanden })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulier-inzending') }, { status: 400 })
  }
}

/** Status en/of interne notitie aanpassen. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params
  try {
    const g = await formulierGuard('aanpassen')
    if (!g.ok) return g.response
    if (!isUuid(params.id) || !isUuid(params.inzendingId)) return NextResponse.json({ error: 'Inzending niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    if ('status' in b) {
      if (!isInzendingStatus(b.status)) return NextResponse.json({ error: 'Ongeldige status' }, { status: 400 })
      patch.status = b.status
    }
    if ('admin_notitie' in b) patch.admin_notitie = String(b.admin_notitie ?? '').trim().slice(0, 5000) || null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Niets om aan te passen' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('formulier_inzendingen').select('id, status, naam').eq('id', params.inzendingId).eq('formulier_id', params.id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Inzending niet gevonden' }, { status: 404 })
    const { error } = await admin.from('formulier_inzendingen').update(patch).eq('id', oud.id)
    if (error) return NextResponse.json({ error: safeMessage(error, 'formulier-inzending') }, { status: 500 })

    if (patch.status && patch.status !== oud.status) {
      const meta = requestMeta(req)
      await logAudit({
        action: 'formulier.inzending.status', entityType: 'formulier_inzending', entityId: oud.id,
        summary: `Inzending${oud.naam ? ` van ${oud.naam}` : ''}: ${INZENDING_STATUS_INFO[oud.status as keyof typeof INZENDING_STATUS_INFO]?.label ?? oud.status} → ${INZENDING_STATUS_INFO[patch.status as keyof typeof INZENDING_STATUS_INFO].label}`,
        actorUserId: g.actor.userId, actorEmail: g.actor.email, actorRole: 'staff',
        metadata: { formulier_id: params.id }, ip: meta.ip, userAgent: meta.userAgent,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulier-inzending') }, { status: 400 })
  }
}

/** Een inzending definitief verwijderen, samen met de geüploade bestanden. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params
  try {
    const g = await formulierGuard('verwijderen')
    if (!g.ok) return g.response
    if (!isUuid(params.id) || !isUuid(params.inzendingId)) return NextResponse.json({ error: 'Inzending niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const { data: oud, error: oudFout } = await admin.from('formulier_inzendingen')
      .select('id, naam, email, client_id, link_id, antwoorden, velden_snapshot, created_at')
      .eq('id', params.inzendingId).eq('formulier_id', params.id).maybeSingle()
    if (oudFout) return NextResponse.json({ error: safeMessage(oudFout, 'formulier-inzending') }, { status: 500 })
    if (!oud) return NextResponse.json({ error: 'Inzending niet gevonden' }, { status: 404 })

    // Bestandspaden verzamelen vóór het wissen (enkel binnen de map van dit formulier).
    const velden = normaliseerVelden(oud.velden_snapshot ?? [])
    const antwoorden = (oud.antwoorden ?? {}) as Record<string, unknown>
    const paden: string[] = []
    for (const v of velden.filter((x) => x.type === 'bestand')) {
      const lijst = Array.isArray(antwoorden[v.id]) ? (antwoorden[v.id] as BestandAntwoord[]) : []
      for (const b of lijst) if (b?.pad && b.pad.startsWith(`${params.id}/`)) paden.push(b.pad)
    }

    const { error } = await admin.from('formulier_inzendingen').delete().eq('id', oud.id)
    if (error) return NextResponse.json({ error: safeMessage(error, 'formulier-inzending') }, { status: 500 })
    if (paden.length) { try { await admin.storage.from(BUCKET).remove(paden) } catch { /* wees-bestanden zijn onschadelijk */ } }

    const meta = requestMeta(req)
    await logAudit({
      action: 'formulier.inzending.delete', entityType: 'formulier_inzending', entityId: oud.id,
      summary: `Inzending${oud.naam ? ` van ${oud.naam}` : ''} verwijderd`,
      actorUserId: g.actor.userId, actorEmail: g.actor.email, actorRole: 'staff',
      metadata: { formulier_id: params.id, client_id: oud.client_id, link_id: oud.link_id, email: oud.email, ingestuurd_op: oud.created_at, bestanden: paden.length },
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulier-inzending') }, { status: 400 })
  }
}

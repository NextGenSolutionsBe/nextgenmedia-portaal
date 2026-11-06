import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { formulierGuard, migratieAntwoord } from '@/lib/formulieren/server'
import {
  normaliseerVelden, normaliseerInstellingen, geldigeDienst, dienstLabel, SJABLONEN, STANDAARD_INSTELLINGEN,
} from '@/lib/formulieren/model'

export const dynamic = 'force-dynamic'

/** Lijst van formulieren met tellingen (totaal, nieuw, laatste inzending). */
export async function GET(req: NextRequest) {
  try {
    const g = await formulierGuard('bekijken')
    if (!g.ok) return g.response
    const archief = req.nextUrl.searchParams.get('archief') === '1'
    const admin = createAdminSupabaseClient()

    let q = admin.from('formulieren')
      .select('id, titel, dienst, doel, status, created_at, updated_at, gearchiveerd_op, velden')
      .order('updated_at', { ascending: false }).limit(500)
    q = archief ? q.not('gearchiveerd_op', 'is', null) : q.is('gearchiveerd_op', null)
    const { data, error } = await q
    if (error) return migratieAntwoord(error.message) ?? NextResponse.json({ error: safeMessage(error, 'formulieren') }, { status: 500 })

    const rijen = (data ?? []) as { id: string; titel: string; dienst: string; doel: string | null; status: string; created_at: string; updated_at: string; gearchiveerd_op: string | null; velden: unknown }[]
    const ids = rijen.map((r) => r.id)
    const tel = new Map<string, { totaal: number; nieuw: number; laatste: string | null; links: number }>()
    for (const id of ids) tel.set(id, { totaal: 0, nieuw: 0, laatste: null, links: 0 })

    if (ids.length) {
      const [{ data: inz }, { data: links }] = await Promise.all([
        admin.from('formulier_inzendingen').select('formulier_id, status, created_at').in('formulier_id', ids).order('created_at', { ascending: false }).limit(20000),
        admin.from('formulier_links').select('formulier_id').in('formulier_id', ids).is('ingetrokken_op', null).limit(20000),
      ])
      for (const r of (inz ?? []) as { formulier_id: string; status: string; created_at: string }[]) {
        const t = tel.get(r.formulier_id); if (!t) continue
        t.totaal++
        if (r.status === 'nieuw') t.nieuw++
        if (!t.laatste || r.created_at > t.laatste) t.laatste = r.created_at
      }
      for (const r of (links ?? []) as { formulier_id: string }[]) { const t = tel.get(r.formulier_id); if (t) t.links++ }
    }

    const formulieren = rijen.map(({ velden, ...r }) => ({
      ...r,
      aantal_velden: Array.isArray(velden) ? velden.length : 0,
      inzendingen: tel.get(r.id)?.totaal ?? 0,
      nieuw: tel.get(r.id)?.nieuw ?? 0,
      laatste_inzending: tel.get(r.id)?.laatste ?? null,
      actieve_links: tel.get(r.id)?.links ?? 0,
    }))
    return NextResponse.json({ formulieren })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulieren') }, { status: 400 })
  }
}

/**
 * Nieuw formulier: leeg, vanuit een sjabloon, of met velden (bv. een aanvaard
 * AI-voorstel). Start altijd als concept.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await formulierGuard('toevoegen')
    if (!g.ok) return g.response
    const b = await req.json().catch(() => ({})) as Record<string, unknown>

    const sjabloon = typeof b.sjabloon === 'string' ? SJABLONEN.find((s) => s.key === b.sjabloon) : undefined
    const dienst = geldigeDienst(b.dienst ?? sjabloon?.dienst)
    const titel = String(b.titel ?? sjabloon?.titel ?? '').trim().slice(0, 200) || `Nieuw formulier — ${dienstLabel(dienst)}`
    const beschrijving = String(b.beschrijving ?? sjabloon?.beschrijving ?? '').trim().slice(0, 2000) || null
    const doel = String(b.doel ?? sjabloon?.doel ?? '').trim().slice(0, 120) || null
    const velden = normaliseerVelden(b.velden ?? sjabloon?.velden ?? [])
    const instellingen = normaliseerInstellingen(b.instellingen ?? STANDAARD_INSTELLINGEN)

    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('formulieren').insert({
      titel, beschrijving, dienst, doel, velden, instellingen, status: 'concept', created_by: g.actor.userId,
    }).select('id').single()
    if (error) return migratieAntwoord(error.message) ?? NextResponse.json({ error: safeMessage(error, 'formulieren') }, { status: 500 })

    const meta = requestMeta(req)
    await logAudit({
      action: 'formulier.create', entityType: 'formulier', entityId: data.id,
      summary: `Formulier aangemaakt: ${titel}${sjabloon ? ` (sjabloon ${sjabloon.titel})` : ''}`,
      actorUserId: g.actor.userId, actorEmail: g.actor.email, actorRole: 'staff',
      metadata: { dienst, velden: velden.length, sjabloon: sjabloon?.key ?? null }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulieren') }, { status: 400 })
  }
}

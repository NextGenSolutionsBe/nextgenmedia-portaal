import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { eisBeheer, schoonMetadata } from '@/lib/instellingen/api'

export const dynamic = 'force-dynamic'

const PER_PAGINA = 50

/**
 * GET — activiteitenlogboek (audit_log), doorzoekbaar en filterbaar.
 *   ?q=tekst&actie=prefix&actor=email&van=YYYY-MM-DD&tot=YYYY-MM-DD&pagina=1
 * Gevoelige velden in de metadata worden vóór het antwoord weggehaald.
 */
export async function GET(req: NextRequest) {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    const sp = req.nextUrl.searchParams
    const q = (sp.get('q') ?? '').trim().replace(/[,()%]/g, ' ').slice(0, 100)
    const actie = (sp.get('actie') ?? '').trim().slice(0, 80)
    const actor = (sp.get('actor') ?? '').trim().replace(/[,()%]/g, ' ').slice(0, 120)
    const van = (sp.get('van') ?? '').trim()
    const tot = (sp.get('tot') ?? '').trim()
    const pagina = Math.max(1, Number(sp.get('pagina') ?? '1') || 1)
    const datum = /^\d{4}-\d{2}-\d{2}$/

    const admin = createAdminSupabaseClient()
    let query = admin.from('audit_log')
      .select('id, action, entity_type, entity_id, summary, actor_email, actor_role, metadata, ip, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
    if (q) query = query.or(`summary.ilike.%${q}%,action.ilike.%${q}%,entity_id.ilike.%${q}%,actor_email.ilike.%${q}%`)
    if (actie) query = query.like('action', `${actie}%`)
    if (actor) query = query.ilike('actor_email', `%${actor}%`)
    if (datum.test(van)) query = query.gte('created_at', `${van}T00:00:00+02:00`)
    if (datum.test(tot)) query = query.lte('created_at', `${tot}T23:59:59+02:00`)
    const vanaf = (pagina - 1) * PER_PAGINA
    const { data, count, error } = await query.range(vanaf, vanaf + PER_PAGINA - 1)
    if (error) throw new Error(error.message)

    // Beschikbare actiegroepen (eerste segment vóór de punt) voor de filter.
    const { data: recent } = await admin.from('audit_log').select('action').order('created_at', { ascending: false }).limit(2000)
    const groepen = [...new Set(((recent ?? []) as { action: string }[]).map((r) => r.action.split('.')[0]))].sort()

    const rijen = ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...r, metadata: schoonMetadata(r.metadata ?? {}) }))
    return NextResponse.json({ rijen, totaal: count ?? rijen.length, pagina, perPagina: PER_PAGINA, groepen })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

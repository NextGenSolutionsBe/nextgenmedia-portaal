import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisBeheer } from '@/lib/instellingen/api'
import { controleerFacturatieLijst, VERWACHTE_FACTURATIELOCATIE } from '@/lib/clickup'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST { lijstId } — controleert een ClickUp-lijst via de API en toont
 * Workspace → Space → Folder → Lijst. Leest enkel; schrijft niets, maakt
 * niets aan. Het opslaan gebeurt apart (PUT /api/admin/instellingen) en
 * vraagt dezelfde controle opnieuw plus een uitdrukkelijke bevestiging.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    const b = (await req.json().catch(() => null)) as { lijstId?: unknown } | null
    const id = typeof b?.lijstId === 'string' ? b.lijstId.trim() : ''
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Vul een ClickUp lijst-id in (enkel cijfers).' }, { status: 400 })
    const c = await controleerFacturatieLijst(id)
    return NextResponse.json({ ...c, verwacht: VERWACHTE_FACTURATIELOCATIE })
  } catch (err) {
    const m = err instanceof Error ? err.message : ''
    if (/→ 404/.test(m)) return NextResponse.json({ error: 'Deze lijst bestaat niet, of de API-sleutel heeft er geen toegang toe.' }, { status: 404 })
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
